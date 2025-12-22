import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { UnifiedOrchestrator, type ExecutionResult, type Finding, type OperationReport } from './unifiedOrchestrator.js';
import { ParallelExecutor, createTask, type ParallelTask } from './parallelExecutor.js';
import {
  DEFAULT_HUMAN_REWARD_WEIGHTS,
  runDualTournament,
  type RankedCandidate,
  type TournamentCandidate,
  type TournamentOutcome,
  type TournamentTask,
} from './dualTournament.js';
import { resolveWinner as resolveWinnerStrategy } from './winnerStrategy.js';

export type RepoUpgradeMode = 'single-continuous' | 'dual-rl-continuous' | 'dual-rl-tournament';
export type UpgradeVariant = 'primary' | 'refiner';

/**
 * Reward signal components for multi-objective RL scoring.
 * Each signal is normalized to [0, 1] range.
 */
export interface RewardSignals {
  /** Did the execution complete without errors? (0 or 1) */
  executionSuccess: number;
  /** Did tests pass? (0-1, partial credit for some passing) */
  testsPassed: number;
  /** Did lint/type checks pass? (0-1) */
  staticAnalysis: number;
  /** Code quality metrics (complexity reduction, no new warnings) */
  codeQuality: number;
  /** How minimal/surgical were the changes? (inverse of blast radius) */
  blastRadius: number;
  /** Confidence from LLM self-assessment keywords */
  selfAssessment: number;
  /** Bonus for faster execution (relative to baseline) */
  speedBonus: number;
}

/**
 * Weights for combining reward signals into final score.
 * Tuned for safe, high-quality upgrades.
 */
export interface RewardWeights {
  executionSuccess: number;
  testsPassed: number;
  staticAnalysis: number;
  codeQuality: number;
  blastRadius: number;
  selfAssessment: number;
  speedBonus: number;
}

export const DEFAULT_REWARD_WEIGHTS: RewardWeights = {
  executionSuccess: 0.25,
  testsPassed: 0.30,
  staticAnalysis: 0.15,
  codeQuality: 0.10,
  blastRadius: 0.10,
  selfAssessment: 0.05,
  speedBonus: 0.05,
};

/**
 * Calculate composite reward score from individual signals.
 */
export function calculateRewardScore(
  signals: Partial<RewardSignals>,
  weights: RewardWeights = DEFAULT_REWARD_WEIGHTS
): number {
  let score = 0;
  let totalWeight = 0;

  for (const [key, weight] of Object.entries(weights)) {
    const signal = signals[key as keyof RewardSignals];
    if (typeof signal === 'number') {
      score += signal * weight;
      totalWeight += weight;
    }
  }

  return totalWeight > 0 ? score / totalWeight : 0;
}

/**
 * Extract reward signals from execution output text.
 */
export function extractRewardSignals(
  output: string,
  durationMs: number,
  baselineDurationMs = 60000
): Partial<RewardSignals> {
  const lower = output.toLowerCase();
  const signals: Partial<RewardSignals> = {};
  const clamp = (value: number) => Math.max(0, Math.min(1, value));

  // Execution success - no error keywords
  const hasErrors = /\b(error|exception|failed|failure|fatal)\b/i.test(output);
  signals.executionSuccess = hasErrors ? 0 : 1;

  // Tests passed - look for test result patterns
  const testMatch = output.match(/(\d+)\s*(?:tests?\s*)?pass(?:ed|ing)?/i);
  const failMatch = output.match(/(\d+)\s*(?:tests?\s*)?fail(?:ed|ing)?/i);
  if (testMatch || failMatch) {
    const passed = parseInt(testMatch?.[1] ?? '0', 10);
    const failed = parseInt(failMatch?.[1] ?? '0', 10);
    const total = passed + failed;
    signals.testsPassed = total > 0 ? passed / total : (/pass|success|✓/i.test(lower) ? 1 : 0.5);
  } else if (/all tests pass|tests passing|✓.*test/i.test(lower)) {
    signals.testsPassed = 1;
  }

  // Static analysis - lint/type check patterns
  if (/lint.*pass|no.*lint.*error|eslint.*clean|tsc.*success/i.test(lower)) {
    signals.staticAnalysis = 1;
  } else if (/lint.*warn|eslint.*warn/i.test(lower)) {
    signals.staticAnalysis = 0.7;
  } else if (/lint.*error|type.*error|eslint.*error/i.test(lower)) {
    signals.staticAnalysis = 0.3;
  }

  // Code quality heuristics (TODO/HACK penalties vs cleanup/refactor bonuses)
  if (/todo|hack|workaround|temporary fix/i.test(lower)) {
    signals.codeQuality = 0.45;
  } else if (/refactor|cleanup|simplif|reducing complexity|streamlined/i.test(lower)) {
    signals.codeQuality = Math.max(signals.codeQuality ?? 0, 0.65);
  }

  // Blast radius approximation from diff summaries / dependency adds
  const diffMatch = output.match(/(\d+)\s+files?\s+changed/i);
  if (diffMatch) {
    const filesChanged = parseInt(diffMatch[1] ?? '0', 10);
    signals.blastRadius = clamp(1 - Math.min(1, filesChanged / 8));
  }
  if (/npm install|yarn add|pnpm add|pip install|go get|cargo add/i.test(lower)) {
    signals.blastRadius = clamp((signals.blastRadius ?? 0.6) - 0.15);
  }

  // Self-assessment from confidence keywords
  if (/confident|verified|validated|confirmed/i.test(lower)) {
    signals.selfAssessment = 0.9;
  } else if (/likely|probably|should work/i.test(lower)) {
    signals.selfAssessment = 0.6;
  } else if (/uncertain|unclear|might|may/i.test(lower)) {
    signals.selfAssessment = 0.3;
  }

  // Speed bonus - faster than baseline gets bonus
  if (durationMs > 0 && baselineDurationMs > 0) {
    const speedRatio = baselineDurationMs / durationMs;
    signals.speedBonus = Math.min(1, Math.max(0, (speedRatio - 0.5) / 1.5));
  }

  return signals;
}

