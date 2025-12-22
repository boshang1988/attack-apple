/**
 * Dual Tournament Engine
 *
 * Shared scoring/ranking utilities used by dual tournaments in both /upgrade and /attack flows.
 * Encodes policy vs evaluator tournaments with human-like reward heuristics and multi-evaluator
 * aggregation to approximate human code review preferences.
 */

export type PolicyId = string;

export interface TournamentPolicy {
  id: PolicyId;
  label?: string;
  kind?: 'primary' | 'refiner' | 'checkpoint' | 'attack';
  elo?: number;
}

export interface TournamentEvaluator {
  id: string;
  label?: string;
  /** Weight used when combining evaluator rankings (can be influenced by historical ELO). */
  weight?: number;
  kind?: 'hard' | 'soft' | 'hybrid';
  elo?: number;
}

export interface TournamentTask {
  id: string;
  goal: string;
  repoSnapshot?: string;
  tests?: string[];
  constraints?: string[];
  metadata?: Record<string, unknown>;
}

export interface CandidateMetrics {
  executionSuccess?: number; // 0-1
  testsPassed?: number; // 0-1
  testsFailed?: number; // count
  staticAnalysis?: number; // 0-1
  codeQuality?: number; // 0-1
  blastRadius?: number; // 0-1 (smaller diff => higher)
  diffSize?: number; // lines changed
  complexityDelta?: number; // negative better
  dependenciesAdded?: number; // count
  speedBonus?: number; // 0-1
  toolSuccesses?: number; // count
  toolFailures?: number; // count
  warnings?: number; // count
}

export interface CandidateSignals {
  /** Learned reward model / preference score (0-1) */
  rewardModelScore?: number;
  /** Self-assessed confidence from the agent (0-1) */
  selfAssessment?: number;
  /** Optional human preference label (0-1) */
  humanPreference?: number;
}

export interface EvaluatorScore {
  evaluatorId: string;
  score: number;
  weight?: number;
  notes?: string;
}

type CandidateEvaluatorScore = EvaluatorScore & { candidateId: string };

export interface TournamentCandidate {
  id: string;
  policyId: PolicyId;
  patchSummary?: string;
  diffSummary?: string;
  metrics?: CandidateMetrics;
  signals?: CandidateSignals;
  evaluatorScores?: EvaluatorScore[];
  rawOutput?: string;
}

export interface HumanRewardWeights {
  /** Correctness weight */
  alpha: number;
  /** Code quality / robustness weight */
  beta: number;
  /** Learned reward / human preference weight */
  gamma: number;
}

export const DEFAULT_HUMAN_REWARD_WEIGHTS: HumanRewardWeights = {
  alpha: 0.6,
  beta: 0.25,
  gamma: 0.15,
};

export interface RankedCandidate {
  candidateId: string;
  aggregateScore: number;
  /** Relative human-like accuracy (1 = best rank, 0 = worst rank) */
  humanAccuracy: number;
  rank: number;
  correctnessScore: number;
  qualityScore: number;
  learnedScore: number;
  evaluatorScore: number;
}

export type PairwiseWins = Record<string, Record<string, number>>;

export interface TournamentOutcome {
  task: TournamentTask;
  ranked: RankedCandidate[];
  pairwise: PairwiseWins;
  evaluatorBreakdown: Record<string, EvaluatorScore[]>;
}

export interface TournamentOptions {
  rewardWeights?: HumanRewardWeights;
  evaluators?: TournamentEvaluator[];
  /** When true, prefer smaller diffs by default if diffSize is provided */
  preferSmallerDiff?: boolean;
  /** Maximum candidates to evaluate (caps O(n^2) work) */
  maxCandidates?: number;
}

/**
  * Run a dual tournament over candidate patches/agents, combining hard metrics,
  * human-like reward heuristics, and evaluator rankings.
  */
