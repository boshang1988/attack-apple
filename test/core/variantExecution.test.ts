import { executeVariants, canRunVariantsParallel, resolveWorkspaceRoot } from '../../src/core/variantExecution.js';
import {
  REPO_UPGRADE_MODE_DEFINITIONS,
  type RepoUpgradeModule,
  type RepoUpgradeStep,
  type UpgradeStepResult,
  type UpgradeStepExecutionInput,
} from '../../src/core/repoUpgradeOrchestrator.js';

const modeDefinition = REPO_UPGRADE_MODE_DEFINITIONS['dual-rl-tournament'];
const moduleStub: RepoUpgradeModule = {
  id: 'mod',
  label: 'Module',
  scope: ['src/**/*'],
  steps: [],
};
const stepStub: RepoUpgradeStep = {
  id: 'mod-upgrade',
  intent: 'upgrade',
  description: 'Upgrade module',
};

describe('canRunVariantsParallel', () => {
  it('requires refiner root different from primary root', () => {
    expect(
      canRunVariantsParallel(modeDefinition, {
        parallelVariants: true,
        variantWorkspaceRoots: { primary: '/tmp/a', refiner: '/tmp/b' },
      })
    ).toBe(true);

    expect(
      canRunVariantsParallel(modeDefinition, {
        parallelVariants: true,
        variantWorkspaceRoots: { primary: '/tmp/a', refiner: '/tmp/a' },
      })
    ).toBe(false);
  });
});

describe('executeVariants', () => {
  it('runs sequentially and passes primary result to refiner', async () => {
    const calls: UpgradeStepExecutionInput[] = [];
    const executor = jest.fn<Promise<UpgradeStepResult>, [UpgradeStepExecutionInput]>(async (input) => {
      calls.push(input);
      return {
        success: true,
        summary: `${input.variant}-done`,
        detail: '',
        score: input.variant === 'primary' ? 1 : 0.8,
      };
    });

    const results = await executeVariants({
      module: moduleStub,
      step: stepStub,
      mode: 'dual-rl-tournament',
      modeDefinition,
      context: {
        parallelVariants: false,
        variantWorkspaceRoots: { primary: '/tmp/work', refiner: '/tmp/work' },
      },
      executeVariant: executor,
    });

    expect(executor).toHaveBeenCalledTimes(2);
    expect(calls[0]?.variant).toBe('primary');
    expect(calls[0]?.previousResult).toBeUndefined();
    expect(calls[1]?.variant).toBe('refiner');
    expect(calls[1]?.previousResult?.summary).toBe('primary-done');
    expect(results.refiner?.summary).toBe('refiner-done');
  });

  it('runs in parallel when roots differ and emits parallel event', async () => {
    const executor = jest.fn<Promise<UpgradeStepResult>, [UpgradeStepExecutionInput]>(async (input) => ({
      success: true,
      summary: `${input.variant}-done`,
      detail: '',
      score: input.variant === 'primary' ? 1 : 0.9,
    }));
    const emit = jest.fn();

    const results = await executeVariants({
      module: moduleStub,
      step: stepStub,
      mode: 'dual-rl-tournament',
      modeDefinition,
      context: {
        parallelVariants: true,
        variantWorkspaceRoots: { primary: '/tmp/primary', refiner: '/tmp/refiner' },
      },
      executeVariant: executor,
      emit,
    });

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'upgrade.step.variants.parallel',
        data: expect.objectContaining({ moduleId: 'mod', stepId: 'mod-upgrade' }),
      })
    );
    expect(executor).toHaveBeenCalledTimes(2);
    expect(executor.mock.calls[0]?.[0].previousResult).toBeUndefined();
    expect(executor.mock.calls[1]?.[0].previousResult).toBeUndefined();
    expect(results.primary?.summary).toBe('primary-done');
    expect(results.refiner?.summary).toBe('refiner-done');
  });
});

describe('resolveWorkspaceRoot', () => {
  it('prefers variant root and falls back to primary', () => {
    const context = {
      parallelVariants: true,
      variantWorkspaceRoots: { primary: '/tmp/primary', refiner: '/tmp/refiner' },
    };
    expect(resolveWorkspaceRoot('refiner', context)).toBe('/tmp/refiner');
    expect(resolveWorkspaceRoot('primary', context)).toBe('/tmp/primary');
  });
});
