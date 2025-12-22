import type { AgentController } from '../runtime/agentController.js';
import {
  RepoUpgradeOrchestrator,
  buildRepoWidePlan,
  REPO_UPGRADE_MODE_DEFINITIONS,
  extractRewardSignals,
  calculateRewardScore,
  type RepoUpgradeMode,
  type RepoUpgradeReport,
  type RepoUpgradeStep,
  type UpgradeStepExecutionInput,
  type UpgradeStepResult,
  type ValidationRunResult,
  type UpgradeModuleReport,
  type UpgradeVariant,
} from '../core/repoUpgradeOrchestrator.js';
import { GitWorktreeManager, type CrossVariantComparison } from '../core/gitWorktreeManager.js';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execCallback);

export interface RepoUpgradeFlowOptions {
  controller: AgentController;
  workingDir: string;
  mode: RepoUpgradeMode;
  continueOnFailure?: boolean;
  additionalScopes?: string[];
  objective?: string;
  onEvent?: (event: { type: string; data?: Record<string, unknown> }) => void;
  /** Callback to receive raw agent events (tool calls, streaming, thinking) for UI display. */
  onAgentEvent?: (event: import('../contracts/v1/agent.js').AgentEventUnion) => void;
  validationMode?: 'auto' | 'ask' | 'skip';
  confirmValidation?: (moduleId: string, commands: string[]) => Promise<boolean>;
  /** Create separate variant workspaces (git worktrees or copies) for dual RL. */
  enableVariantWorktrees?: boolean;
  /** Optional explicit variant workspace roots (overrides automatic creation). */
  variantWorkspaceRoots?: Partial<Record<UpgradeVariant, string>>;
  /** Optional upgrade/change-management policy to display in prompts and reports. */
  repoPolicy?: string;
  /** Enable parallel variant execution in dual-RL modes. */
  parallelVariants?: boolean;
  /** Apply winning variant's changes to primary workspace after completion. Defaults to true for tournament mode. */
  applyWinnerChanges?: boolean;
  /** Custom reward weights for scoring (uses defaults if not provided). */
  rewardWeights?: import('../core/repoUpgradeOrchestrator.js').RewardWeights;
  /** Optional factory to create variant-specific controllers for parallel execution. */
  createVariantController?: (variant: UpgradeVariant, workspaceRoot: string) => Promise<AgentController>;
}

/** Extended report with cross-variant comparison data */
export interface EnhancedRepoUpgradeReport extends RepoUpgradeReport {
  /** Comparison of changes between variants */
  variantComparison?: CrossVariantComparison;
  /** Whether winner's changes were applied to primary */
  winnerChangesApplied?: boolean;
  /** Which variant won overall (most step wins) */
  overallWinner?: UpgradeVariant;
}