export interface RepoUpgradeModeDefinition {
  id: RepoUpgradeMode;
  label: string;
  description: string;
  /** Ordered list of variants to execute for this mode */
  variants: UpgradeVariant[];
  /** Guidance to inject into prompts per variant */
  variantGuidance?: Partial<Record<UpgradeVariant, string>>;
  /** Bias to apply to the refiner when scores are tied (encourages RL exploration) */
  refinerBias?: number;
  /** Enable parallel variant execution (requires isolated workspaces) */
  parallelVariants?: boolean;
}

export const REPO_UPGRADE_MODE_DEFINITIONS: Record<RepoUpgradeMode, RepoUpgradeModeDefinition> = {
  'single-continuous': {
    id: 'single-continuous',
    label: 'Single continuous',
    description: 'Single-pass deterministic execution focused on minimal blast radius.',
    variants: ['primary'],
    variantGuidance: {
      primary: 'Plan and execute the best possible upgrade in one pass. Keep edits surgical and runnable.',
    },
    parallelVariants: false,
  },
  'dual-rl-continuous': {
    id: 'dual-rl-continuous',
    label: 'Dual-agent RL continuous',
    description: 'Primary + refiner loop where the refiner competes to improve safety and quality. Refiner sees primary output.',
    variants: ['primary', 'refiner'],
    variantGuidance: {
      primary: 'Primary pass sets the baseline plan and changes with conservative scope and runnable checks.',
      refiner:
        'RL refiner critiques the primary, fixes gaps, tightens safety, and only repeats steps if they materially improve the result.',
    },
    refinerBias: 0.05,
    parallelVariants: false, // Sequential so refiner can see primary's work
  },
  'dual-rl-tournament': {
    id: 'dual-rl-tournament',
    label: 'Dual-agent RL tournament',
    description: 'Primary and refiner compete in parallel with isolated workspaces. Best result wins per step.',
    variants: ['primary', 'refiner'],
    variantGuidance: {
      primary: 'Execute the upgrade with focus on correctness and test coverage. You are competing against another agent.',
      refiner:
        'Execute the upgrade with focus on safety and minimal changes. You are competing against another agent.',
    },
    refinerBias: 0.03, // Lower bias since both start fresh
    parallelVariants: true, // Run in parallel with git worktree isolation
  },
};

export type UpgradeStepIntent = 'analyze' | 'upgrade' | 'verify' | 'cleanup';

export interface RepoUpgradeStep {
  id: string;
  intent: UpgradeStepIntent;
  description: string;
  /** Optional instruction or prompt to feed into the executor */
  prompt?: string;
}

export interface RepoUpgradeModule {
  id: string;
  label: string;
  description: string;
  scope: string[];
  /** Suggested codemod commands to run for this module (display only, not executed automatically). */
  codemodCommands?: string[];
  /** Suggested validation commands to run for this module (display only, not executed automatically). */
  validationCommands?: string[];
  steps: RepoUpgradeStep[];
}

export interface RepoUpgradePlan {
  modules: RepoUpgradeModule[];
}

export interface UpgradeStepExecutionInput {
  module: RepoUpgradeModule;
  step: RepoUpgradeStep;
  /** Which path we are taking: single-pass primary or the dual RL refiner */
  variant: UpgradeVariant;
  mode: RepoUpgradeMode;
  previousResult?: UpgradeStepResult;
  workspaceRoot?: string;
  repoPolicy?: string;
}

export interface UpgradeStepResult {
  success: boolean;
  summary: string;
  detail?: string;
  score?: number;
  /** Tournament-derived human accuracy (1=best, 0=worst across variants) */
  humanAccuracy?: number;
  rewardSignals?: Partial<RewardSignals>;
  /** Tournament breakdown for dual competitions */
  tournament?: RankedCandidate;
  durationMs?: number;
  execution?: ExecutionResult;
  findings?: Finding[];
  notes?: string[];
}

export interface UpgradeStepOutcome {
  stepId: string;
  intent: UpgradeStepIntent;
  description: string;
  primary: UpgradeStepResult;
  refiner?: UpgradeStepResult;
  winner: UpgradeStepResult;
  winnerVariant: UpgradeVariant;
  status: 'completed' | 'failed';
}

export interface UpgradeModuleReport {
  id: string;
  label: string;
  scope: string[];
  codemodCommands?: string[];
  validationCommands?: string[];
  steps: UpgradeStepOutcome[];
  status: 'completed' | 'failed' | 'skipped';
  validations?: ValidationRunResult[];
}

export interface RepoUpgradeReport extends OperationReport {
  mode: RepoUpgradeMode;
  continueOnFailure: boolean;
  modules: UpgradeModuleReport[];
  validationArtifacts?: ValidationRunResult[];
  /** True when validation commands were executed instead of just suggested */
  validationsExecuted?: boolean;
  variantStats: VariantWinStats;
  /** Paths used per variant when running dual workspaces (for git/worktree integrations). */
  variantWorkspaceRoots?: Partial<Record<UpgradeVariant, string>>;
  /** Optional policy that guided the run (e.g., upgrade or change-management policy). */
  repoPolicy?: string;
}

export interface RepoUpgradeRunOptions {
  objective?: string;
  mode: RepoUpgradeMode;
  continueOnFailure?: boolean;
  /** Optional per-variant workspace roots when running dual RL with separate repos. */
  variantWorkspaceRoots?: Partial<Record<UpgradeVariant, string>>;
  /** Optional policy/guideline string to surface in prompts and reports. */
  repoPolicy?: string;
  /** Enable parallel module processing (default: false for safety). */
  parallelModules?: boolean;
  /** Maximum concurrent modules when parallel processing is enabled (default: 3). */
  parallelModuleConcurrency?: number;
  /** Enable parallel variant execution in dual-RL mode (default: true). */
  parallelVariants?: boolean;
}

