import type { TournamentOutcome } from './dualTournament.js';
import type { RepoUpgradeModeDefinition, UpgradeStepResult, UpgradeVariant } from './repoUpgradeOrchestrator.js';

export interface WinnerResolutionInput {
  modeDefinition: RepoUpgradeModeDefinition;
  variantResults: Partial<Record<UpgradeVariant, UpgradeStepResult>>;
  tournamentOutcome: TournamentOutcome | null;
}

export function resolveWinner(
  input: WinnerResolutionInput,
  pickWinner: (definition: RepoUpgradeModeDefinition, primary: UpgradeStepResult, refiner?: UpgradeStepResult) => {
    winner: UpgradeStepResult;
    winnerVariant: UpgradeVariant;
  }
): { winner: UpgradeStepResult; winnerVariant: UpgradeVariant } {
  const primary = input.variantResults.primary!;
  const refiner = input.variantResults.refiner;

  if (input.tournamentOutcome?.ranked?.length) {
    const top = input.tournamentOutcome.ranked[0]!;
    const winnerVariant: UpgradeVariant = top.candidateId === 'refiner' && refiner ? 'refiner' : 'primary';
    if (winnerVariant === 'primary') {
      primary.humanAccuracy = top.humanAccuracy;
    } else if (refiner) {
      refiner.humanAccuracy = top.humanAccuracy;
    }
    const winner = winnerVariant === 'refiner' && refiner ? refiner : primary;
    return { winner, winnerVariant };
  }

  return pickWinner(input.modeDefinition, primary, refiner);
}
