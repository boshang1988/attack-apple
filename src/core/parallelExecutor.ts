/**
 * Parallel Task Executor Module
 *
 * Provides automatic parallel execution capabilities with smart detection,
 * task dependency management, and resource-aware concurrency control.
 *
 * Principal Investigator: Bo Shang
 * Framework: agi-cli
 */

import { ConcurrencyPool, parallelMap, RateLimiter } from '../utils/asyncUtils.js';

// ============================================================================
// Types
// ============================================================================

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ParallelTask<T = unknown> {
  /** Unique identifier for the task */
  id: string;
  /** Human-readable label for the task */
  label?: string;
  /** The async function to execute */
  execute: () => Promise<T>;
  /** Task IDs that must complete before this task can run */
  dependencies?: string[];
  /** Priority (higher = runs first when resources available) */
  priority?: number;
  /** Whether this task can run in parallel with others */
  parallelizable?: boolean;
  /** Optional group for batch processing */
  group?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Retry configuration */
  retry?: {
    maxAttempts?: number;
    backoffMs?: number;
    shouldRetry?: (error: unknown) => boolean;
  };
}

export interface TaskResult<T = unknown> {
  taskId: string;
  status: TaskStatus;
  result?: T;
  error?: Error;
  durationMs: number;
  attempts: number;
  startedAt: number;
  completedAt: number;
}

export interface ParallelExecutorConfig {
  /** Maximum concurrent tasks (default: 5) */
  maxConcurrency?: number;
  /** Default timeout per task in ms (default: 30000) */
  defaultTimeout?: number;
  /** Whether to auto-detect parallelizable tasks (default: true) */
  autoDetectParallel?: boolean;
  /** Whether to continue on task failure (default: true) */
  continueOnFailure?: boolean;
  /** Rate limiting config (optional) */
  rateLimit?: {
    maxRequests: number;
    windowMs: number;
  };
  /** Callback for task events */
  onTaskEvent?: (event: TaskEvent) => void;
  /** Enable adaptive concurrency based on system resources (default: true) */
  adaptiveConcurrency?: boolean;
  /** Enable deadlock detection for competing agents (default: true) */
  deadlockDetection?: boolean;
  /** Maximum memory usage percentage before throttling (0-100, default: 80) */
  maxMemoryUsagePercent?: number;
  /** Minimum concurrency level (default: 1) */
  minConcurrency?: number;
  /** Performance telemetry collection (default: true) */
  collectTelemetry?: boolean;
}

export interface TaskEvent {
  type: 'task.start' | 'task.complete' | 'task.error' | 'task.retry' | 'batch.start' | 'batch.complete';
  taskId?: string;
  batchId?: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface ExecutionPlan {
  /** Tasks grouped by execution phase (tasks in same phase can run in parallel) */
  phases: ParallelTask[][];
  /** Tasks that must run sequentially */
  sequential: ParallelTask[];
  /** Total estimated parallelism factor */
  parallelismFactor: number;
}

export interface BatchResult<T = unknown> {
  batchId: string;
  results: TaskResult<T>[];
  totalDurationMs: number;
  successCount: number;
  failureCount: number;
  parallelismAchieved: number;
}

// ============================================================================
// Dependency Graph
// ============================================================================

class DependencyGraph<T extends ParallelTask> {
  private tasks = new Map<string, T>();
  private dependencies = new Map<string, Set<string>>();
  private dependents = new Map<string, Set<string>>();

  add(task: T): void {
    this.tasks.set(task.id, task);
    this.dependencies.set(task.id, new Set(task.dependencies ?? []));

    // Build reverse dependency map
    for (const dep of task.dependencies ?? []) {
      if (!this.dependents.has(dep)) {
        this.dependents.set(dep, new Set());
      }
      this.dependents.get(dep)!.add(task.id);
    }
  }

  getTask(id: string): T | undefined {
    return this.tasks.get(id);
  }