export type UpgradeStepExecutor = (input: UpgradeStepExecutionInput) => Promise<UpgradeStepResult>;

export interface ValidationRunResult {
  command: string;
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
  skipped?: boolean;
  reason?: string;
}

export interface VariantWinStats {
  primaryWins: number;
  refinerWins: number;
  /** Number of steps where scores were effectively tied and bias picked the winner */
  ties: number;
  totalSteps: number;
}

/**
 * Build a repo-wide upgrade plan using common directories. Falls back to a single
 * catch-all module when no known scopes are found.
 */
export function buildRepoWidePlan(workspaceRoot: string, additionalScopes: string[] = []): RepoUpgradePlan {
  const areas: Array<{
    id: string;
    label: string;
    description: string;
    scope: string[];
    candidates: string[];
    codemodCommands?: string[];
    validationCommands?: string[];
  }> = [
    {
      id: 'source',
      label: 'Source',
      description: 'Core application and library code.',
      scope: ['src/**/*', 'lib/**/*'],
      candidates: ['src', 'lib'],
      codemodCommands: ['npx jscodeshift -t <transform> src'],
      validationCommands: ['npm run build', 'npm test'],
    },
    {
      id: 'tests',
      label: 'Tests',
      description: 'Unit, integration, and smoke tests.',
      scope: ['test/**/*', '__tests__/**/*'],
      candidates: ['test', '__tests__'],
      validationCommands: ['npm test -- --runInBand', 'npm run lint'],
    },
    {
      id: 'docs',
      label: 'Docs',
      description: 'Documentation and guides.',
      scope: ['docs/**/*', 'README.md'],
      candidates: ['docs', 'README.md'],
    },
    {
      id: 'scripts',
      label: 'Tooling Scripts',
      description: 'Build, migration, and maintenance scripts.',
      scope: ['scripts/**/*'],
      candidates: ['scripts'],
      validationCommands: ['npm run lint -- scripts/**/*.ts'],
    },
    {
      id: 'agents',
      label: 'Agents',
      description: 'Agent rules and behaviors.',
      scope: ['agents/**/*'],
      candidates: ['agents'],
      validationCommands: ['npm run build'],
    },
    {
      id: 'skills',
      label: 'Skills',
      description: 'Skill packs and reusable automation.',
      scope: ['skills/**/*'],
      candidates: ['skills'],
      validationCommands: ['npm run build'],
    },
    {
      id: 'examples',
      label: 'Examples',
      description: 'Example flows and templates.',
      scope: ['examples/**/*'],
      candidates: ['examples'],
    },
    {
      id: 'configs',
      label: 'Configuration',
      description: 'Configuration and deployment settings.',
      scope: ['config/**/*', '*.config.*', '*.rc', '*.json'],
      candidates: ['config'],
    },
  ];

  for (const extra of additionalScopes) {
    if (!extra?.trim()) continue;
    const slug = extra.replace(/[^\w]/g, '-').toLowerCase() || 'custom';
    areas.push({
      id: `custom-${slug}`,
      label: `Custom: ${extra}`,
      description: `User-specified scope: ${extra}`,
      scope: [`${extra}/**/*`],
      candidates: [extra],
    });
  }

  const modules: RepoUpgradeModule[] = [];
  const workspaceModules = detectWorkspaceModules(workspaceRoot);
  modules.push(...workspaceModules);

  for (const area of areas) {
    const matches = area.candidates.some((candidate) => existsSync(join(workspaceRoot, candidate)));
    if (!matches) {
      continue;
    }
    modules.push({
      id: area.id,
      label: area.label,
      description: area.description,
      scope: area.scope,
      codemodCommands: area.codemodCommands,
      validationCommands: area.validationCommands,
      steps: buildDefaultSteps(area.id),
    });
  }

  if (modules.length === 0) {
    modules.push({
      id: 'repo-wide',
      label: 'Repository',
      description: 'Fallback repo-wide upgrade module.',
      scope: ['**/*'],
      steps: buildDefaultSteps('repo'),
    });
  }

  return { modules };
}

function detectWorkspaceModules(workspaceRoot: string): RepoUpgradeModule[] {
  const pkgPath = join(workspaceRoot, 'package.json');
  if (!existsSync(pkgPath)) {
    return [];
  }

  let workspaces: string[] = [];
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    workspaces = parseWorkspaceField(pkg?.workspaces);
  } catch {
    return [];
  }

  if (!workspaces.length) {
    return [];
  }

  const modules: RepoUpgradeModule[] = [];
  const seen = new Set<string>();

  for (const pattern of workspaces) {
    const paths = expandWorkspacePattern(workspaceRoot, pattern);
    for (const relPath of paths) {
      if (seen.has(relPath)) {
        continue;
      }
      seen.add(relPath);

      const cleanPath = relPath.replace(/\/+$/, '');
      const name = cleanPath.split('/').filter(Boolean).pop() ?? cleanPath;
      const normalizedPath = cleanPath.replace(/[/\\]+/g, '-');
      const slug = `workspace-${normalizedPath.replace(/[^\w-]+/g, '-').replace(/-+/g, '-').toLowerCase() || 'default'}`;

      modules.push({
        id: slug,
        label: `Workspace: ${name}`,
        description: `Upgrade tasks scoped to workspace "${name}" (${cleanPath}).`,
        scope: [`${cleanPath}/**/*`],
        validationCommands: [
          `npm test --workspace ${name} --if-present`,
          `npm run lint --workspace ${name} --if-present`,
        ],
        steps: buildDefaultSteps(slug),
      });
    }
  }

  return modules;
}

function parseWorkspaceField(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
  }
  if (value && typeof value === 'object') {
    const record = value as { packages?: unknown };
    if (Array.isArray(record.packages)) {
      return record.packages.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
    }
  }
  return [];
}

