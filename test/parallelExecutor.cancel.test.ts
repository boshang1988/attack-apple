import { ParallelExecutor, type ParallelTask } from '../src/core/parallelExecutor.js';

describe('ParallelExecutor cancellation on failure (core-first)', () => {
  it('cancels remaining tasks when continueOnFailure is false', async () => {
    const executor = new ParallelExecutor({ maxConcurrency: 2, continueOnFailure: false });

    const tasks: ParallelTask<string>[] = [
      {
        id: 't1',
        execute: async () => 'ok-1',
        parallelizable: true,
      },
      {
        id: 't2',
        execute: async () => {
          throw new Error('boom');
        },
        parallelizable: true,
      },
      {
        id: 't3',
        execute: async () => 'ok-3',
        parallelizable: true,
        dependencies: ['t2'],
      },
    ];

    const result = await executor.execute(tasks);

    const statuses = Object.fromEntries(result.results.map((r) => [r.taskId, r.status]));
    expect(statuses['t1']).toBe('completed');
    expect(statuses['t2']).toBe('failed');
    expect(statuses['t3']).toBe('cancelled');
  });
});