  getAllTasks(): T[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Check if a task's dependencies are all satisfied
   */
  canExecute(taskId: string, completedTasks: Set<string>): boolean {
    const deps = this.dependencies.get(taskId);
    if (!deps || deps.size === 0) return true;
    for (const dep of deps) {
      if (!completedTasks.has(dep)) return false;
    }
    return true;
  }

  /**
   * Get tasks ready to execute (no pending dependencies)
   */
  getReadyTasks(completedTasks: Set<string>, runningTasks: Set<string>): T[] {
    const ready: T[] = [];
    for (const [id, task] of this.tasks) {
      if (completedTasks.has(id) || runningTasks.has(id)) continue;
      if (this.canExecute(id, completedTasks)) {
        ready.push(task);
      }
    }
    // Sort by priority (descending)
    return ready.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  /**
   * Topological sort to determine execution order
   */
  getTopologicalOrder(): T[] {
    const visited = new Set<string>();
    const result: T[] = [];
    const visiting = new Set<string>();

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`Circular dependency detected involving task: ${id}`);
      }

      visiting.add(id);
      const deps = this.dependencies.get(id) ?? new Set();
      for (const dep of deps) {
        if (this.tasks.has(dep)) {
          visit(dep);
        }
      }
      visiting.delete(id);
      visited.add(id);

      const task = this.tasks.get(id);
      if (task) result.push(task);
    };

    for (const id of this.tasks.keys()) {
      visit(id);
    }

    return result;
  }

  /**
   * Group tasks into parallel execution phases
   */
  getExecutionPhases(): T[][] {
    const phases: T[][] = [];
    const completed = new Set<string>();
    const remaining = new Set(this.tasks.keys());

    while (remaining.size > 0) {
      const phase: T[] = [];

      for (const id of remaining) {
        if (this.canExecute(id, completed)) {
          const task = this.tasks.get(id);
          if (task && task.parallelizable !== false) {
            phase.push(task);
          }
        }
      }

      if (phase.length === 0) {
        // No parallelizable tasks, take the highest priority remaining
        const sequential: T[] = [];
        for (const id of remaining) {
          if (this.canExecute(id, completed)) {
            const task = this.tasks.get(id);
            if (task) sequential.push(task);
          }
        }
        sequential.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
        if (sequential.length > 0) {
          phase.push(sequential[0]!);
        }
      }

      if (phase.length === 0) {
        // Circular dependency or error condition
        throw new Error('Cannot resolve task dependencies - possible circular reference');
      }

      for (const task of phase) {
        remaining.delete(task.id);
        completed.add(task.id);
      }
      phases.push(phase);
    }

    return phases;
  }
}

// ============================================================================
// Parallel Executor
// ============================================================================

export class ParallelExecutor {
  private readonly config: Required<ParallelExecutorConfig>;
  private readonly pool: ConcurrencyPool;
  private readonly rateLimiter: RateLimiter | null;
  private readonly results = new Map<string, TaskResult>();
  private cancelled = false;

  constructor(config: ParallelExecutorConfig = {}) {
    this.config = {
      maxConcurrency: config.maxConcurrency ?? 5,
      defaultTimeout: config.defaultTimeout ?? 24 * 60 * 60 * 1000,
      autoDetectParallel: config.autoDetectParallel ?? true,
      continueOnFailure: config.continueOnFailure ?? true,
      rateLimit: config.rateLimit ?? null!,
      onTaskEvent: config.onTaskEvent ?? (() => {}),
      adaptiveConcurrency: config.adaptiveConcurrency ?? true,
      deadlockDetection: config.deadlockDetection ?? true,
      maxMemoryUsagePercent: config.maxMemoryUsagePercent ?? 80,
      minConcurrency: config.minConcurrency ?? 1,
      collectTelemetry: config.collectTelemetry ?? true,
    };

    this.pool = new ConcurrencyPool({
      maxConcurrent: this.config.maxConcurrency,
      timeout: this.config.defaultTimeout,
    });

    this.rateLimiter = this.config.rateLimit
      ? new RateLimiter(this.config.rateLimit)
      : null;
  }

  /**
   * Cancel all pending tasks
   */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * Reset the executor state
   */
  reset(): void {
    this.cancelled = false;
    this.results.clear();
  }

