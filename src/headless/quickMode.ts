/**
 * Quick Mode - Ultra-fast single-command execution with minimal overhead.
 *
 * Usage:
 *   agi --quick "create a hello world script"
 *   agi -q "fix the build error"
 *   echo "run npm test" | agi -q
 *
 * Optimizations:
 * - Skips provider discovery (uses cached or default)
 * - Minimal tool loading (core tools only)
 * - No status bar, no fancy UI
 * - Direct stdout streaming
 * - Lazy AGI core loading
 *
 * This mode maintains AGI core requirements while minimizing startup time.
 */

import { stdout, stdin, exit } from 'node:process';
import readline from 'node:readline';
import type { ProfileName } from '../config.js';
import { hasAgentProfile, listAgentProfiles } from '../core/agentProfiles.js';
import { createAgentController } from '../runtime/agentController.js';
import { resolveWorkspaceCaptureOptions, buildWorkspaceContext } from '../workspace.js';
import { loadAllSecrets } from '../core/secretStore.js';
import { formatClickableLinks } from '../ui/richText.js';
import { ensureNextSteps } from '../core/finalResponseFormatter.js';

export interface QuickLaunchOptions {
  argv: string[];
}

interface ParsedQuickArgs {
  profile?: string;
  prompt?: string | null;
  watchStdIn: boolean;
  skipAgi?: boolean;
}

/**
 * Run in quick mode - optimized for fast single-command execution.
 * Maintains AGI core requirements while minimizing startup overhead.
 */
export async function runQuickMode(options: QuickLaunchOptions): Promise<void> {
  const startTime = Date.now();

  // Load secrets early but skip other heavy initialization
  loadAllSecrets();

  const parsed = parseQuickArgs(options.argv);
  const profile = resolveProfile(parsed.profile);
  const workingDir = process.cwd();

  // Minimal workspace context - skip heavy analysis
  const workspaceOptions = resolveWorkspaceCaptureOptions(process.env);
  const workspaceContext = buildWorkspaceContext(workingDir, workspaceOptions);

  // Log pre-controller time
  if (process.env['AGI_DEBUG']) {
    console.error(`[quick] pre-controller: ${Date.now() - startTime}ms`);
  }

  // Create controller with minimal options - skip provider discovery
  const controller = await createAgentController({
    profile,
    workingDir,
    workspaceContext,
    env: process.env,
    skipProviderDiscovery: true, // Key optimization
  });

  const initTime = Date.now() - startTime;

  // Log init time in debug mode
  if (process.env['AGI_DEBUG']) {
    console.error(`[quick] initialized in ${initTime}ms`);
  }

  let processing = false;
  let stdinClosed = !parsed.watchStdIn;

  const handlePrompt = async (prompt: string): Promise<void> => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return;
    }

    let accumulatedContent = '';

    // Stream the response with minimal UI overhead
    for await (const event of controller.send(trimmed)) {
      if (event.type === 'message.start') {
        accumulatedContent = '';
      } else if (event.type === 'message.delta') {
        accumulatedContent += event.content;
      } else if (event.type === 'message.complete') {
        const raw = accumulatedContent || event.content || '';
        const { output } = ensureNextSteps(raw);
        const formatted = formatClickableLinks(output);
        stdout.write(formatted);
        stdout.write('\n');
        accumulatedContent = '';
      } else if (event.type === 'tool.start') {
        // Compact tool output for quick mode
        const toolName = event.toolName;
        const args = event.parameters;
        if (toolName === 'Bash' && args?.['command']) {
          stdout.write(`$ ${args['command']}\n`);
        } else if (toolName === 'Read' && args?.['file_path']) {
          stdout.write(`[read] ${args['file_path']}\n`);
        } else if (toolName === 'Write' && args?.['file_path']) {
          stdout.write(`[write] ${args['file_path']}\n`);
        } else if (toolName === 'Edit' && args?.['file_path']) {
          stdout.write(`[edit] ${args['file_path']}\n`);
        } else if (toolName === 'Glob') {
          stdout.write(`[glob] ${args?.['pattern'] || ''}\n`);
        } else if (toolName === 'Grep') {
          stdout.write(`[grep] ${args?.['pattern'] || ''}\n`);
        }
        // Skip verbose tool announcements for other tools
      } else if (event.type === 'tool.complete') {
        // Show truncated results for quick feedback
        if (event.result && typeof event.result === 'string' && event.result.length > 0) {
          const lines = event.result.split('\n');
          if (lines.length > 10) {
            stdout.write(lines.slice(0, 10).join('\n') + '\n... (' + (lines.length - 10) + ' more lines)\n');
          } else if (event.result.length > 300) {
            stdout.write(event.result.slice(0, 300) + '...\n');
          } else {
            stdout.write(event.result + '\n');
          }
        }
      } else if (event.type === 'provider.fallback') {
        // Show fallback notification in quick mode
        stdout.write(`⚠ ${event.fromProvider}/${event.fromModel} failed (${event.reason}) → switching to ${event.toProvider}/${event.toModel}\n`);
      }
    }
  };

  const processQueue = async (prompts: string[]): Promise<void> => {
    processing = true;
    for (const prompt of prompts) {
      await handlePrompt(prompt).catch((error: unknown) => {
        console.error('Error:', error instanceof Error ? error.message : String(error));
      });
    }
    processing = false;
    if (stdinClosed) {
      exit(0);
    }
  };

  // Process initial prompt if provided
  if (parsed.prompt) {
    await processQueue([parsed.prompt]);
    if (!parsed.watchStdIn) {
      exit(0);
    }
  }

  // Watch stdin for additional prompts
  if (parsed.watchStdIn) {
    const rl = readline.createInterface({ input: stdin, terminal: false });
    const pendingPrompts: string[] = [];

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed) {
        pendingPrompts.push(trimmed);
        if (!processing) {
          const batch = pendingPrompts.splice(0);
          void processQueue(batch);
        }
      }
    });

    rl.on('close', () => {
      stdinClosed = true;
      if (!processing) {
        exit(0);
      }
    });

    stdin.resume();
  } else if (!parsed.prompt) {
    console.error('Quick mode requires a prompt. Usage: agi -q "your prompt"');
    exit(1);
  }
}

function parseQuickArgs(argv: string[]): ParsedQuickArgs {
  let profile: string | undefined;
  let watchStdIn = !stdin.isTTY;
  const promptTokens: string[] = [];
  let skipAgi = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }
    // Skip the quick flag itself
    if (token === '--quick' || token === '-q') {
      continue;
    }
    if (token === '--profile' || token === '-p') {
      profile = argv[index + 1];
      index += 1;
      continue;
    }
    if (token.startsWith('--profile=')) {
      profile = token.slice('--profile='.length);
      continue;
    }
    if (token === '--no-stdin') {
      watchStdIn = false;
      continue;
    }
    if (token === '--no-agi') {
      skipAgi = true;
      continue;
    }
    // Skip other known flags
    if (token.startsWith('--') || token.startsWith('-')) {
      continue;
    }
    promptTokens.push(token);
  }

  return {
    profile,
    watchStdIn,
    prompt: promptTokens.length ? promptTokens.join(' ').trim() : null,
    skipAgi,
  };
}

function resolveProfile(override?: string): ProfileName {
  if (override) {
    if (!hasAgentProfile(override as ProfileName)) {
      const available = listAgentProfiles().map((p) => p.name).join(', ');
      throw new Error(`Unknown profile "${override}". Available: ${available}`);
    }
    return override as ProfileName;
  }
  return 'agi-code';
}
