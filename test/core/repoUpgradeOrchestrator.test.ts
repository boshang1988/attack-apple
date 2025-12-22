import { RepoUpgradeOrchestrator, type RepoUpgradeModule, type RepoUpgradeStep, type UpgradeStepExecutionInput, type UpgradeStepResult } from '../../src/core/repoUpgradeOrchestrator.js';
import { REPO_UPGRADE_MODE_DEFINITIONS } from '../../src/core/repoUpgradeOrchestrator.js';

const moduleStub: RepoUpgradeModule = {
  id: 'mod',
  label: 'Module',
  scope: ['src/**/*'],
  steps: [
    { id: 'mod-analyze', intent: 'analyze', description: 'analyze' },
  ] as RepoUpgradeStep[],
};

function makeExecutor(behavior: (input: UpgradeStepExecutionInput) => UpgradeStepResult) {
  return async (input: UpgradeStepExecutionInput): Promise<UpgradeStepResult> => {
    return behavior(input);
  };
}

describe('RepoUpgradeOrchestrator (core flow)', () => {
  it('runs sequential variants when no refiner workspace is provided', async () => {
    const calls: UpgradeStepExecutionInput[] = [];
    const executor = makeExecutor((input) => {
      calls.push(input);
      const score = input.variant === 'primary' ? 0.6 : 0.7;
      return { success: true, summary: `${input.variant}-ok`, detail: '', score };
    });

    const orchestrator = new RepoUpgradeOrchestrator(executor);
    const modeDefinition = REPO_UPGRADE_MODE_DEFINITIONS['dual-rl-tournament'];

    const report = await orchestrator.run(
      { modules: [moduleStub] },
      {
        mode: 'dual-rl-tournament',
        continueOnFailure: true,
        parallelVariants: false,
        variantWorkspaceRoots: { primary: '/tmp/work' },
      }
    );

    expect(calls.map((c) => c.variant)).toEqual(['primary', 'refiner']);
    // Tournament might bias primary; ensure both ran and winner recorded
    expect(report.modules[0]?.steps[0]?.winnerVariant).toBeDefined();
  });

  it('runs variants in parallel when distinct workspaces are provided', async () => {
    const variants: string[] = [];
    const executor = makeExecutor((input) => {
      variants.push(input.variant);
      return { success: true, summary: `${input.variant}-ok`, detail: '', score: 0.5 };
    });

    const orchestrator = new RepoUpgradeOrchestrator(executor);
    const report = await orchestrator.run(
      { modules: [moduleStub] },
      {
        mode: 'dual-rl-tournament',
        continueOnFailure: true,
        parallelVariants: true,
        variantWorkspaceRoots: { primary: '/tmp/p', refiner: '/tmp/r' },
      }
    );

    expect(new Set(variants)).toEqual(new Set(['primary', 'refiner']));
    expect(report.modules[0]?.steps[0]?.winnerVariant).toBeDefined();
  });
});