export async function runRepoUpgradeFlow(options: RepoUpgradeFlowOptions): Promise<EnhancedRepoUpgradeReport> {
  const plan = buildRepoWidePlan(options.workingDir, options.additionalScopes);
  const modeDefinition = REPO_UPGRADE_MODE_DEFINITIONS[options.mode];
  const isDualMode = modeDefinition.variants.includes('refiner');
  const isTournamentMode = options.mode === 'dual-rl-tournament';

  // Initialize GitWorktreeManager for dual-RL modes with worktree support
  let worktreeManager: GitWorktreeManager | null = null;
  let variantWorkspaceRoots = options.variantWorkspaceRoots;

  if (isDualMode && options.enableVariantWorktrees && !variantWorkspaceRoots) {
    worktreeManager = new GitWorktreeManager({
      baseDir: options.workingDir,
      sessionId: `upgrade-${Date.now()}`,
      createBranches: true,
      branchPrefix: 'agi-upgrade',
    });

    await worktreeManager.initialize();

    // Create refiner workspace and wait for completion
    await worktreeManager.createVariantWorkspace('refiner');

    // Get workspace roots after creation is complete
    variantWorkspaceRoots = worktreeManager.getWorkspaceRoots();

    options.onEvent?.({
      type: 'upgrade.worktrees.created',
      data: {
        roots: variantWorkspaceRoots,
        supportsWorktrees: worktreeManager.supportsWorktrees,
        baseCommit: worktreeManager.baseCommitHash,
      },
    });
  }

  // Cache for variant-specific controllers (for parallel execution)
  const variantControllers = new Map<UpgradeVariant, AgentController>();
  variantControllers.set('primary', options.controller);

  // Get or create controller for a specific variant
  const getVariantController = async (variant: UpgradeVariant, workspaceRoot?: string): Promise<AgentController> => {
    // Use cached controller if available
    if (variantControllers.has(variant)) {
      return variantControllers.get(variant)!;
    }

    // For refiner in parallel mode, create a new controller if factory is provided
    if (variant === 'refiner' && options.createVariantController && workspaceRoot) {
      const controller = await options.createVariantController(variant, workspaceRoot);
      variantControllers.set(variant, controller);
      return controller;
    }

    // Fallback to primary controller (sequential mode)
    return options.controller;
  };

  // Create orchestrator with variant-aware executor
  const orchestrator = new RepoUpgradeOrchestrator(async (input) => {
    const controller = await getVariantController(input.variant, input.workspaceRoot);
    return executeUpgradeStep(controller, input, options.onAgentEvent, options.rewardWeights);
  });

  if (options.onEvent) {
    orchestrator.onEvent((event) => options.onEvent?.(event));
  }

  // Determine parallel variant execution
  const parallelVariants = options.parallelVariants ?? modeDefinition.parallelVariants ?? false;

  const report = await orchestrator.run(plan, {
    mode: options.mode,
    continueOnFailure: options.continueOnFailure,
    objective: options.objective,
    variantWorkspaceRoots,
    repoPolicy: options.repoPolicy,
    parallelVariants,
  });

  // Build enhanced report
  const enhancedReport: EnhancedRepoUpgradeReport = {
    ...report,
    validationsExecuted: false,
  };

  // Compute cross-variant comparison if we have a worktree manager
  if (worktreeManager && isDualMode) {
    try {
      const comparison = await worktreeManager.compareVariants();
      if (comparison) {
        enhancedReport.variantComparison = comparison;
      }
    } catch {
      // Comparison is optional, continue without it
    }

    // Determine overall winner and apply changes
    const overallWinner = determineOverallWinner(report);
    enhancedReport.overallWinner = overallWinner;

    // Default applyWinnerChanges to true for tournament mode
    const shouldApplyWinner = options.applyWinnerChanges ?? isTournamentMode;

    if (shouldApplyWinner && overallWinner === 'refiner') {
      try {
        const applied = await worktreeManager.applyWinnerChanges('refiner');
        enhancedReport.winnerChangesApplied = applied;
        options.onEvent?.({
          type: 'upgrade.winner.applied',
          data: { winner: 'refiner', applied },
        });
      } catch {
        enhancedReport.winnerChangesApplied = false;
      }
    } else if (shouldApplyWinner && overallWinner === 'primary') {
      // Primary is already in the main workspace, nothing to apply
      enhancedReport.winnerChangesApplied = true;
    }

    // Cleanup worktrees
    try {
      await worktreeManager.cleanup();
      options.onEvent?.({
        type: 'upgrade.worktrees.cleaned',
        data: {},
      });
    } catch {
      // Best effort cleanup
    }
  }

  // Run validations
  const validationMode = options.validationMode ?? 'ask';
  if (validationMode === 'skip') {
    return enhancedReport;
  }

  const enrichedModules: typeof report.modules = [];
  const validationArtifacts: ValidationRunResult[] = [];

  for (const module of report.modules) {
    const validations = await runValidationsForModule(
      module,
      options.workingDir,
      validationMode,
      options.confirmValidation
    );
    validationArtifacts.push(...validations);
    enrichedModules.push({ ...module, validations });
  }

  return {
    ...enhancedReport,
    modules: enrichedModules,
    validationArtifacts,
    validationsExecuted: validationMode === 'auto',
  };
}

/**
 * Determine which variant won overall based on step wins.
 */
function determineOverallWinner(report: RepoUpgradeReport): UpgradeVariant {
  const stats = report.variantStats;
  if (stats.refinerWins > stats.primaryWins) {
    return 'refiner';
  }
  return 'primary';
}