export function runDualTournament(
  task: TournamentTask,
  candidates: TournamentCandidate[],
  options: TournamentOptions = {}
): TournamentOutcome {
  const maxCandidates = options.maxCandidates ?? 8;
  const boundedCandidates = candidates.slice(0, Math.max(1, maxCandidates));

  // Fast path: single candidate - avoid unnecessary aggregation work
  if (boundedCandidates.length === 1) {
    const solo = boundedCandidates[0]!;
    const correctness = scoreCorrectness(solo.metrics);
    const quality = scoreQuality(solo.metrics, options.preferSmallerDiff ?? true);
    const learned = scoreLearnedSignals(solo.signals);
    const aggregateScore = combineReward(correctness, quality, learned, options.rewardWeights ?? DEFAULT_HUMAN_REWARD_WEIGHTS);

    const ranked: RankedCandidate[] = [{
      candidateId: solo.id,
      aggregateScore,
      humanAccuracy: 1,
      rank: 1,
      correctnessScore: correctness,
      qualityScore: quality,
      learnedScore: learned,
      evaluatorScore: aggregateScore,
    }];

    return {
      task,
      ranked,
      pairwise: {},
      evaluatorBreakdown: {},
    };
  }

  const rewardWeights = options.rewardWeights ?? DEFAULT_HUMAN_REWARD_WEIGHTS;
  const evaluatorWeights = new Map<string, number>();
  for (const evaluator of options.evaluators ?? []) {
    const eloWeight = evaluator.elo ? 1 + Math.max(0, (evaluator.elo - 1200) / 2400) : 1;
    evaluatorWeights.set(evaluator.id, (evaluator.weight ?? 1) * eloWeight);
  }

  // Compute evaluator aggregates and pairwise wins first (needed for composite score)
  const { aggregatedEvaluatorScores, pairwise, evaluatorBreakdown } = aggregateEvaluatorScores(
    boundedCandidates,
    evaluatorWeights
  );

  const ranked: RankedCandidate[] = boundedCandidates.map((candidate) => {
    const correctness = scoreCorrectness(candidate.metrics);
    const quality = scoreQuality(candidate.metrics, options.preferSmallerDiff ?? true);
    const learned = scoreLearnedSignals(candidate.signals);
    const rewardScore = combineReward(correctness, quality, learned, rewardWeights);
    const evaluatorScore = aggregatedEvaluatorScores.get(candidate.id) ?? rewardScore;

    // Combine human-like reward with evaluator aggregate (relative preference)
    // Weighted 60/40 toward human-like reward to maintain quality focus while incorporating evaluator consensus
    const aggregateScore = clamp(0.60 * rewardScore + 0.40 * evaluatorScore);

    return {
      candidateId: candidate.id,
      aggregateScore,
      humanAccuracy: 0,
      rank: 0, // set after sorting
      correctnessScore: correctness,
      qualityScore: quality,
      learnedScore: learned,
      evaluatorScore,
    };
  });

  ranked.sort((a, b) => b.aggregateScore - a.aggregateScore);
  ranked.forEach((entry, idx) => {
    entry.rank = idx + 1;
    entry.humanAccuracy = computeHumanAccuracy(idx, ranked.length);
  });

  return {
    task,
    ranked,
    pairwise,
    evaluatorBreakdown,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Internal scoring helpers
// ════════════════════════════════════════════════════════════════════════════

function scoreCorrectness(metrics?: CandidateMetrics): number {
  if (!metrics) return 0.5;

  const execution = metrics.executionSuccess ?? 0;
  const tests = metrics.testsPassed ?? 0;
  const failures = metrics.testsFailed ?? 0;
  const toolSuccess = metrics.toolSuccesses ? Math.min(1, metrics.toolSuccesses / 3) : 0;

  let score = execution * 0.35 + tests * 0.45 + toolSuccess * 0.2;
  if (failures > 0) {
    score -= Math.min(0.35, failures * 0.1);
  }

  return clamp(score);
}

function scoreQuality(metrics?: CandidateMetrics, preferSmallerDiff = true): number {
  if (!metrics) return 0.5;

  const staticAnalysis = metrics.staticAnalysis ?? 0.5;
  const codeQuality = metrics.codeQuality ?? 0.5;
  const complexityComponent =
    typeof metrics.complexityDelta === 'number'
      ? metrics.complexityDelta < 0
        ? 0.7
        : 0.45
      : 0.55;

  const blastRadius =
    metrics.blastRadius ??
    (preferSmallerDiff && metrics.diffSize ? 1 - clamp(metrics.diffSize / 500) : 0.55);

  const dependencyPenalty = metrics.dependenciesAdded ? Math.min(0.3, metrics.dependenciesAdded * 0.05) : 0;
  const warningPenalty = metrics.warnings ? Math.min(0.2, metrics.warnings * 0.05) : 0;

  let score = staticAnalysis * 0.35 + codeQuality * 0.25 + blastRadius * 0.25 + complexityComponent * 0.15;
  score -= dependencyPenalty + warningPenalty;

  return clamp(score);
}

function scoreLearnedSignals(signals?: CandidateSignals): number {
  if (!signals) return 0.5;

  const rewardModel = signals.rewardModelScore;
  const human = signals.humanPreference;
  const self = signals.selfAssessment;

  // Prioritize reward model score as primary signal (40%)
  // Human preference as secondary (35%)
  // Self-assessment as tertiary (25%)
  // This weights external validation more than self-confidence
  const components = [
    { value: rewardModel, weight: 0.40, default: 0.5 },
    { value: human, weight: 0.35, default: 0.5 },
    { value: self, weight: 0.25, default: 0.5 }
  ];

  let totalWeight = 0;
  let weightedSum = 0;

  for (const comp of components) {
    if (typeof comp.value === 'number') {
      weightedSum += comp.value * comp.weight;
      totalWeight += comp.weight;
    } else {
      weightedSum += comp.default * comp.weight;
      totalWeight += comp.weight;
    }
  }

  return totalWeight > 0 ? clamp(weightedSum / totalWeight) : 0.5;
}

function combineReward(
  correctness: number,
  quality: number,
  learned: number,
  weights: HumanRewardWeights
): number {
  const weighted =
    weights.alpha * correctness +
    weights.beta * quality +
    weights.gamma * learned;
  const total = weights.alpha + weights.beta + weights.gamma;
  return total > 0 ? clamp(weighted / total) : clamp(weighted);
}

function aggregateEvaluatorScores(
  candidates: TournamentCandidate[],
  evaluatorWeights: Map<string, number>
): {
  aggregatedEvaluatorScores: Map<string, number>;
  pairwise: PairwiseWins;
  evaluatorBreakdown: Record<string, EvaluatorScore[]>;
} {
  const pairwise: PairwiseWins = {};
  const aggregated = new Map<string, number>();
  const evaluatorBreakdown: Record<string, EvaluatorScore[]> = {};

  if (candidates.length === 0) {
    return { aggregatedEvaluatorScores: aggregated, pairwise, evaluatorBreakdown };
  }

  // Pre-size for small tournaments to avoid unnecessary O(n^2) when not needed
  const twoCandidateFastPath = candidates.length <= 2;

  const candidateIds = candidates.map((c) => c.id);
  for (const id of candidateIds) {
    pairwise[id] = {};
    for (const other of candidateIds) {
      if (id !== other) pairwise[id][other] = 0;
    }
  }

  // Collect scores per evaluator
  const scoresByEvaluator = new Map<string, CandidateEvaluatorScore[]>();
  for (const candidate of candidates) {
    for (const score of candidate.evaluatorScores ?? []) {
      if (!scoresByEvaluator.has(score.evaluatorId)) {
        scoresByEvaluator.set(score.evaluatorId, []);
      }
      scoresByEvaluator.get(score.evaluatorId)!.push({
        evaluatorId: score.evaluatorId,
        score: clamp(score.score),
        weight: score.weight,
        notes: score.notes,
        candidateId: candidate.id,
      });
    }
  }

  // If no evaluator scores provided, fall back to neutral rankings
  if (scoresByEvaluator.size === 0) {
    const fallback: CandidateEvaluatorScore[] = [];
    for (const candidate of candidates) {
      // Use candidate's own reward signals if available
      const candidateScore = candidate.signals?.rewardModelScore ?? 0.5;
      fallback.push({
        evaluatorId: 'reward-fallback',
        score: candidateScore,
        weight: 1,
        candidateId: candidate.id,
      });
    }
    scoresByEvaluator.set('reward-fallback', fallback);
  }

  let totalBordaWeight = 0;

  for (const [evaluatorId, rawScores] of scoresByEvaluator.entries()) {
    const weight = evaluatorWeights.get(evaluatorId) ?? 1;
    totalBordaWeight += weight * Math.max(1, candidates.length - 1);

    // Sort descending by score to assign ranks (Borda)
    const ranked = rawScores
      .filter((entry) => typeof entry.score === 'number')
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    evaluatorBreakdown[evaluatorId] = ranked.map(({ candidateId: _, ...rest }) => rest as EvaluatorScore);

    ranked.forEach((entry, idx) => {
      const candidateId = (entry as unknown as { candidateId: string }).candidateId;
      const bordaPoints = (candidates.length - idx - 1) * weight;
      aggregated.set(candidateId, (aggregated.get(candidateId) ?? 0) + bordaPoints);
    });

    // Pairwise wins for this evaluator (lightweight path for <=2 candidates)
    if (twoCandidateFastPath && ranked.length === 2) {
      const higher = ranked[0] as unknown as { candidateId: string; score: number };
      const lower = ranked[1] as unknown as { candidateId: string; score: number };
      if (higher.score === lower.score) {
        pairwise[higher.candidateId][lower.candidateId] += weight * 0.5;
        pairwise[lower.candidateId][higher.candidateId] += weight * 0.5;
      } else {
        pairwise[higher.candidateId][lower.candidateId] += weight;
      }
    } else {
      for (let i = 0; i < ranked.length; i++) {
        for (let j = i + 1; j < ranked.length; j++) {
          const higher = ranked[i] as unknown as { candidateId: string; score: number };
          const lower = ranked[j] as unknown as { candidateId: string; score: number };
          if (higher.score === lower.score) {
            pairwise[higher.candidateId][lower.candidateId] += weight * 0.5;
            pairwise[lower.candidateId][higher.candidateId] += weight * 0.5;
          } else {
            pairwise[higher.candidateId][lower.candidateId] += weight;
          }
        }
      }
    }
  }

  // Normalize aggregated Borda scores into [0,1]
  if (totalBordaWeight > 0) {
    for (const [candidateId, points] of aggregated.entries()) {
      aggregated.set(candidateId, clamp(points / totalBordaWeight));
    }
  }

  // Ensure every candidate has an entry
  for (const candidateId of candidateIds) {
    if (!aggregated.has(candidateId)) {
      aggregated.set(candidateId, 0.5);
    }
  }

  return { aggregatedEvaluatorScores: aggregated, pairwise, evaluatorBreakdown };
}

function clamp(value: number, min = 0, max = 1): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function computeHumanAccuracy(rankIndex: number, total: number): number {
  if (total <= 1) return 1;
  const maxIndex = Math.max(1, total - 1);
  const relative = 1 - rankIndex / maxIndex;
  return clamp(relative);
}
