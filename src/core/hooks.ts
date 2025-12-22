/**
 * Hooks System
 *
 * Event-triggered scripts that automate workflows, based on AGI CLI's hooks architecture.
 * Hooks can execute shell commands or query an LLM for decisions.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getAGI, type PromptAnalysis } from './agiCore.js';

const execAsync = promisify(exec);

/**
 * Hook event types
 */
export type HookEvent =
  | 'PreToolUse'       // Before tool execution
  | 'PostToolUse'      // After tool completes
  | 'PermissionRequest' // User approval needed
  | 'UserPromptSubmit' // User enters input
  | 'SessionStart'     // Session begins
  | 'SessionEnd'       // Session ends
  | 'Stop'             // Main agent stops
  | 'SubagentStop'     // Subagent finishes
  | 'Notification';    // System alerts

/**
 * Hook types
 */
export type HookType = 'command' | 'prompt';

/**
 * Hook definition
 */
export interface HookDefinition {
  /** Regex pattern to match tool names or events */
  matcher?: string;
  /** Type of hook: 'command' for shell, 'prompt' for LLM */
  type: HookType;
  /** Shell command to execute (for command hooks) */
  command?: string;
  /** Prompt to send to LLM (for prompt hooks) */
  prompt?: string;
  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Hook execution result
 */
export interface HookResult {
  success: boolean;
  output?: string;
  decision?: 'allow' | 'deny' | 'continue';
  reason?: string;
  error?: string;
  blocked?: boolean;
}

/**
 * Hook execution context
 */
export interface HookContext {
  event: HookEvent;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  userInput?: string;
  sessionId?: string;
  workingDir: string;
}

/**
 * Hooks configuration
 */
export interface HooksConfig {
  [event: string]: HookDefinition[];
}

/**
 * Settings file structure
 */
interface SettingsFile {
  hooks?: HooksConfig;
}

/**
 * Load hooks from settings files
 */
export function loadHooks(workingDir: string): HooksConfig {
  const hooks: HooksConfig = {};

  // Load from user settings (~/.claude/settings.json or ~/.agi/settings.json)
  const userSettingsPaths = [
    join(homedir(), '.claude', 'settings.json'),
    join(homedir(), '.agi', 'settings.json'),
    join(homedir(), '.erosolar', 'settings.json'),
  ];

  // Load from project settings (.claude/settings.json or .agi/settings.json)
  const projectSettingsPaths = [
    join(workingDir, '.claude', 'settings.json'),
    join(workingDir, '.agi', 'settings.json'),
    join(workingDir, '.erosolar', 'settings.json'),
  ];

  // Load user settings first, then override with project settings
  for (const settingsPath of [...userSettingsPaths, ...projectSettingsPaths]) {
    if (existsSync(settingsPath)) {
      try {
        const content = readFileSync(settingsPath, 'utf-8');
        const settings: SettingsFile = JSON.parse(content);

        if (settings.hooks) {
          for (const [event, eventHooks] of Object.entries(settings.hooks)) {
            if (!hooks[event]) {
              hooks[event] = [];
            }
            hooks[event].push(...eventHooks);
          }
        }
      } catch {
        // Ignore invalid settings files
      }
    }
  }

  return hooks;
}

/**
 * Check if a hook matches the given context
 */
function matchesHook(hook: HookDefinition, context: HookContext): boolean {
  if (!hook.matcher) {
    return true;
  }

  try {
    const regex = new RegExp(hook.matcher);

    // Match against tool name if available
    if (context.toolName) {
      return regex.test(context.toolName);
    }

    // Match against event name
    return regex.test(context.event);
  } catch {
    return false;
  }
}

/**
 * Execute a command hook
 */
async function executeCommandHook(
  hook: HookDefinition,
  context: HookContext
): Promise<HookResult> {
  if (!hook.command) {
    return { success: false, error: 'No command specified' };
  }

      const timeout = hook.timeout ?? 24 * 60 * 60 * 1000;

  // Prepare environment variables for the hook
  const env = {
    ...process.env,
    HOOK_EVENT: context.event,
    HOOK_TOOL_NAME: context.toolName ?? '',
    HOOK_TOOL_ARGS: context.toolArgs ? JSON.stringify(context.toolArgs) : '',
    HOOK_TOOL_RESULT: context.toolResult ?? '',
    HOOK_USER_INPUT: context.userInput ?? '',
    HOOK_SESSION_ID: context.sessionId ?? '',
    HOOK_WORKING_DIR: context.workingDir,
  };

  try {
    const { stdout } = await execAsync(hook.command, {
      cwd: context.workingDir,
      timeout,
      env,
    });

    // Try to parse JSON output for structured results
    const output = stdout.trim();
    try {
      const parsed = JSON.parse(output);
      return {
        success: true,
        output,
        decision: parsed.decision,
        reason: parsed.reason,
        blocked: parsed.blocked,
      };
    } catch {
      // Return raw output if not JSON
      return {
        success: true,
        output,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Exit code 2 means blocking
    if (message.includes('exit code 2')) {
      return {
        success: false,
        blocked: true,
        error: message,
      };
    }

    return {
      success: false,
      error: message,
    };
  }
}

interface RiskAssessment {
  score: number;
  reasons: string[];
}

function serializeArgs(args?: Record<string, unknown>): string {
  if (!args) return '';
  try {
    return JSON.stringify(args, (_key, value) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    });
  } catch {
    return String(args);
  }
}

function buildPromptForHook(hook: HookDefinition, context: HookContext): string {
  const parts: string[] = [];

  if (hook.prompt) {
    parts.push(hook.prompt.trim());
  }
  parts.push(`Event: ${context.event}`);

  if (context.userInput) {
    parts.push(`User input: ${context.userInput}`);
  }
  if (context.toolName) {
    parts.push(`Tool: ${context.toolName}`);
  }
  if (context.toolArgs) {
    parts.push(`Args: ${serializeArgs(context.toolArgs)}`);
  }
  if (context.toolResult) {
    parts.push(`Result: ${context.toolResult}`);
  }

  return parts.filter(Boolean).join('\n');
}

function assessPromptRisk(promptText: string, context: HookContext, _analysis: PromptAnalysis): RiskAssessment {
  const lower = promptText.toLowerCase();
  const reasons: string[] = [];

  const destructivePatterns = [
    /rm\s+-rf\s+\/?/,
    /sudo\s+rm\s+-rf/,
    /:\(\)\s*{.*:.*\|.*:.*;.*};\s*:/, // fork bomb
    /mkfs/i,
    /format\s+c:/i,
    /shutdown\s+-h/i,
    /kill\s+-9\s+1/,
    /dd\s+if=\/dev\//i,
  ];

  if (typeof context.toolArgs?.['command'] === 'string') {
    const cmd = String(context.toolArgs['command']).toLowerCase();
    if (/rm\s+-rf/.test(cmd) || /(^|\s)del\s+\/f/i.test(cmd)) {
      reasons.push('Destructive shell command');
    }
    if (/shutdown|reboot/.test(cmd)) {
      reasons.push('System shutdown command');
    }
  }

  if (destructivePatterns.some((re) => re.test(lower))) {
    reasons.push('Destructive content detected');
  }

  const score = reasons.length > 0 ? 0.9 : 0.05;
  return { score, reasons };
}

function formatPromptHookOutput(analysis: PromptAnalysis, risk: RiskAssessment): string {
  const lines: string[] = [];
  lines.push(`Interpretation: ${analysis.interpretation}`);
  lines.push(`Intent: ${analysis.intent} (${analysis.category}, ${(analysis.confidence * 100).toFixed(0)}% conf)`);
  lines.push(
    analysis.tasks.length
      ? `Tasks: ${analysis.tasks.map((t) => `[${t.id}] ${t.description}`).join(' | ')}`
      : 'Tasks: none'
  );
  lines.push(`Risk: ${(risk.score * 100).toFixed(0)}%${risk.reasons.length ? ` (${risk.reasons.join('; ')})` : ''}`);
  if (analysis.clarificationNeeded.length) {
    lines.push(`Clarifications: ${analysis.clarificationNeeded.join('; ')}`);
  }
  return lines.join('\n');
}

/**
 * Execute a prompt hook (would query LLM in full implementation)
 */
async function executePromptHook(
  hook: HookDefinition,
  context: HookContext
): Promise<HookResult> {
  if (!hook.prompt) {
    return { success: false, error: 'No prompt specified' };
  }

  const start = Date.now();
  const promptText = buildPromptForHook(hook, context);
  const agi = getAGI(context.workingDir);
  const analysis = agi.analyzePrompt(promptText);
  const risk = assessPromptRisk(promptText, context, analysis);

  const highRiskEvent =
    context.event === 'PreToolUse' || context.event === 'PermissionRequest' || context.event === 'UserPromptSubmit';
  const blocked = highRiskEvent && risk.score >= 0.75;
  const decision: HookResult['decision'] = blocked ? 'deny' : 'continue';

  agi.recordOperation({
    id: `hook-${context.event}-${Date.now()}`,
    prompt: promptText,
    interpretation: analysis.interpretation,
    tasks: analysis.tasks.map((t) => t.description),
    success: !blocked,
    timestamp: Date.now(),
    duration: Date.now() - start,
    toolsUsed: ['AGIHook'],
    errors: blocked ? risk.reasons : undefined,
  });

  return {
    success: true,
    decision,
    blocked,
    reason: blocked
      ? `High-risk content detected: ${risk.reasons.join('; ') || 'unspecified'}`
      : `AGI analysis: ${analysis.interpretation} (risk ${(risk.score * 100).toFixed(0)}%)`,
    output: formatPromptHookOutput(analysis, risk),
  };
}

/**
 * Execute a single hook
 */
async function executeHook(
  hook: HookDefinition,
  context: HookContext
): Promise<HookResult> {
  switch (hook.type) {
    case 'command':
      return executeCommandHook(hook, context);
    case 'prompt':
      return executePromptHook(hook, context);
    default:
      return { success: false, error: `Unknown hook type: ${hook.type}` };
  }
}

/**
 * HooksManager class for managing and executing hooks
 */
export class HooksManager {
  private hooks: HooksConfig;
  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
    this.hooks = loadHooks(workingDir);
  }

  /**
   * Reload hooks from settings files
   */
  reload(): void {
    this.hooks = loadHooks(this.workingDir);
  }

  /**
   * Check if hooks are configured for an event
   */
  hasHooks(event: HookEvent): boolean {
    return Boolean(this.hooks[event]?.length);
  }

  /**
   * Get all hooks for an event
   */
  getHooks(event: HookEvent): HookDefinition[] {
    return this.hooks[event] ?? [];
  }

  /**
   * Execute all matching hooks for an event
   */
  async executeHooks(context: HookContext): Promise<HookResult[]> {
    const eventHooks = this.hooks[context.event] ?? [];
    const results: HookResult[] = [];

    for (const hook of eventHooks) {
      if (matchesHook(hook, context)) {
        const result = await executeHook(hook, context);
        results.push(result);

        // Stop on blocking result
        if (result.blocked) {
          break;
        }
      }
    }

    return results;
  }

  /**
   * Execute pre-tool hooks and check if tool should proceed
   */
  async executePreToolHooks(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ allowed: boolean; results: HookResult[] }> {
    const context: HookContext = {
      event: 'PreToolUse',
      toolName,
      toolArgs: args,
      workingDir: this.workingDir,
    };

    const results = await this.executeHooks(context);

    // Check if any hook blocked the operation
    const blocked = results.some((r) => r.blocked || r.decision === 'deny');

    return { allowed: !blocked, results };
  }

  /**
   * Execute post-tool hooks
   */
  async executePostToolHooks(
    toolName: string,
    args: Record<string, unknown>,
    result: string
  ): Promise<HookResult[]> {
    const context: HookContext = {
      event: 'PostToolUse',
      toolName,
      toolArgs: args,
      toolResult: result,
      workingDir: this.workingDir,
    };

    return this.executeHooks(context);
  }

  /**
   * Execute user prompt hooks
   */
  async executeUserPromptHooks(
    userInput: string
  ): Promise<{ allowed: boolean; results: HookResult[] }> {
    const context: HookContext = {
      event: 'UserPromptSubmit',
      userInput,
      workingDir: this.workingDir,
    };

    const results = await this.executeHooks(context);
    const blocked = results.some((r) => r.blocked || r.decision === 'deny');

    return { allowed: !blocked, results };
  }

  /**
   * Execute session lifecycle hooks
   */
  async executeSessionHook(
    event: 'SessionStart' | 'SessionEnd',
    sessionId: string
  ): Promise<HookResult[]> {
    const context: HookContext = {
      event,
      sessionId,
      workingDir: this.workingDir,
    };

    return this.executeHooks(context);
  }
}

/**
 * Create a hooks manager for the given working directory
 */
export function createHooksManager(workingDir: string): HooksManager {
  return new HooksManager(workingDir);
}
