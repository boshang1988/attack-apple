import { runDualTournament } from '../src/core/dualTournament.js';
import { RepoUpgradeOrchestrator, REPO_UPGRADE_MODE_DEFINITIONS, type UpgradeStepResult } from '../src/core/repoUpgradeOrchestrator.js';

describe('dualTournament engine', () => {
  it('uses fast path for single candidate with human accuracy = 1', () => {
    const outcome = runDualTournament(
      { id: 't1', goal: 'single candidate fast path' },
      [
        {
          id: 'primary',
          policyId: 'primary',
          metrics: { executionSuccess: 1, testsPassed: 1, staticAnalysis: 1 },
          signals: { rewardModelScore: 0.8 },
        },
      ]
    );

    expect(outcome.ranked).toHaveLength(1);
    const solo = outcome.ranked[0]!;
    expect(solo.humanAccuracy).toBe(1);
    expect(solo.aggregateScore).toBeGreaterThan(0.5);
    expect(Object.keys(outcome.pairwise)).toHaveLength(0);
  });

  it('prefers higher human accuracy when scores are tied', () => {
    const orchestrator = new RepoUpgradeOrchestrator(async () => ({
      success: true,
      summary: 'noop',
      score: 0,
    }));
    const def = REPO_UPGRADE_MODE_DEFINITIONS['dual-rl-tournament'];

    const primary: UpgradeStepResult = {
      success: true,
      summary: 'p',
      score: 0.5,
      humanAccuracy: 0.2,
    };
    const refiner: UpgradeStepResult = {
      success: true,
      summary: 'r',
      score: 0.5,
      humanAccuracy: 0.9,
    };

    // @ts-expect-error - access private helper for targeted tie-break test
    const { winnerVariant } = (orchestrator as unknown as { pickWinner: typeof orchestrator['pickWinner'] }).pickWinner(
      def,
      primary,
      refiner
    );

    expect(winnerVariant).toBe('refiner');
  });

  it('assigns descending human accuracy across ranked candidates', () => {
    const outcome = runDualTournament(
      { id: 't2', goal: 'rank accuracy' },
      [
        { id: 'p', policyId: 'p', metrics: { executionSuccess: 1, testsPassed: 1 }, signals: { rewardModelScore: 0.8 } },
        { id: 'r', policyId: 'r', metrics: { executionSuccess: 0.2, testsPassed: 0 }, signals: { rewardModelScore: 0.2 } },
      ]
    );

    const [top, bottom] = outcome.ranked;
    expect(top.humanAccuracy).toBe(1);
    expect(bottom.humanAccuracy).toBe(0);
    expect(top.aggregateScore).toBeGreaterThan(bottom.aggregateScore);
  });
});