function expandWorkspacePattern(workspaceRoot: string, pattern: string): string[] {
  const normalized = pattern.trim();
  if (!normalized) return [];

  if (!normalized.includes('*')) {
    const target = join(workspaceRoot, normalized);
    return existsSync(target) ? [normalized] : [];
  }

  const base = normalized.split('*')[0]?.replace(/\/+$/, '') ?? '';
  if (!base) return [];

  const baseDir = join(workspaceRoot, base);
  if (!existsSync(baseDir)) return [];

  try {
    const entries = readdirSync(baseDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => `${base}/${entry.name}`);
  } catch {
    return [];
  }
}

export class RepoUpgradeOrchestrator extends UnifiedOrchestrator {
  private readonly executor: UpgradeStepExecutor;
  private variantWorkspaceRoots: Partial<Record<UpgradeVariant, string>> | undefined;
  private repoPolicy: string | undefined;
  private parallelExecutor: ParallelExecutor | null = null;
  private objective: string | undefined;
  static repoTypeTelemetry: Map<string, { winsPrimary: number; winsRefiner: number }> = new Map();
  /** Disable persisted telemetry via env or flag */
  static disableTelemetryPersistence = process.env.AGI_DISABLE_RL_TELEMETRY === '1';

  constructor(executor: UpgradeStepExecutor) {
    super();
    this.executor = executor;
  }

  /**
   * Get or create a parallel executor instance
   */
  private getParallelExecutor(concurrency: number): ParallelExecutor {
    if (!this.parallelExecutor) {
      this.parallelExecutor = new ParallelExecutor({
        maxConcurrency: concurrency,
        continueOnFailure: true,
        onTaskEvent: (event) => {
          this.emit({
            type: `parallel.${event.type}`,
            timestamp: event.timestamp,
            data: event.data,
          });
        },
      });
    }
    return this.parallelExecutor;
  }

  /**
   * Execute the repo-wide plan using either single continuous or dual RL continuous mode.
   * Supports parallel module processing and parallel variant execution for improved performance.
   */
  async run(plan: RepoUpgradePlan, options: RepoUpgradeRunOptions): Promise<RepoUpgradeReport> {
    const mode = options.mode;
    const continueOnFailure = options.continueOnFailure ?? true;
    const objective = options.objective ?? 'Repository-wide source code upgrade';
    const modeDefinition = getModeDefinition(mode);
    this.objective = objective;
    const parallelModules = options.parallelModules ?? false;
    const parallelModuleConcurrency = options.parallelModuleConcurrency ?? 3;
    const parallelVariants = options.parallelVariants ?? true;
    this.variantWorkspaceRoots = options.variantWorkspaceRoots;
    this.repoPolicy = options.repoPolicy ?? undefined;

    // Reset state per run to keep reports clean
    this.results = [];
    this.findings = [];
    this.parallelExecutor = null;

    const variantStats: VariantWinStats = { primaryWins: 0, refinerWins: 0, ties: 0, totalSteps: 0 };

    // Emit parallel mode info
    this.emit({
      type: 'upgrade.parallel.config',
      timestamp: Date.now(),
      data: {
        parallelModules,
        parallelModuleConcurrency,
        parallelVariants,
        mode,
      },
    });

    let moduleReports: UpgradeModuleReport[];

    if (parallelModules && plan.modules.length > 1) {
      // PARALLEL MODULE PROCESSING
      moduleReports = await this.runModulesInParallel(
        plan.modules,
        mode,
        modeDefinition,
        parallelModuleConcurrency,
        parallelVariants,
        continueOnFailure,
        variantStats
      );
    } else {
      // SEQUENTIAL MODULE PROCESSING (original behavior)
      moduleReports = await this.runModulesSequentially(
        plan.modules,
        mode,
        modeDefinition,
        parallelVariants,
        continueOnFailure,
        variantStats
      );
    }

    const baseReport = this.generateReport(objective);
    return {
      ...baseReport,
      mode,
      continueOnFailure,
      modules: moduleReports,
      variantStats,
      variantWorkspaceRoots: this.variantWorkspaceRoots,
      repoPolicy: this.repoPolicy,
    };
  }

  /**
   * Run modules sequentially (original behavior)
   */
  private async runModulesSequentially(
    modules: RepoUpgradeModule[],
    mode: RepoUpgradeMode,
    modeDefinition: RepoUpgradeModeDefinition,
    parallelVariants: boolean,
    continueOnFailure: boolean,
    variantStats: VariantWinStats
  ): Promise<UpgradeModuleReport[]> {
    const moduleReports: UpgradeModuleReport[] = [];
    let halted = false;

    for (const module of modules) {
      if (halted) {
        moduleReports.push({
          id: module.id,
          label: module.label,
          scope: module.scope,
          steps: [],
          status: 'skipped',
        });
        continue;
      }

      const moduleReport = await this.processModule(module, mode, modeDefinition, parallelVariants, variantStats, continueOnFailure);
      moduleReports.push(moduleReport);

      if (moduleReport.status === 'failed' && !continueOnFailure) {
        halted = true;
      }
    }

    return moduleReports;
  }

  /**
   * Run modules in parallel using the ParallelExecutor
   */
  private async runModulesInParallel(
    modules: RepoUpgradeModule[],
    mode: RepoUpgradeMode,
    modeDefinition: RepoUpgradeModeDefinition,
    concurrency: number,
    parallelVariants: boolean,
    continueOnFailure: boolean,
    variantStats: VariantWinStats
  ): Promise<UpgradeModuleReport[]> {
    const executor = this.getParallelExecutor(concurrency);

    this.emit({
      type: 'upgrade.parallel.start',
      timestamp: Date.now(),
      data: { moduleCount: modules.length, concurrency },
    });

    // Create parallel tasks for each module
    const tasks: ParallelTask<UpgradeModuleReport>[] = modules.map((module) =>
      createTask(
        `module:${module.id}`,
        async () => this.processModule(module, mode, modeDefinition, parallelVariants, variantStats, continueOnFailure),
        {
          label: module.label,
          parallelizable: true,
          group: 'modules',
        }
      )
    );

    const batchResult = await executor.execute(tasks);

    this.emit({
      type: 'upgrade.parallel.complete',
      timestamp: Date.now(),
      data: {
        totalDurationMs: batchResult.totalDurationMs,
        successCount: batchResult.successCount,
        failureCount: batchResult.failureCount,
        parallelismAchieved: batchResult.parallelismAchieved,
      },
    });

    // Extract results in order, handling failures
    const moduleReports: UpgradeModuleReport[] = [];
    for (const result of batchResult.results) {
      if (result.status === 'completed' && result.result) {
        moduleReports.push(result.result);
      } else {
        // Create a failed report for tasks that couldn't complete
        const moduleId = result.taskId.replace('module:', '');
        const module = modules.find((m) => m.id === moduleId);
        moduleReports.push({
          id: moduleId,
          label: module?.label ?? moduleId,
          scope: module?.scope ?? [],
          steps: [],
          status: 'failed',
        });

        if (!continueOnFailure) {
          // Mark remaining as skipped
          break;
        }
      }
    }

    return moduleReports;
  }