/**
 * Build the prompt for a repo upgrade step. Tailored to primary vs refiner variants.
 */
function buildStepPrompt(input: UpgradeStepExecutionInput): string {
  const lines: string[] = [];
  const modeDefinition = REPO_UPGRADE_MODE_DEFINITIONS[input.mode];
  const variantLabel = input.variant === 'refiner' ? 'Refiner pass' : 'Primary pass';
  const variantGuidance = modeDefinition?.variantGuidance?.[input.variant];

  lines.push(`Repository upgrade (${modeDefinition?.label ?? input.mode})`);
  if (modeDefinition?.description) {
    lines.push(modeDefinition.description);
  }
  lines.push(variantGuidance ? `${variantLabel}: ${variantGuidance}` : variantLabel);
  if (input.repoPolicy) {
    lines.push(`Policy: ${input.repoPolicy}`);
  }
  if (input.workspaceRoot) {
    lines.push(`Workspace: ${input.workspaceRoot}`);
  }
  lines.push(`Module: ${input.module.label}`);
  lines.push(`Scope: ${formatScope(input.module.scope)}`);
  lines.push(`Step: [${input.step.intent}] ${input.step.description}`);

  if (input.step.prompt) {
    lines.push(`Guidance: ${input.step.prompt}`);
  }

  if (input.module.codemodCommands?.length) {
    lines.push(`Suggested codemods: ${input.module.codemodCommands.join(' | ')}`);
  }

  if (input.module.validationCommands?.length) {
    lines.push(`Suggested checks: ${input.module.validationCommands.join(' | ')}`);
  }

  if (input.previousResult?.summary) {
    lines.push(`Previous summary: ${truncate(input.previousResult.summary, 240)}`);
  }
  if (input.variant === 'refiner' && input.previousResult?.detail) {
    lines.push(`Previous detail: ${truncate(input.previousResult.detail, 320)}`);
  }

  lines.push(
    'Deliver a concise summary of actions taken and highlight remaining risks. Keep edits within the module scope and prefer commands/tests that run quickly and locally.'
  );
  return lines.join('\n');
}

async function executeUpgradeStep(
  controller: AgentController,
  input: UpgradeStepExecutionInput,
  onAgentEvent?: (event: import('../contracts/v1/agent.js').AgentEventUnion) => void,
  rewardWeights?: import('../core/repoUpgradeOrchestrator.js').RewardWeights
): Promise<UpgradeStepResult> {
  const prompt = buildStepPrompt(input);
  const start = Date.now();

  let content = '';
  let success = true;
  let errorText: string | undefined;
  const toolOutputs: string[] = [];

  try {
    for await (const event of controller.send(prompt)) {
      // Forward all events to UI callback for display (thoughts, tools, streaming)
      onAgentEvent?.(event);

      if (event.type === 'message.delta') {
        content += event.content;
      } else if (event.type === 'message.complete') {
        content += event.content;
      } else if (event.type === 'tool.complete') {
        // Collect tool outputs for enhanced scoring
        if (typeof event.result === 'string') {
          toolOutputs.push(event.result);
        }
      } else if (event.type === 'error') {
        success = false;
        errorText = typeof event.error === 'string' ? event.error : 'unknown error';
      }
    }
  } catch (error) {
    success = false;
    errorText = error instanceof Error ? error.message : String(error);
  }

  const durationMs = Date.now() - start;
  const summary = summarizeResult(content || errorText || '');
  const detail = content?.trim() || errorText || summary;

  // Enhanced scoring using multi-signal reward system
  const allOutput = [content, ...toolOutputs].join('\n');
  const noOutput = !content.trim() && toolOutputs.length === 0;
  const signals = noOutput ? { executionSuccess: 0, testsPassed: 0, staticAnalysis: 0, codeQuality: 0 } : extractRewardSignals(allOutput, durationMs);

  // Override execution success based on actual success
  signals.executionSuccess = success && !noOutput ? 1 : 0;

  // Calculate composite score
  const score = success && !noOutput ? calculateRewardScore(signals, rewardWeights) : 0;

  return {
    success,
    summary,
    detail,
    score,
    rewardSignals: signals,
    durationMs,
    execution: {
      success,
      output: summary,
      duration: durationMs,
      command: `upgrade:${input.module.id}:${input.step.id}:${input.variant}`,
      error: success ? undefined : (errorText || summary),
    },
    findings: extractFindings(allOutput, input),
    notes: buildNotes(input.step, success, summary),
  };
}

