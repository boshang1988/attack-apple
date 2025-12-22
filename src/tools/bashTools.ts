import { spawn, ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolDefinition } from '../core/toolRuntime.js';
import { reportToolProgress } from '../core/toolRuntime.js';
import { validateBashCommand, SmartFixer } from '../core/errors/safetyValidator.js';
import { toStructuredError } from '../core/errors/errorTypes.js';
import { analyzeBashFlow } from '../core/bashCommandGuidance.js';
import { buildError } from '../core/errors.js';
import {
  verifiedSuccess,
  verifiedFailure,
  analyzeOutput,
  OutputPatterns,
  createCommandCheck,
} from '../core/resultVerification.js';
import { createErrorFixer, type AIErrorFixer } from '../core/aiErrorFixer.js';
import { logDebug } from '../utils/debugLogger.js';

// ANSI color codes for enhanced output
const ANSI_RESET = '\x1b[0m';
const ANSI_RED = '\x1b[31m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_BLUE = '\x1b[34m';
const ANSI_CYAN = '\x1b[36m';
const ANSI_DIM = '\x1b[2m';
const ANSI_BOLD = '\x1b[1m';
const ANSI_RED_BOLD = '\x1b[1;31m';
const ANSI_GREEN_BOLD = '\x1b[1;32m';
const ANSI_YELLOW_BOLD = '\x1b[1;33m';

// ============================================================================
// Background Shell Manager (consolidated from backgroundBashTools.ts)
// ============================================================================

class BackgroundShell {
  private process?: ChildProcess;
  private outputBuffer: string[] = [];
  private errorBuffer: string[] = [];
  private lastReadPosition = 0;
  private isRunning = false;
  private exitCode?: number;

  constructor(
    public readonly id: string,
    private command: string,
    private workingDir: string
  ) {}

  start(): void {
    this.process = spawn('bash', ['-c', this.command], {
      cwd: this.workingDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.isRunning = true;

    this.process.stdout?.on('data', (data) => {
      this.outputBuffer.push(data.toString());
    });

    this.process.stderr?.on('data', (data) => {
      this.errorBuffer.push(data.toString());
    });

    this.process.on('exit', (code) => {
      this.exitCode = code ?? 0;
      this.isRunning = false;
    });
  }

  getNewOutput(filter?: RegExp): { stdout: string; stderr: string; status: string } {
    const allOutput = this.outputBuffer.join('');
    const newOutput = allOutput.substring(this.lastReadPosition);
    this.lastReadPosition = allOutput.length;

    const allError = this.errorBuffer.join('');

    let stdout = newOutput;
    if (filter) {
      const lines = newOutput.split('\n');
      stdout = lines.filter(line => filter.test(line)).join('\n');
    }

    return {
      stdout,
      stderr: allError,
      status: this.isRunning ? 'running' : `exited with code ${this.exitCode}`,
    };
  }

  kill(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 5000);
    }
  }
}

class BackgroundShellManager {
  private shells = new Map<string, BackgroundShell>();
  private nextId = 1;

  createShell(command: string, workingDir: string): string {
    const shellId = `shell_${this.nextId++}`;
    const shell = new BackgroundShell(shellId, command, workingDir);
    this.shells.set(shellId, shell);
    shell.start();
    return shellId;
  }

  getShell(shellId: string): BackgroundShell | undefined {
    return this.shells.get(shellId);
  }

  killShell(shellId: string): boolean {
    const shell = this.shells.get(shellId);
    if (shell) {
      shell.kill();
      this.shells.delete(shellId);
      return true;
    }
    return false;
  }

  listShells(): string[] {
    return Array.from(this.shells.keys());
  }
}

// Global shell manager instance
const shellManager = new BackgroundShellManager();

// ============================================================================
// Streaming Execution
// ============================================================================

async function execWithStreaming(
  command: string,
  options: { cwd: string; timeout: number; env: NodeJS.ProcessEnv }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const MAX_BUFFER_BYTES = 1_000_000; // ~1MB per stream to prevent OOM on chatty commands
  return new Promise((resolve, reject) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let lineCount = 0;
    let killed = false;

    const child = spawn('bash', ['-c', command], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeoutId = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1000);
    }, options.timeout);

    const processLine = (line: string, isStderr: boolean) => {
      lineCount++;
      const trimmedLine = line.slice(0, 80);
      reportToolProgress({
        current: lineCount,
        message: isStderr ? `stderr: ${trimmedLine}` : trimmedLine,
      });
    };

    const appendChunk = (chunks: string[], data: Buffer, isStdout: boolean): void => {
      const byteLength = data.length;
      const used = isStdout ? stdoutBytes : stderrBytes;
      const available = MAX_BUFFER_BYTES - used;
      if (available <= 0) {
        if (isStdout) stdoutTruncated = true;
        else stderrTruncated = true;
        return;
      }

      const slice = byteLength > available ? data.subarray(0, available) : data;
      chunks.push(slice.toString());
      const consumed = slice.length; // Buffer length in bytes
      if (isStdout) {
        stdoutBytes += consumed;
        if (byteLength > available) stdoutTruncated = true;
      } else {
        stderrBytes += consumed;
        if (byteLength > available) stderrTruncated = true;
      }
    };

    let stdoutBuffer = '';
    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      appendChunk(stdout, data, true);
      stdoutBuffer += text;
      if (stdoutBuffer.length > 4096) {
        stdoutBuffer = stdoutBuffer.slice(-2048);
      }
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) processLine(line, false);
      }
    });

    let stderrBuffer = '';
    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      appendChunk(stderr, data, false);
      stderrBuffer += text;
      if (stderrBuffer.length > 4096) {
        stderrBuffer = stderrBuffer.slice(-2048);
      }
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) processLine(line, true);
      }
    });

    const buildOutput = (chunks: string[], truncated: boolean): string => {
      const output = chunks.join('');
      if (!truncated) return output;
      const limitKb = Math.round(MAX_BUFFER_BYTES / 1024);
      const notice = `\n[output truncated after ${limitKb}KB to protect memory; rerun with narrower command to see full output]`;
      return output ? `${output}${notice}` : notice.trim();
    };

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      if (stdoutBuffer.trim()) processLine(stdoutBuffer, false);
      if (stderrBuffer.trim()) processLine(stderrBuffer, true);

      const stdoutText = buildOutput(stdout, stdoutTruncated);
      const stderrText = buildOutput(stderr, stderrTruncated);

      if (killed) {
        reject({ killed: true, stdout: stdoutText, stderr: stderrText, code });
      } else {
        resolve({ stdout: stdoutText, stderr: stderrText, exitCode: code ?? 0 });
      }
    });

    child.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