  /**
   * Process a single module (can be called in parallel or sequentially)
   */
  private async processModule(
    module: RepoUpgradeModule,
    mode: RepoUpgradeMode,
    modeDefinition: RepoUpgradeModeDefinition,
    parallelVariants: boolean,
    variantStats: VariantWinStats,
    continueOnFailure = true
  ): Promise<UpgradeModuleReport> {
    this.emit({
      type: 'upgrade.module.start',
      timestamp: Date.now(),
      data: { moduleId: module.id, label: module.label, scope: module.scope, mode },
    });

    const moduleReport: UpgradeModuleReport = {
      id: module.id,
      label: module.label,
      scope: module.scope,
      codemodCommands: module.codemodCommands,
      validationCommands: module.validationCommands,
      steps: [],
      status: 'completed',
    };

    for (const step of module.steps) {
      const outcome = await this.runStep(module, step, mode, parallelVariants);
      moduleReport.steps.push(outcome);
      this.updateVariantStats(variantStats, outcome, modeDefinition);

      if (!outcome.winner.success) {
        moduleReport.status = 'failed';
        // Stop processing this module's steps if continueOnFailure is false
        if (!continueOnFailure) {
          break;
        }
      }
    }

    this.emit({
      type: 'upgrade.module.complete',
      timestamp: Date.now(),
      data: { moduleId: module.id, status: moduleReport.status },
    });

    return moduleReport;
  }

  private async runStep(
    module: RepoUpgradeModule,
    step: RepoUpgradeStep,
    mode: RepoUpgradeMode,
    parallelVariants = true
  ): Promise<UpgradeStepOutcome> {
    const modeDefinition = getModeDefinition(mode);
    this.emit({
      type: 'upgrade.step.start',
      timestamp: Date.now(),
      data: { moduleId: module.id, stepId: step.id, variant: 'primary', mode, parallelVariants },
    });

    const variantResults: Partial<Record<UpgradeVariant, UpgradeStepResult>> = {};

    // Determine if we can run variants in parallel
    // Parallel is possible when:
    // 1. parallelVariants is enabled
    // 2. We have both primary and refiner variants
    // 3. We have separate workspace roots for each variant
    const canRunParallel =
      parallelVariants &&
      modeDefinition.variants.includes('refiner') &&
      this.variantWorkspaceRoots?.refiner &&
      this.variantWorkspaceRoots.refiner !== this.variantWorkspaceRoots.primary;

    if (canRunParallel && modeDefinition.variants.length > 1) {
      // PARALLEL VARIANT EXECUTION
      this.emit({
        type: 'upgrade.step.variants.parallel',
        timestamp: Date.now(),
        data: { moduleId: module.id, stepId: step.id, variants: modeDefinition.variants },
      });

      const variantPromises = modeDefinition.variants.map(async (variant) => {
        const result = await this.safeExecuteVariant({
          module,
          step,
          mode,
          variant,
          // In parallel mode, refiner doesn't get primary's result as it runs concurrently
          previousResult: undefined,
          workspaceRoot: this.variantWorkspaceRoots?.[variant] ?? this.variantWorkspaceRoots?.primary,
          repoPolicy: this.repoPolicy,
        });
        return { variant, result };
      });

      const results = await Promise.all(variantPromises);
      for (const { variant, result } of results) {
        variantResults[variant] = result;
      }
    } else {
      // SEQUENTIAL VARIANT EXECUTION (original behavior)
      // Refiner gets primary's result for informed refinement
      for (const variant of modeDefinition.variants) {
        const previousResult = variant === 'refiner' ? variantResults.primary : undefined;
        const result = await this.safeExecuteVariant({
          module,
          step,
          mode,
          variant,
          previousResult,
          workspaceRoot: this.variantWorkspaceRoots?.[variant] ?? this.variantWorkspaceRoots?.primary,
          repoPolicy: this.repoPolicy,
        });
        variantResults[variant] = result;
      }
    }

    const primary = variantResults.primary as UpgradeStepResult;
    const refiner = variantResults.refiner;

    const tournamentOutcome = modeDefinition.parallelVariants
      ? this.evaluateTournamentOutcome(module, step, modeDefinition, primary, refiner)
      : null;
    if (tournamentOutcome) {
      this.attachTournamentBreakdown(variantResults, tournamentOutcome);
    }

    const { winner, winnerVariant } = resolveWinnerStrategy(
      { modeDefinition, variantResults, tournamentOutcome },
      (definition, primaryResult, refinerResult) => this.pickWinner(definition, primaryResult, refinerResult)
    );

    this.recordOutcomeArtifacts(module, step, winner, winnerVariant);

    const primaryScore = primary.tournament?.aggregateScore ?? primary.score;
    const refinerScore = refiner?.tournament?.aggregateScore ?? refiner?.score;
    const primaryAccuracy = primary.tournament?.humanAccuracy ?? primary.humanAccuracy;
    const refinerAccuracy = refiner?.tournament?.humanAccuracy ?? refiner?.humanAccuracy;

    this.emit({
      type: 'upgrade.step.complete',
      timestamp: Date.now(),
      data: {
        moduleId: module.id,
        stepId: step.id,
        variant: winnerVariant,
        success: winner.success,
        // Include outcome details for UI scoring
        primaryScore,
        primarySuccess: primary.success,
        refinerScore,
        refinerSuccess: refiner?.success,
        winnerVariant,
        primaryAccuracy,
        refinerAccuracy,
        tournamentRankings: tournamentOutcome?.ranked,
      },
    });

    return {
      stepId: step.id,
      intent: step.intent,
      description: step.description,
      primary,
      refiner,
      winner,
      winnerVariant,
      status: winner.success ? 'completed' : 'failed',
    };
  }

