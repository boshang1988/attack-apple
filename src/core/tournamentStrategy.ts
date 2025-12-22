import {
  DEFAULT_HUMAN_REWARD_WEIGHTS,
  type HumanRewardWeights,
  type TournamentEvaluator,
} from './dualTournament.js';
import type { RepoUpgradeModule } from './repoUpgradeOrchestrator.js';

export interface TelemetrySnapshot {
  winsPrimary: number;
  winsRefiner: number;
}

export interface EvaluatorConfig {
  rewardWeights: HumanRewardWeights;
  evaluators: TournamentEvaluator[];
}

function cloneWeights(weights: HumanRewardWeights): HumanRewardWeights {
  return { ...weights };
}

function isTestHeavy(module: RepoUpgradeModule): boolean {
  return module.label.toLowerCase().includes('test') || module.scope.some((s) => s.includes('test'));
}

export function buildEvaluatorConfig(
  module: RepoUpgradeModule,
  telemetry?: Map<string, TelemetrySnapshot>
): EvaluatorConfig {
  const rewardWeights = cloneWeights(DEFAULT_HUMAN_REWARD_WEIGHTS);
  const evaluators: TournamentEvaluator[] = [
    { id: 'hard-metrics', weight: 1.2 },
    { id: 'quality', weight: 1.0 },
    { id: 'reward-model', weight: 1.0 },
  ];

  // Emphasize correctness for test-heavy modules
  if (isTestHeavy(module)) {
    rewardWeights.alpha = Math.max(rewardWeights.alpha, 0.7);
    const hard = evaluators.find((e) => e.id === 'hard-metrics');
    if (hard) hard.weight = Math.max(hard.weight ?? 1, 1.8);
  }

  // Apply telemetry bias
  const key = module.label.toLowerCase().includes('test') ? 'tests' : 'general';
  const snapshot = telemetry?.get(key);
  if (snapshot) {
    if (snapshot.winsPrimary > snapshot.winsRefiner) {
      rewardWeights.alpha = Math.min(0.85, rewardWeights.alpha + 0.05);
      const hard = evaluators.find((e) => e.id === 'hard-metrics');
      if (hard) hard.weight = (hard.weight ?? 1) + 0.4;
    } else if (snapshot.winsRefiner > snapshot.winsPrimary) {
      rewardWeights.beta = Math.max(0.3, rewardWeights.beta + 0.05);
      const quality = evaluators.find((e) => e.id === 'quality');
      if (quality) quality.weight = (quality.weight ?? 1) + 0.2;
    }
  }

  return { rewardWeights, evaluators };
}
