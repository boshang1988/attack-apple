import { RepoUpgradeOrchestrator, REPO_UPGRADE_MODE_DEFINITIONS, type UpgradeStepResult } from '../src/core/repoUpgradeOrchestrator.js';
import { resolveWinner as resolveWinnerStrategy } from '../src/core/winnerStrategy.js';

describe('RepoUpgradeOrchestrator.resolveWinner core-first', () => {
  it('prefers refiner when scores tie but accuracy is higher', async () => {
    const orchestrator = new RepoUpgradeOrchestrator(async () => ({
      success: true,
      summary: 'noop',
      score: 0,
    }));
    const mode = REPO_UPGRADE_MODE_DEFINITIONS['dual-rl-tournament'];

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
      humanAccuracy: 0.8,
    };

    // @ts-expect-error private helper exposed for test
    const pickWinner = orchestrator.pickWinner.bind(orchestrator);

    const outcome = resolveWinnerStrategy(
      {
        modeDefinition: mode,
        variantResults: { primary, refiner },
        tournamentOutcome: null,
      },
      pickWinner
    );
    expect(outcome.winnerVariant).toBe('refiner');
  });
});