  private evaluateTournamentOutcome(
    module: RepoUpgradeModule,
    step: RepoUpgradeStep,
    modeDefinition: RepoUpgradeModeDefinition,
    primary: UpgradeStepResult,
    refiner?: UpgradeStepResult
  ): TournamentOutcome | null {
    // Fast exits: if only one variant succeeded, avoid tournament overhead
    if (primary.success && (!refiner || !refiner.success)) {
      primary.humanAccuracy = 1;
      if (refiner) refiner.humanAccuracy = 0;
      this.updateRepoTypeTelemetry(getRepoTypeFromModule(module), 'primary');
      return null;
    }
    if (refiner?.success && !primary.success) {
      refiner.humanAccuracy = 1;
      primary.humanAccuracy = 0;
      this.updateRepoTypeTelemetry(getRepoTypeFromModule(module), 'refiner');
      return null;
    }

    // If neither variant succeeded, skip tournament aggregation for efficiency
    if (!primary.success && (!refiner || !refiner.success)) {
      return null;
    }

    const candidates: TournamentCandidate[] = [
      this.buildTournamentCandidate('primary', primary, modeDefinition),
    ];

    if (refiner) {
      candidates.push(this.buildTournamentCandidate('refiner', refiner, modeDefinition));
    }

    const task: TournamentTask = {
      id: `${module.id}:${step.id}`,
      goal: step.description,
      constraints: module.scope,
      metadata: {
        module: module.label,
        objective: this.objective,
        repoPolicy: this.repoPolicy,
        intent: step.intent,
      },
    };

    const evaluatorConfig = buildEvaluatorConfig(module);

    try {
      return runDualTournament(task, candidates, {
        rewardWeights: evaluatorConfig.rewardWeights,
        evaluators: evaluatorConfig.evaluators,
        maxCandidates: 8,
      });
    } catch {
      return null;
    }
  }

  private buildTournamentCandidate(
    variant: UpgradeVariant,
    result: UpgradeStepResult,
    modeDefinition: RepoUpgradeModeDefinition
  ): TournamentCandidate {
    const signals = result.rewardSignals ?? {};
    const rawReward = typeof result.score === 'number' ? clampScore(result.score) : 0;
    const adjustedReward =
      variant === 'refiner' ? clampScore(rawReward + (modeDefinition.refinerBias ?? 0)) : rawReward;

    const evaluatorScores: TournamentCandidate['evaluatorScores'] = [
      { evaluatorId: 'reward-signal', score: adjustedReward, weight: 1 },
      { evaluatorId: 'hard-metrics', score: signals.executionSuccess ?? (result.success ? 1 : 0), weight: 1.1 },
    ];

    if (typeof signals.testsPassed === 'number') {
      evaluatorScores.push({ evaluatorId: 'tests', score: signals.testsPassed, weight: 0.8 });
    }
    if (typeof signals.staticAnalysis === 'number') {
      evaluatorScores.push({ evaluatorId: 'static-analysis', score: signals.staticAnalysis, weight: 0.6 });
    }
    if (typeof signals.codeQuality === 'number' || typeof signals.blastRadius === 'number') {
      const qualityScore = averageDefined([
        signals.codeQuality,
        signals.blastRadius,
        signals.staticAnalysis,
      ]);
      if (!Number.isNaN(qualityScore)) {
        evaluatorScores.push({ evaluatorId: 'quality', score: qualityScore, weight: 0.9 });
      }
    }

    return {
      id: variant,
      policyId: variant,
      patchSummary: result.summary,
      metrics: {
        executionSuccess: signals.executionSuccess ?? (result.success ? 1 : 0),
        testsPassed: signals.testsPassed,
        staticAnalysis: signals.staticAnalysis,
        codeQuality: signals.codeQuality,
        blastRadius: signals.blastRadius,
        speedBonus: signals.speedBonus,
      },
      signals: {
        rewardModelScore: adjustedReward,
        selfAssessment: signals.selfAssessment,
      },
      evaluatorScores: evaluatorScores ?? [],
      rawOutput: result.detail,
    };
  }

  private attachTournamentBreakdown(
    variantResults: Partial<Record<UpgradeVariant, UpgradeStepResult>>,
    outcome: TournamentOutcome
  ): void {
    for (const entry of outcome.ranked) {
      const variant = entry.candidateId as UpgradeVariant;
      const target = variantResults[variant];
      if (target) {
        target.tournament = entry;
        target.humanAccuracy = entry.humanAccuracy;
      }
    }
    // Update telemetry based on winner to auto-tune per repo type
    const top = outcome.ranked[0];
    if (top) {
      const repoType = getRepoTypeFromOutcomeMetadata(outcome.task);
      this.updateRepoTypeTelemetry(repoType, top.candidateId as UpgradeVariant);
    }
  }

  private async safeExecuteVariant(input: UpgradeStepExecutionInput): Promise<UpgradeStepResult> {
    try {
      return await this.executor(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        summary: 'Execution failed',
        detail: message,
        score: 0,
        durationMs: 0,
        execution: {
          success: false,
          output: 'Execution failed',
          duration: 0,
          command: `${input.module.id}/${input.step.id}/${input.variant}`,
          error: message,
        },
        notes: ['Executor threw an error'],
      };
    }
  }