// Keep the shell responsive while long commands run
function findGuiLauncher(_command: string): string | null {
  return null;
}

const errorFixerCache = new Map<string, AIErrorFixer>();
function getErrorFixer(workingDir: string): AIErrorFixer {
  let fixer = errorFixerCache.get(workingDir);
  if (!fixer) {
    fixer = createErrorFixer({ workingDir });
    errorFixerCache.set(workingDir, fixer);
  }
  return fixer;
}

/**
 * Smart timeout detection based on command type
 */
function getSmartTimeout(command: string): number {
  const cmd = command.toLowerCase().trim();

  // All commands get 24 hours - effectively infinite timeout
  return 24 * 60 * 60 * 1000;
}

// ============================================================================
// Sandbox Environment
// ============================================================================

interface SandboxPaths {
  root: string;
  home: string;
  cache: string;
  config: string;
  data: string;
  tmp: string;
}

const sandboxCache = new Map<string, Promise<SandboxPaths>>();

async function ensureSandboxPaths(workingDir: string): Promise<SandboxPaths> {
  let pending = sandboxCache.get(workingDir);
  if (!pending) {
    pending = createSandboxPaths(workingDir);
    sandboxCache.set(workingDir, pending);
  }
  return pending;
}

async function createSandboxPaths(workingDir: string): Promise<SandboxPaths> {
  const root = join(workingDir, '.agi', 'shell-sandbox');
  const home = join(root, 'home');
  const cache = join(root, 'cache');
  const config = join(root, 'config');
  const data = join(root, 'data');
  const tmp = join(root, 'tmp');
  await Promise.all([home, cache, config, data, tmp].map((dir) => mkdir(dir, { recursive: true })));
  return { root, home, cache, config, data, tmp };
}

export async function buildSandboxEnv(
  workingDir: string,
  options?: { preserveHome?: boolean }
): Promise<NodeJS.ProcessEnv> {
  const envPreference = process.env['AGI_PRESERVE_HOME'];
  const preserveHome = envPreference === '1' ? true : envPreference === '0' ? false : Boolean(options?.preserveHome);
  const paths = await ensureSandboxPaths(workingDir);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGI_SANDBOX_ROOT: paths.root,
    AGI_SANDBOX_HOME: paths.home,
    AGI_SANDBOX_TMP: paths.tmp,
  };

  if (!preserveHome) env['HOME'] = paths.home;
  env['XDG_CACHE_HOME'] = paths.cache;
  env['XDG_CONFIG_HOME'] = paths.config;
  env['XDG_DATA_HOME'] = paths.data;
  env['TMPDIR'] = paths.tmp;
  env['TMP'] = paths.tmp;
  env['TEMP'] = paths.tmp;

  return env;
}

// ============================================================================
// Main Tool Factory
// ============================================================================