/**
 * Extract findings (warnings, errors, recommendations) from execution output.
 */
function extractFindings(
  output: string,
  input: UpgradeStepExecutionInput
): import('../core/unifiedOrchestrator.js').Finding[] {
  const findings: import('../core/unifiedOrchestrator.js').Finding[] = [];

  // Look for deprecation warnings
  const deprecationMatches = output.matchAll(/deprecat(?:ed|ion)[:\s]+([^\n]+)/gi);
  for (const match of deprecationMatches) {
    findings.push({
      severity: 'medium',
      category: 'deprecation',
      title: `Deprecation in ${input.module.id}`,
      description: match[1]?.trim(),
      recommendation: 'Update to non-deprecated API',
    });
  }

  // Look for security warnings
  const securityMatches = output.matchAll(/(?:security|vulnerability|CVE)[:\s]+([^\n]+)/gi);
  for (const match of securityMatches) {
    findings.push({
      severity: 'high',
      category: 'security',
      title: `Security concern in ${input.module.id}`,
      description: match[1]?.trim(),
      recommendation: 'Review and address security issue',
    });
  }

  // Look for breaking changes
  if (/breaking\s*change/i.test(output)) {
    findings.push({
      severity: 'high',
      category: 'breaking-change',
      title: `Breaking change detected in ${input.module.id}`,
      recommendation: 'Verify compatibility and update dependents',
    });
  }

  return findings;
}

function summarizeResult(text: string): string {
  if (!text.trim()) return 'No output';
  const sanitized = text.replace(/\s+/g, ' ').trim();
  return truncate(sanitized, 320);
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 3)}...`;
}

function formatScope(scopes: string[]): string {
  if (!scopes.length) return '(no scope)';
  if (scopes.length === 1) return scopes[0] ?? '(no scope)';
  return scopes.slice(0, 3).join(' | ') + (scopes.length > 3 ? ' …' : '');
}

function buildNotes(step: RepoUpgradeStep, success: boolean, summary: string): string[] {
  const notes: string[] = [];
  if (!success) {
    notes.push('Step failed');
  }
  if (step.intent === 'verify' && !/test|verify|lint/i.test(summary)) {
    notes.push('Verification step did not mention tests/lint');
  }
  return notes;
}

async function runValidationsForModule(
  module: UpgradeModuleReport,
  workingDir: string,
  mode: 'auto' | 'ask',
  confirm?: (moduleId: string, commands: string[]) => Promise<boolean>
): Promise<ValidationRunResult[]> {
  const commands = module.validationCommands || [];
  if (commands.length === 0) {
    return [];
  }

  if (module.status === 'skipped') {
    return commands.map((command) => ({
      command,
      success: false,
      output: '',
      error: 'Skipped (module skipped)',
      durationMs: 0,
      skipped: true,
      reason: 'module-skipped',
    }));
  }

  if (mode === 'ask') {
    const approved = confirm ? await confirm(module.id, commands) : false;
    if (!approved) {
      return commands.map((command) => ({
        command,
        success: false,
        output: '',
        error: 'Skipped (confirmation required)',
        durationMs: 0,
        skipped: true,
        reason: 'confirmation-required',
      }));
    }
  }

  const results: ValidationRunResult[] = [];
  for (const command of commands) {
    const start = Date.now();
    try {
      const { stdout, stderr } = await exec(command, { cwd: workingDir, maxBuffer: 2 * 1024 * 1024 });
      const output = [stdout, stderr].filter(Boolean).join('\n').trim();
      results.push({
        command,
        success: true,
        output,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
      results.push({
        command,
        success: false,
        output,
        error: err.message ?? 'Validation failed',
        durationMs: Date.now() - start,
      });
    }
  }

  return results;
}