  private pickWinner(
    definition: RepoUpgradeModeDefinition,
    primary: UpgradeStepResult,
    refiner?: UpgradeStepResult
  ): { winner: UpgradeStepResult; winnerVariant: UpgradeVariant } {
    if (!refiner || !definition.variants.includes('refiner')) {
      return { winner: primary, winnerVariant: 'primary' };
    }

    if (refiner.success && !primary.success) {
      return { winner: refiner, winnerVariant: 'refiner' };
    }
    if (primary.success && !refiner.success) {
      return { winner: primary, winnerVariant: 'primary' };
    }

    const primaryScore = typeof primary.score === 'number' ? primary.score : 0;
    const refinerScore = (typeof refiner.score === 'number' ? refiner.score : 0) + (definition.refinerBias ?? 0);
    const primaryAccuracy = typeof primary.humanAccuracy === 'number' ? primary.humanAccuracy : 0;
    const refinerAccuracy = typeof refiner.humanAccuracy === 'number' ? refiner.humanAccuracy : 0;

    if (refinerScore > primaryScore) {
      return { winner: refiner, winnerVariant: 'refiner' };
    }
    if (primaryScore > refinerScore) {
      return { winner: primary, winnerVariant: 'primary' };
    }

    // Accuracy-aware tie break
    if (refinerAccuracy > primaryAccuracy + 1e-6) {
      return { winner: refiner, winnerVariant: 'refiner' };
    }
    if (primaryAccuracy > refinerAccuracy + 1e-6) {
      return { winner: primary, winnerVariant: 'primary' };
    }

    // Tie breaker: prefer refiner to encourage RL exploration
    return { winner: refiner, winnerVariant: 'refiner' };
  }

  private recordOutcomeArtifacts(
    module: RepoUpgradeModule,
    step: RepoUpgradeStep,
    result: UpgradeStepResult,
    variant: 'primary' | 'refiner'
  ): void {
    if (result.findings?.length) {
      this.findings.push(...result.findings);
    }

    const execution: ExecutionResult = result.execution ?? {
      success: result.success,
      output: result.summary,
      duration: result.durationMs ?? 0,
      command: `${module.id}/${step.id}/${variant}`,
      error: result.success ? undefined : result.detail ?? result.summary,
    };

    // Ensure we only track a single winner record per step to keep reports clean
    this.results.push(execution);

    // Update telemetry after each recorded outcome
    const repoType = getRepoTypeFromModule(module);
    this.updateRepoTypeTelemetry(repoType, variant);
  }

  private updateRepoTypeTelemetry(repoType: string, winner: UpgradeVariant): void {
    updateRepoTypeTelemetryMap(repoType, winner);
  }

  private updateVariantStats(
    stats: VariantWinStats,
    outcome: UpgradeStepOutcome,
    modeDefinition: RepoUpgradeModeDefinition
  ): void {
    stats.totalSteps += 1;
    if (outcome.winnerVariant === 'refiner') {
      stats.refinerWins += 1;
    } else {
      stats.primaryWins += 1;
    }

    if (!outcome.refiner) {
      return;
    }

    const primaryScore = typeof outcome.primary.score === 'number' ? outcome.primary.score : 0;
    const primaryTournamentScore =
      typeof outcome.primary.tournament?.aggregateScore === 'number'
        ? outcome.primary.tournament.aggregateScore
        : primaryScore;
    const refinerScoreRaw = typeof outcome.refiner.tournament?.aggregateScore === 'number'
      ? outcome.refiner.tournament.aggregateScore
      : typeof outcome.refiner.score === 'number'
        ? outcome.refiner.score
        : 0;
    const refinerScore = refinerScoreRaw + (modeDefinition.refinerBias ?? 0);
    const scoresClose = Math.abs(primaryTournamentScore - refinerScore) < 1e-6;
    const bothSucceeded = outcome.primary.success && outcome.refiner.success;
    if (bothSucceeded && scoresClose) {
      stats.ties += 1;
    }
  }
}

