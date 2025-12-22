import { resolveWinner } from '../../src/core/winnerStrategy.js';
import {
  REPO_UPGRADE_MODE_DEFINITIONS,
  type UpgradeStepResult,
} from '../../src/core/repoUpgradeOrchestrator.js';
import type { TournamentOutcome } from '../../src/core/dualTournament.js';

const modeDefinition = REPO_UPGRADE_MODE_DEFINITIONS['dual-rl-tournament'];

function makeResult(summary: string): UpgradeStepResult {
  return { success: true, summary, detail: summary, score: 0.5 };
}

describe('resolveWinner', () => {
  it('uses tournament outcome when available', () => {
    const primary = makeResult('primary');
    const refiner = makeResult('refiner');

    const outcome: TournamentOutcome = {
      task: { id: 't', goal: 'g' },
      ranked: [
        {
          candidateId: 'refiner',
          aggregateScore: 0.9,
          humanAccuracy: 1,
          rank: 1,
          correctnessScore: 1,
          qualityScore: 1,
          learnedScore: 1,
          evaluatorScore: 1,
        },
      ],
      pairwise: {},
      evaluatorBreakdown: {},
    };

    const { winnerVariant, winner } = resolveWinner(
      { modeDefinition, variantResults: { primary, refiner }, tournamentOutcome: outcome },
      () => ({ winner: primary, winnerVariant: 'primary' })
    );

    expect(winnerVariant).toBe('refiner');
    expect(winner.summary).toBe('refiner');
  });

  it('falls back to pickWinner when no tournament outcome', () => {
    const primary = makeResult('primary');
    const refiner = makeResult('refiner');
    const pickWinner = jest.fn().mockReturnValue({ winner: refiner, winnerVariant: 'refiner' as const });

    const { winnerVariant } = resolveWinner(
      { modeDefinition, variantResults: { primary, refiner }, tournamentOutcome: null },
      pickWinner
    );

    expect(pickWinner).toHaveBeenCalledWith(modeDefinition, primary, refiner);
    expect(winnerVariant).toBe('refiner');
  });
});
