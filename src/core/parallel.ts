/**
 * Parallel Execution Module
 *
 * Unified exports for all parallel execution capabilities in AGI Core.
 * Provides automatic parallel task management with dependency resolution,
 * agent worker pools, and integration with orchestration pipelines.
 *
 * Principal Investigator: Bo Shang
 * Framework: agi-cli
 */

// ============================================================================
// Core Parallel Executor
// ============================================================================

export {
  // Classes
  ParallelExecutor,
  WorkerPool,

  // Factory functions
  createParallelExecutor,
  createTask,
  executeParallel,
  mapParallel,

  // Types
  type ParallelTask,
  type TaskResult,
  type BatchResult,
  type ParallelExecutorConfig,
  type TaskEvent,
  type TaskStatus,
  type ExecutionPlan,
  type WorkerConfig,
  type WorkItem,
  type WorkerPoolConfig,
} from './parallelExecutor.js';

// ============================================================================
// Async Utilities (Extended)
// ============================================================================

export {
  // Classes
  ConcurrencyPool,
  RateLimiter,
  TTLCache,

  // Functions
  parallelMap,
  throttle,
  debounce,
  memoize,
  sleep,
  withTimeout,
  retry,

  // Types
  type ConcurrencyConfig,
  type RateLimiterConfig,
  type ThrottleConfig,
  type CacheConfig,
} from '../utils/asyncUtils.js';

// ============================================================================
// Agent Worker Pool
// ============================================================================

export {
  // Classes
  AgentWorkerPool,

  // Factory functions
  createAgentWorkerPool,
  createAgentTask,

  // Types
  type AgentTask,
  type AgentWorkerConfig,
  type AgentWorkerPoolConfig,
  type PoolEvent,
  type PoolStats,
  type WorkerInfo,
  type WorkerStatus,
  type BalanceStrategy,
  type TaskResult as AgentTaskResult,
} from '../runtime/agentWorkerPool.js';

// ============================================================================
// Parallel-Enabled Orchestration
// ============================================================================

export {
  // Classes
  RepoUpgradeOrchestrator,

  // Functions
  buildRepoWidePlan,

  // Types & Interfaces
  type RepoUpgradeMode,
  type RepoUpgradePlan,
  type RepoUpgradeModule,
  type RepoUpgradeStep,
  type RepoUpgradeReport,
  type RepoUpgradeRunOptions,
  type UpgradeVariant,
  type UpgradeStepResult,
  type UpgradeModuleReport,
  type UpgradeStepOutcome,
  type ValidationRunResult,
  type VariantWinStats,

  // Constants
  REPO_UPGRADE_MODE_DEFINITIONS,
} from './repoUpgradeOrchestrator.js';

// ============================================================================
// Convenience Helpers
// ============================================================================

/**
 * Configuration presets for common parallel execution scenarios
 */
export const ParallelPresets = {
  /**
   * Light parallel execution - suitable for I/O-bound tasks
   * Lower concurrency, minimal resource usage
   */
  light: {
    maxConcurrency: 3,
    defaultTimeout: 24 * 60 * 60 * 1000,
    continueOnFailure: true,
    autoDetectParallel: true,
  },

  /**
   * Standard parallel execution - balanced for most use cases
   * Moderate concurrency, suitable for typical workflows
   */
  standard: {
    maxConcurrency: 5,
    defaultTimeout: 24 * 60 * 60 * 1000,
    continueOnFailure: true,
    autoDetectParallel: true,
  },

  /**
   * Heavy parallel execution - suitable for CPU-bound tasks
   * Higher concurrency, aggressive parallelization
   */
  heavy: {
    maxConcurrency: 8,
    defaultTimeout: 24 * 60 * 60 * 1000,
    continueOnFailure: true,
    autoDetectParallel: true,
  },

  /**
   * Strict sequential execution - no parallelization
   * For workflows that require guaranteed ordering
   */
  sequential: {
    maxConcurrency: 1,
    defaultTimeout: 24 * 60 * 60 * 1000,
    continueOnFailure: false,
    autoDetectParallel: false,
  },

  /**
   * Agent pool configuration for multi-agent scenarios
   */
  agentPool: {
    balanceStrategy: 'least-busy' as const,
    defaultTimeout: 24 * 60 * 60 * 1000,
    maxQueueSize: 50,
  },
} as const;

/**
 * Quick parallel map with sensible defaults
 */
export async function quickParallelMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const { parallelMap } = await import('../utils/asyncUtils.js');
  return parallelMap(items, (item, _idx) => fn(item), 5);
}

/**
 * Execute a batch of async functions in parallel with concurrency limit
 */
export async function batchExecute<T>(
  tasks: Array<() => Promise<T>>,
  concurrency = 5
): Promise<T[]> {
  const { ConcurrencyPool } = await import('../utils/asyncUtils.js');
  const pool = new ConcurrencyPool({ maxConcurrent: concurrency });
  return Promise.all(tasks.map(fn => pool.run(fn)));
}

/**
 * Create a simple task queue for sequential execution
 */
export function createTaskQueue<T>() {
  const queue: Array<() => Promise<T>> = [];
  let processing = false;
  const results: T[] = [];

  return {
    add(task: () => Promise<T>) {
      queue.push(task);
    },

    async process(): Promise<T[]> {
      if (processing) {
        throw new Error('Queue is already being processed');
      }
      processing = true;
      results.length = 0;

      while (queue.length > 0) {
        const task = queue.shift();
        if (task) {
          results.push(await task());
        }
      }

      processing = false;
      return results;
    },

    get length() {
      return queue.length;
    },

    get isProcessing() {
      return processing;
    },
  };
}