export function clampScore(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function averageDefined(values: Array<number | undefined>): number {
  const nums = values.filter((v): v is number => typeof v === 'number');
  if (!nums.length) return NaN;
  const total = nums.reduce((sum, val) => sum + val, 0);
  return total / nums.length;
}

function buildEvaluatorConfig(module: RepoUpgradeModule): {
  rewardWeights: import('./dualTournament.js').HumanRewardWeights;
  evaluators: Array<{
    id: string;
    label: string;
    weight: number;
    kind: 'hard' | 'soft' | 'hybrid';
    elo?: number;
  }>;
} {
  const repoType = getRepoTypeFromModule(module);

  // Default: balanced weights
  let rewardWeights = DEFAULT_HUMAN_REWARD_WEIGHTS;
  let hardWeight = 1.35;
  let qualityWeight = 1.0;
  let rewardWeight = 0.9;

  if (repoType === 'tests') {
    rewardWeights = { alpha: 0.7, beta: 0.15, gamma: 0.15 };
    hardWeight = 1.55;
    qualityWeight = 0.9;
    rewardWeight = 0.85;
  } else if (repoType === 'docs') {
    rewardWeights = { alpha: 0.45, beta: 0.3, gamma: 0.25 };
    hardWeight = 1.0;
    qualityWeight = 1.2;
    rewardWeight = 1.0;
  } else if (repoType === 'refactor') {
    rewardWeights = { alpha: 0.55, beta: 0.25, gamma: 0.2 };
    hardWeight = 1.25;
    qualityWeight = 1.15;
    rewardWeight = 0.95;
  }

  // Telemetry-based nudges per repo type
  const telemetry = RepoUpgradeOrchestrator.repoTypeTelemetry.get(repoType);
    if (telemetry) {
      const total = Math.max(1, telemetry.winsPrimary + telemetry.winsRefiner);
      const bias = (telemetry.winsPrimary - telemetry.winsRefiner) / total;
      if (bias > 0.1) {
        hardWeight = clampScore(hardWeight + 0.1, 0.8, 2);
        rewardWeights = {
          alpha: clampScore((rewardWeights.alpha ?? 0.6) + 0.05, 0, 1),
          beta: rewardWeights.beta,
          gamma: clampScore((rewardWeights.gamma ?? 0.2) - 0.02, 0, 1),
        };
      } else if (bias < -0.1) {
        qualityWeight = clampScore(qualityWeight + 0.1, 0.8, 2);
        rewardWeight = clampScore(rewardWeight + 0.05, 0.5, 1.5);
        rewardWeights = {
          alpha: clampScore((rewardWeights.alpha ?? 0.6) - 0.05, 0, 1),
          beta: clampScore((rewardWeights.beta ?? 0.25) + 0.05, 0, 1),
          gamma: clampScore((rewardWeights.gamma ?? 0.2) + 0.02, 0, 1),
        };
      }
    }

  return {
    rewardWeights,
    evaluators: [
      { id: 'hard-metrics', label: 'Hard metrics', weight: hardWeight, kind: 'hard' },
      { id: 'quality', label: 'Quality', weight: qualityWeight, kind: 'hybrid' },
      { id: 'reward-signal', label: 'Reward signal', weight: rewardWeight, kind: 'hybrid' },
    ],
  };
}

function getRepoTypeFromModule(module: RepoUpgradeModule): string {
  const scope = (module.scope || []).join(' ').toLowerCase();
  const label = (module.label || '').toLowerCase();
  if (/\btest|__tests__|spec\b/i.test(scope) || /\btest\b/i.test(label)) return 'tests';
  if (/\bdocs?\b/i.test(scope) || /\bdoc\b/i.test(label)) return 'docs';
  if (/\brefactor|cleanup|source\b/i.test(scope + ' ' + label)) return 'refactor';
  return 'general';
}

function getRepoTypeFromOutcomeMetadata(task: TournamentTask): string {
  const scopeText = Array.isArray(task.constraints) ? task.constraints.join(' ').toLowerCase() : '';
  const intent = typeof task.metadata?.intent === 'string' ? task.metadata.intent.toLowerCase() : '';
  if (/\btest|__tests__|spec\b/i.test(scopeText) || /\btest\b/i.test(intent)) return 'tests';
  if (/\bdoc\b/i.test(scopeText) || /\bdoc\b/i.test(intent)) return 'docs';
  if (/\brefactor|cleanup\b/i.test(scopeText + ' ' + intent)) return 'refactor';
  return 'general';
}

function updateRepoTypeTelemetryMap(repoType: string, winner: UpgradeVariant): void {
  if (RepoUpgradeOrchestrator.disableTelemetryPersistence) {
    return;
  }
  ensureTelemetryLoaded();
  const current = RepoUpgradeOrchestrator.repoTypeTelemetry.get(repoType) ?? { winsPrimary: 0, winsRefiner: 0 };
  const updated =
    winner === 'primary'
      ? { ...current, winsPrimary: current.winsPrimary + 1 }
      : { ...current, winsRefiner: current.winsRefiner + 1 };
  RepoUpgradeOrchestrator.repoTypeTelemetry.set(repoType, updated);
  persistTelemetry();
}

// Simple persistence of repo-type telemetry to inform future runs
const TELEMETRY_DIR = join(homedir(), '.agi');
const TELEMETRY_FILE = join(TELEMETRY_DIR, 'rl-telemetry.json');
let telemetryLoaded = false;

function ensureTelemetryLoaded(): void {
  if (RepoUpgradeOrchestrator.disableTelemetryPersistence) return;
  if (telemetryLoaded) return;
  telemetryLoaded = true;
  try {
    if (!existsSync(TELEMETRY_FILE)) return;
    const data = JSON.parse(readFileSync(TELEMETRY_FILE, 'utf-8'));
    if (data && typeof data === 'object') {
      for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === 'object' && 'winsPrimary' in value && 'winsRefiner' in value) {
          RepoUpgradeOrchestrator.repoTypeTelemetry.set(key, {
            winsPrimary: Number((value as any).winsPrimary) || 0,
            winsRefiner: Number((value as any).winsRefiner) || 0,
          });
        }
      }
    }
  } catch {
    // ignore load errors
  }
}

function persistTelemetry(): void {
  if (RepoUpgradeOrchestrator.disableTelemetryPersistence) return;
  try {
    mkdirSync(TELEMETRY_DIR, { recursive: true });
    const payload: Record<string, { winsPrimary: number; winsRefiner: number }> = {};
    for (const [key, value] of RepoUpgradeOrchestrator.repoTypeTelemetry.entries()) {
      payload[key] = value;
    }
    writeFileSync(TELEMETRY_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  } catch {
    // ignore persistence errors
  }
}

function buildDefaultSteps(moduleId: string): RepoUpgradeStep[] {
  return [
    {
      id: `${moduleId}-analyze`,
      intent: 'analyze',
      description: `Map the upgrade surface for ${moduleId}. Identify risky files and coupling.`,
      prompt: 'Inventory files, dependencies, and breaking-change areas before upgrading.',
    },
    {
      id: `${moduleId}-upgrade`,
      intent: 'upgrade',
      description: `Apply modular upgrades for ${moduleId} with minimal blast radius.`,
      prompt: 'Execute codemods or targeted edits. Keep edits small, atomic, and well scoped.',
    },
    {
      id: `${moduleId}-verify`,
      intent: 'verify',
      description: `Validate ${moduleId} after the upgrade.`,
      prompt: 'Run tests/lint/health checks relevant to this scope. Summarize residual risks.',
    },
  ];
}

function getModeDefinition(mode: RepoUpgradeMode): RepoUpgradeModeDefinition {
  // AlphaZero dual-agent tournament is now the default mode
  return REPO_UPGRADE_MODE_DEFINITIONS[mode] ?? REPO_UPGRADE_MODE_DEFINITIONS['dual-rl-tournament'];
}