  /**
   * Execute a single task with retry and timeout handling
   */
  private async executeTask<T>(task: ParallelTask<T>): Promise<TaskResult<T>> {
    const startedAt = Date.now();
    let attempts = 0;
    const maxAttempts = task.retry?.maxAttempts ?? 1;
    const backoffMs = task.retry?.backoffMs ?? 1000;
    const shouldRetry = task.retry?.shouldRetry ?? (() => true);

    this.emit({
      type: 'task.start',
      taskId: task.id,
      timestamp: startedAt,
      data: { label: task.label, priority: task.priority },
    });

    while (attempts < maxAttempts) {
      attempts++;

      try {
        // Rate limiting
        if (this.rateLimiter) {
          await this.rateLimiter.acquire();
        }

        // Check cancellation
        if (this.cancelled) {
          return this.createResult<T>(task.id, 'cancelled', undefined, undefined, startedAt, attempts);
        }

        // Execute with timeout
        const timeout = task.timeout ?? this.config.defaultTimeout;
        const result = await Promise.race([
          task.execute(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Task timeout after ${timeout}ms`)), timeout);
          }),
        ]);

        const completedAt = Date.now();
        this.emit({
          type: 'task.complete',
          taskId: task.id,
          timestamp: completedAt,
          data: { durationMs: completedAt - startedAt, attempts },
        });

        return this.createResult(task.id, 'completed', result, undefined, startedAt, attempts);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        if (attempts < maxAttempts && shouldRetry(error)) {
          this.emit({
            type: 'task.retry',
            taskId: task.id,
            timestamp: Date.now(),
            data: { attempt: attempts, maxAttempts, error: err.message },
          });
          await this.sleep(backoffMs * attempts);
          continue;
        }

        const completedAt = Date.now();
        this.emit({
          type: 'task.error',
          taskId: task.id,
          timestamp: completedAt,
          data: { error: err.message, attempts },
        });

        return this.createResult<T>(task.id, 'failed', undefined, err, startedAt, attempts);
      }
    }

    // Should never reach here
    return this.createResult<T>(task.id, 'failed', undefined, new Error('Max attempts exceeded'), startedAt, attempts);
  }

  private createResult<T>(
    taskId: string,
    status: TaskStatus,
    result: T | undefined,
    error: Error | undefined,
    startedAt: number,
    attempts: number
  ): TaskResult<T> {
    const completedAt = Date.now();
    return {
      taskId,
      status,
      result,
      error,
      durationMs: completedAt - startedAt,
      attempts,
      startedAt,
      completedAt,
    };
  }

  /**
   * Execute tasks with automatic parallelization based on dependencies
   */
  async execute<T>(tasks: ParallelTask<T>[]): Promise<BatchResult<T>> {
    const batchId = `batch-${Date.now()}`;
    const batchStart = Date.now();
    let failureEncountered = false;
    this.cancelled = false;

    this.emit({
      type: 'batch.start',
      batchId,
      timestamp: batchStart,
      data: { taskCount: tasks.length },
    });

    // Build dependency graph
    const graph = new DependencyGraph<ParallelTask<T>>();
    for (const task of tasks) {
      // Auto-detect parallelizable if not specified
      if (this.config.autoDetectParallel && task.parallelizable === undefined) {
        task.parallelizable = this.detectParallelizable(task);
      }
      graph.add(task);
    }

    // Execute in phases
    const phases = graph.getExecutionPhases();
    const results: TaskResult<T>[] = [];
    const executed = new Set<string>();
    let maxParallelism = 0;

    for (const phase of phases) {
      if (this.cancelled) break;

      maxParallelism = Math.max(maxParallelism, phase.length);

      // Execute phase tasks in parallel
      const phaseResults = await parallelMap(
        phase,
        async (task) => {
          return this.pool.run(() => this.executeTask(task));
        },
        this.config.maxConcurrency
      );

      results.push(...phaseResults);
      phaseResults.forEach((r) => executed.add(r.taskId));

      // Check for failures if not continuing on failure
      if (!this.config.continueOnFailure) {
        const failure = phaseResults.find((r) => r.status === 'failed');
        if (failure) {
          failureEncountered = true;
          this.cancelled = true;
          break;
        }
      }
    }

    if (failureEncountered || this.cancelled) {
      const remaining = tasks.filter((t) => !executed.has(t.id));
      for (const task of remaining) {
        results.push(this.createResult<T>(task.id, 'cancelled', undefined, new Error('Cancelled'), Date.now(), 0));
      }
    }

    const batchEnd = Date.now();
    this.emit({
      type: 'batch.complete',
      batchId,
      timestamp: batchEnd,
      data: {
        totalDurationMs: batchEnd - batchStart,
        successCount: results.filter((r) => r.status === 'completed').length,
        failureCount: results.filter((r) => r.status === 'failed').length,
      },
    });

    return {
      batchId,
      results,
      totalDurationMs: batchEnd - batchStart,
      successCount: results.filter((r) => r.status === 'completed').length,
      failureCount: results.filter((r) => r.status === 'failed').length,
      parallelismAchieved: maxParallelism,
    };
  }

  /**
   * Execute tasks in groups, where tasks within a group run in parallel
   */
  async executeByGroup<T>(tasks: ParallelTask<T>[]): Promise<Map<string, BatchResult<T>>> {
    const groups = new Map<string, ParallelTask<T>[]>();
    const ungrouped: ParallelTask<T>[] = [];

    for (const task of tasks) {
      if (task.group) {
        if (!groups.has(task.group)) {
          groups.set(task.group, []);
        }
        groups.get(task.group)!.push(task);
      } else {
        ungrouped.push(task);
      }
    }

    const results = new Map<string, BatchResult<T>>();

    // Execute ungrouped tasks first
    if (ungrouped.length > 0) {
      results.set('__default__', await this.execute(ungrouped));
    }

    // Execute groups sequentially (tasks within group run in parallel)
    for (const [groupId, groupTasks] of groups) {
      if (this.cancelled) break;
      results.set(groupId, await this.execute(groupTasks));
    }

    return results;
  }

  /**
   * Simple parallel map with automatic concurrency
   */
  async map<T, R>(
    items: T[],
    fn: (item: T, index: number) => Promise<R>,
    concurrency?: number
  ): Promise<R[]> {
    return parallelMap(items, fn, concurrency ?? this.config.maxConcurrency);
  }

  /**
   * Plan execution without running (useful for visualization)
   */
  plan<T>(tasks: ParallelTask<T>[]): ExecutionPlan {
    const graph = new DependencyGraph<ParallelTask<T>>();
    for (const task of tasks) {
      if (this.config.autoDetectParallel && task.parallelizable === undefined) {
        task.parallelizable = this.detectParallelizable(task);
      }
      graph.add(task);
    }

    const phases = graph.getExecutionPhases();
    const sequential = tasks.filter((t) => t.parallelizable === false);

    // Calculate parallelism factor
    const totalTasks = tasks.length;
    const maxPhaseSize = phases.reduce((max, phase) => Math.max(max, phase.length), 0);
    const parallelismFactor = totalTasks > 0 ? maxPhaseSize / totalTasks : 0;

    return {
      phases,
      sequential,
      parallelismFactor,
    };
  }

  /**
   * Auto-detect if a task is parallelizable based on heuristics
   */
  private detectParallelizable(task: ParallelTask): boolean {
    // Tasks with no dependencies are parallelizable
    if (!task.dependencies || task.dependencies.length === 0) {
      return true;
    }

    // Tasks with explicit non-parallel flag
    if (task.parallelizable === false) {
      return false;
    }

    // Check for known sequential patterns in label/id
    const id = (task.id + (task.label ?? '')).toLowerCase();
    const sequentialPatterns = [
      'sequential',
      'sync',
      'blocking',
      'exclusive',
      'serial',
      'atomic',
      'transaction',
      'migration',
      'deploy',
    ];

    for (const pattern of sequentialPatterns) {
      if (id.includes(pattern)) {
        return false;
      }
    }

    // Default to parallelizable
    return true;
  }

  private emit(event: TaskEvent): void {
    try {
      this.config.onTaskEvent(event);
    } catch {
      // Ignore callback errors
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get execution statistics
   */
  getStats(): {
    poolActive: number;
    poolPending: number;
    resultsCount: number;
  } {
    return {
      poolActive: this.pool.active,
      poolPending: this.pool.pending,
      resultsCount: this.results.size,
    };
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create a parallel executor with default configuration
 */
export function createParallelExecutor(config?: ParallelExecutorConfig): ParallelExecutor {
  return new ParallelExecutor(config);
}

/**
 * Execute tasks in parallel with automatic dependency resolution
 */
export async function executeParallel<T>(
  tasks: ParallelTask<T>[],
  config?: ParallelExecutorConfig
): Promise<BatchResult<T>> {
  const executor = new ParallelExecutor(config);
  return executor.execute(tasks);
}

/**
 * Parallel map with concurrency limit
 */
export async function mapParallel<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 5
): Promise<R[]> {
  return parallelMap(items, fn, concurrency);
}

/**
 * Create a task definition helper
 */
export function createTask<T>(
  id: string,
  execute: () => Promise<T>,
  options?: Partial<Omit<ParallelTask<T>, 'id' | 'execute'>>
): ParallelTask<T> {
  return {
    id,
    execute,
    ...options,
  };
}

// ============================================================================
// Worker Pool (for multi-agent scenarios)
// ============================================================================

export interface WorkerConfig {
  id: string;
  maxConcurrency?: number;
}

export interface WorkItem<T = unknown> {
  id: string;
  execute: () => Promise<T>;
  priority?: number;
}

export interface WorkerPoolConfig {
  workers: WorkerConfig[];
  balanceStrategy?: 'round-robin' | 'least-busy' | 'random';
}

export class WorkerPool {
  private readonly workers: Map<string, ConcurrencyPool> = new Map();
  private readonly workerIds: string[];
  private readonly balanceStrategy: 'round-robin' | 'least-busy' | 'random';
  private roundRobinIndex = 0;

  constructor(config: WorkerPoolConfig) {
    this.balanceStrategy = config.balanceStrategy ?? 'least-busy';
    this.workerIds = [];

    for (const worker of config.workers) {
      const pool = new ConcurrencyPool({
        maxConcurrent: worker.maxConcurrency ?? 3,
      });
      this.workers.set(worker.id, pool);
      this.workerIds.push(worker.id);
    }
  }

  /**
   * Submit work to the pool
   */
  async submit<T>(work: WorkItem<T>): Promise<T> {
    const workerId = this.selectWorker();
    const pool = this.workers.get(workerId);
    if (!pool) {
      throw new Error(`Worker ${workerId} not found`);
    }
    return pool.run(work.execute);
  }

  /**
   * Submit multiple work items
   */
  async submitAll<T>(items: WorkItem<T>[]): Promise<T[]> {
    return Promise.all(items.map((item) => this.submit(item)));
  }

  private selectWorker(): string {
    switch (this.balanceStrategy) {
      case 'round-robin': {
        const id = this.workerIds[this.roundRobinIndex % this.workerIds.length]!;
        this.roundRobinIndex++;
        return id;
      }
      case 'random': {
        const idx = Math.floor(Math.random() * this.workerIds.length);
        return this.workerIds[idx]!;
      }
      case 'least-busy':
      default: {
        let leastBusy = this.workerIds[0]!;
        let minActive = Infinity;
        for (const [id, pool] of this.workers) {
          if (pool.active < minActive) {
            minActive = pool.active;
            leastBusy = id;
          }
        }
        return leastBusy;
      }
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): Map<string, { active: number; pending: number }> {
    const stats = new Map<string, { active: number; pending: number }>();
    for (const [id, pool] of this.workers) {
      stats.set(id, { active: pool.active, pending: pool.pending });
    }
    return stats;
  }

  /**
   * Get total active work items across all workers
   */
  get totalActive(): number {
    let total = 0;
    for (const pool of this.workers.values()) {
      total += pool.active;
    }
    return total;
  }

  /**
   * Get total pending work items across all workers
   */
  get totalPending(): number {
    let total = 0;
    for (const pool of this.workers.values()) {
      total += pool.pending;
    }
    return total;
  }
}

// ============================================================================
// Exports
// ============================================================================

export default {
  ParallelExecutor,
  WorkerPool,
  createParallelExecutor,
  executeParallel,
  mapParallel,
  createTask,
};
