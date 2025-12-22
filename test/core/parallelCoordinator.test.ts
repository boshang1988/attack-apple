import { ParallelCoordinator } from '../../src/core/parallelCoordinator.js';
import type { RepoUpgradeModule, UpgradeModuleReport } from '../../src/core/repoUpgradeOrchestrator.js';
import type { ParallelTask, BatchResult } from '../../src/core/parallelExecutor.js';

const moduleA: RepoUpgradeModule = { id: 'a', label: 'A', scope: [], steps: [] };
const moduleB: RepoUpgradeModule = { id: 'b', label: 'B', scope: [], steps: [] };

function makeResult(module: RepoUpgradeModule): UpgradeModuleReport {
  return { id: module.id, label: module.label, scope: module.scope, steps: [], status: 'completed' };
}

describe('ParallelCoordinator', () => {
  it('returns all results when continueOnFailure is true', async () => {
    const runner = {
      execute: async (tasks: ParallelTask<UpgradeModuleReport>[]): Promise<BatchResult<UpgradeModuleReport>> => ({
        batchId: 'batch',
        results: [
          { taskId: tasks[0]!.id, status: 'completed', result: makeResult(moduleA), durationMs: 1, attempts: 1, startedAt: 0, completedAt: 1 },
          { taskId: tasks[1]!.id, status: 'failed', result: undefined, durationMs: 1, attempts: 1, startedAt: 0, completedAt: 1 },
        ],
        totalDurationMs: 2,
        successCount: 1,
        failureCount: 1,
        parallelismAchieved: 1,
      }),
    };

    const coordinator = new ParallelCoordinator(() => runner);
    const reports = await coordinator.runModules(
      {
        concurrency: 2,
        mode: 'dual-rl-tournament',
        modeDefinition: { id: 'dual-rl-tournament', label: '', description: '', variants: ['primary', 'refiner'] },
        parallelVariants: true,
        continueOnFailure: true,
        variantStats: { primaryWins: 0, refinerWins: 0, ties: 0, totalSteps: 0 },
        processModule: async (module) => makeResult(module),
        emit: () => undefined,
      },
      [moduleA, moduleB]
    );

    expect(reports).toHaveLength(2);
    expect(reports[0]?.status).toBe('completed');
    expect(reports[1]?.status).toBe('failed');
  });

  it('truncates after first failure when continueOnFailure is false', async () => {
    const runner = {
      execute: async (tasks: ParallelTask<UpgradeModuleReport>[]): Promise<BatchResult<UpgradeModuleReport>> => ({
        batchId: 'batch',
        results: [
          { taskId: tasks[0]!.id, status: 'completed', result: makeResult(moduleA), durationMs: 1, attempts: 1, startedAt: 0, completedAt: 1 },
          { taskId: tasks[1]!.id, status: 'failed', result: undefined, durationMs: 1, attempts: 1, startedAt: 0, completedAt: 1 },
          { taskId: tasks[2]!.id, status: 'completed', result: makeResult(moduleB), durationMs: 1, attempts: 1, startedAt: 0, completedAt: 1 },
        ],
        totalDurationMs: 3,
        successCount: 2,
        failureCount: 1,
        parallelismAchieved: 1,
      }),
    };

    const coordinator = new ParallelCoordinator(() => runner);
    const reports = await coordinator.runModules(
      {
        concurrency: 2,
        mode: 'dual-rl-tournament',
        modeDefinition: { id: 'dual-rl-tournament', label: '', description: '', variants: ['primary', 'refiner'] },
        parallelVariants: true,
        continueOnFailure: false,
        variantStats: { primaryWins: 0, refinerWins: 0, ties: 0, totalSteps: 0 },
        processModule: async (module) => makeResult(module),
        emit: () => undefined,
      },
      [moduleA, moduleB, { ...moduleB, id: 'c', label: 'C' }]
    );

    expect(reports).toHaveLength(2); // includes the failed one, truncates after
    expect(reports[1]?.status).toBe('failed');
  });
});