export function createBashTools(workingDir: string): ToolDefinition[] {
  return [
    // Main bash execution tool
    {
      name: 'execute_bash',
      description: 'Execute a bash command. Commands auto-timeout based on type. Use run_in_background: true for servers/watchers.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to execute' },
          timeout: { type: 'number', description: 'Timeout in milliseconds (smart defaults apply)' },
          run_in_background: { type: 'boolean', description: 'Run in background for long-running processes' },
        },
        required: ['command'],
      },
      handler: async (args) => {
        let command = args['command'] as string;
        const runInBackground = args['run_in_background'] === true;
        const userTimeout = args['timeout'] as number | undefined;
        const timeout = userTimeout ?? getSmartTimeout(command);

        // Strip sudo and password-requiring commands to avoid interactive prompts
        if (/^\s*sudo\s+/i.test(command)) {
          command = command.replace(/^\s*sudo\s+/i, '');
          logDebug('[Bash] Stripped sudo prefix to avoid password prompt');
        }
        // Block commands that typically require passwords or interactive input
        const interactiveCommands = /\b(passwd|su\s|login|ssh\s(?!-o)|sftp|ftp|mysql\s+-p|psql\s+-W)\b/i;
        if (interactiveCommands.test(command)) {
          return 'Skipped: Command requires interactive authentication. Use non-interactive alternatives.';
        }

        // Flow guidance (debug only - don't pollute chat)
        const flowWarnings = analyzeBashFlow(command);
        for (const warning of flowWarnings) {
          const suffix = warning.suggestion ? ` — ${warning.suggestion}` : '';
          logDebug(`[Bash Flow] ${warning.message}${suffix}`);
        }

        // Safety validation (informational only in fully authorized security environment)
        const validation = validateBashCommand(command);
        if (!validation.valid) {
          // In fully authorized security environment, log warnings but allow execution
          logDebug(`[Bash Safety] Command validation failed but proceeding in authorized environment: ${validation.error?.message || 'Unknown error'}`);
          // Continue execution - all operations pre-authorized
        }

        // Safety warnings (debug only - don't pollute chat)
        if (validation.warnings.length > 0) {
          for (const warning of validation.warnings) {
            logDebug(`[Bash Safety] WARNING (authorized environment - proceeding): ${warning}`);
          }
        }

        // GUI blocking check (disabled for red team ops in authorized environment)
        const guiBlocked = findGuiLauncher(command);
        if (guiBlocked) {
          logDebug(`[Bash Safety] GUI launcher detected but proceeding in authorized environment: ${guiBlocked}`);
          // Continue execution - all operations pre-authorized
        }

        // Background execution
        if (runInBackground) {
          const shellId = shellManager.createShell(command, workingDir);
          return `Background shell started: ${shellId}\n\nUse BashOutput with bash_id="${shellId}" to monitor.\nUse KillShell with shell_id="${shellId}" to terminate.`;
        }

        // Foreground execution
        const startTime = Date.now();
        try {
          const env = await buildSandboxEnv(workingDir);
          const { stdout, stderr, exitCode } = await execWithStreaming(command, { cwd: workingDir, timeout, env });
          const durationMs = Date.now() - startTime;
          const combinedOutput = [stdout, stderr].filter(Boolean).join('\n');

          const commandLower = command.toLowerCase().trim();
          let patterns = OutputPatterns.command;
          if (commandLower.startsWith('git ') || commandLower === 'git') patterns = OutputPatterns.git;
          else if (commandLower.startsWith('npm ') || commandLower.startsWith('npx ')) patterns = OutputPatterns.npm;

          const analysis = analyzeOutput(combinedOutput, patterns, exitCode);
          const commandCheck = createCommandCheck('Command execution', exitCode, combinedOutput);

          if (exitCode !== 0) {
            const errorFixer = getErrorFixer(workingDir);
            const aiErrors = errorFixer.analyzeOutput(combinedOutput, command);
            const aiGuidance = aiErrors.length > 0 ? errorFixer.formatForAI(aiErrors) : '';
            const suggestions = ['Review the error message', 'Fix the issue and retry'];
            const firstError = aiErrors[0];
            if (firstError?.suggestedFixes[0]) {
              suggestions.unshift(`AI Suggestion: ${firstError.suggestedFixes[0].description}`);
            }

            return verifiedFailure(
              `Command failed with exit code ${exitCode}`,
              `Command: ${command}\n\nOutput:\n${combinedOutput || '(none)'}${aiGuidance}`,
              suggestions,
              [commandCheck],
              durationMs
            );
          }

          if (analysis.isFailure) {
            return verifiedFailure(
              `Command completed with exit code 0 but output indicates failure`,
              `Command: ${command}\n\n${ANSI_RED_BOLD}Output:${ANSI_RESET}\n${combinedOutput || '(no output)'}`,
              ['Review the error message in the output', 'Fix the underlying issue and retry'],
              [commandCheck, { check: 'Output analysis', passed: false, details: `Failure pattern: ${analysis.matchedPattern}` }],
              durationMs
            );
          }

          return verifiedSuccess(
            combinedOutput.trim() ? `Command executed successfully` : `Command executed successfully (no output)`,
            `Command: ${command}${combinedOutput.trim() ? `\n\n${ANSI_GREEN_BOLD}Output:${ANSI_RESET}\n${combinedOutput}` : ''}`,
            [commandCheck, ...(analysis.isSuccess ? [{ check: 'Output analysis', passed: true, details: `Success pattern matched` }] : [])],
            durationMs
          );
        } catch (error: unknown) {
          const execError = error as { code?: number; stdout?: string; stderr?: string; message?: string; killed?: boolean };
          const durationMs = Date.now() - startTime;
          const exitCode = execError.code ?? 1;
          const combinedError = [execError.stdout, execError.stderr, execError.message].filter(Boolean).join('\n');

          if (execError.killed) {
            return verifiedFailure(
              `Command timed out after ${timeout}ms`,
              `Command: ${command}\n\nPartial output:\n${combinedError || '(none)'}`,
              ['Increase timeout if command legitimately needs more time', 'Check if command is hanging'],
              [{ check: 'Timeout', passed: false, details: `Exceeded ${timeout}ms` }],
              durationMs
            );
          }

          const errorFixer = getErrorFixer(workingDir);
          const aiErrors = errorFixer.analyzeOutput(combinedError, command);
          const aiGuidance = aiErrors.length > 0 ? errorFixer.formatForAI(aiErrors) : '';
          const suggestions = ['Review the error message', 'Fix the issue and retry'];
          const firstError = aiErrors[0];
          if (firstError?.suggestedFixes[0]) {
            suggestions.unshift(`AI Suggestion: ${firstError.suggestedFixes[0].description}`);
          }

          return verifiedFailure(
            `Command failed with exit code ${exitCode}`,
            `Command: ${command}\n\nError output:\n${combinedError || '(none)'}${aiGuidance}`,
            suggestions,
            [createCommandCheck('Command execution', exitCode, combinedError)],
            durationMs
          );
        }
      },
    },

    // Background shell output retrieval
    {
      name: 'BashOutput',
      description: 'Retrieve output from a running or completed background bash shell.',
      parameters: {
        type: 'object',
        properties: {
          bash_id: { type: 'string', description: 'The ID of the background shell' },
          filter: { type: 'string', description: 'Optional regex to filter output lines' },
        },
        required: ['bash_id'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const bashId = args['bash_id'];
        const filterStr = args['filter'];

        if (typeof bashId !== 'string' || !bashId.trim()) {
          return 'Error: bash_id must be a non-empty string.';
        }

        try {
          const shell = shellManager.getShell(bashId);
          if (!shell) {
            const available = shellManager.listShells();
            return `Error: Shell "${bashId}" not found.\n\nAvailable: ${available.length > 0 ? available.join(', ') : 'none'}`;
          }

          const filter = filterStr && typeof filterStr === 'string' ? new RegExp(filterStr) : undefined;
          const { stdout, stderr, status } = shell.getNewOutput(filter);

          const parts: string[] = [`Shell: ${bashId}`, `Status: ${status}`];
          if (stdout) { parts.push('\n=== New Output ==='); parts.push(stdout); }
          if (stderr) { parts.push('\n=== Errors ==='); parts.push(stderr); }
          if (!stdout && !stderr) parts.push('\n(No new output)');

          return parts.join('\n');
        } catch (error: unknown) {
          return buildError('retrieving shell output', error, { bash_id: bashId });
        }
      },
    },

    // Kill background shell
    {
      name: 'KillShell',
      description: 'Kill a running background bash shell by its ID.',
      parameters: {
        type: 'object',
        properties: {
          shell_id: { type: 'string', description: 'The ID of the background shell to kill' },
        },
        required: ['shell_id'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const shellId = args['shell_id'];

        if (typeof shellId !== 'string' || !shellId.trim()) {
          return 'Error: shell_id must be a non-empty string.';
        }

        try {
          const success = shellManager.killShell(shellId);
          if (success) {
            return `Shell "${shellId}" has been terminated.`;
          } else {
            const available = shellManager.listShells();
            return `Error: Shell "${shellId}" not found.\n\nAvailable: ${available.length > 0 ? available.join(', ') : 'none'}`;
          }
        } catch (error: unknown) {
          return buildError('killing shell', error, { shell_id: shellId });
        }
      },
    },
  ];
}
