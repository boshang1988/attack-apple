import { randomUUID } from 'node:crypto';

export type Evidence = {
  type: 'observation' | 'data' | 'test_result' | 'user_feedback';
  content: string;
  weight: number;
  timestamp: Date;
};

export interface Hypothesis {
  id: string;
  description: string;
  confidence: number;
  evidence: Evidence[];
  status: 'pending' | 'testing' | 'validated' | 'rejected';
}

export class BugHypothesisAnalyzer {
  scoreEvidence(evidence: Evidence[]): number {
    if (!evidence.length) return 0.3;
    const totalWeight = evidence.reduce((sum, item) => sum + item.weight, 0);
    const normalized = Math.max(0, Math.min(1, 0.5 + totalWeight / (evidence.length * 2)));
    return normalized;
  }
}

export class HypothesisEngine {
  private readonly maxHypotheses: number;
  private readonly analyzer: BugHypothesisAnalyzer;
  private hypotheses: Map<string, Hypothesis> = new Map();

  constructor(maxHypotheses = 10) {
    this.maxHypotheses = Math.max(1, maxHypotheses);
    this.analyzer = new BugHypothesisAnalyzer();
  }

  generateHypothesis(description: string, evidence: Evidence[] = []): Hypothesis {
    // Keep memory bounded
    if (this.hypotheses.size >= this.maxHypotheses) {
      const oldest = [...this.hypotheses.keys()][0];
      if (oldest) this.hypotheses.delete(oldest);
    }

    const confidence = this.analyzer.scoreEvidence(evidence);
    const hypothesis: Hypothesis = {
      id: randomUUID(),
      description,
      confidence,
      evidence: [...evidence],
      status: 'pending',
    };

    this.hypotheses.set(hypothesis.id, hypothesis);
    return hypothesis;
  }

  addEvidence(id: string, evidence: Evidence): void {
    const hyp = this.hypotheses.get(id);
    if (!hyp) return;
    hyp.evidence.push(evidence);
    hyp.confidence = this.analyzer.scoreEvidence(hyp.evidence);
    hyp.status = 'pending';
  }

  getHypothesis(id: string): Hypothesis | undefined {
    return this.hypotheses.get(id);
  }

  getBestHypothesis(): Hypothesis | undefined {
    let best: Hypothesis | undefined;
    for (const hyp of this.hypotheses.values()) {
      if (!best || hyp.confidence > best.confidence) {
        best = hyp;
      }
    }
    return best;
  }
}
