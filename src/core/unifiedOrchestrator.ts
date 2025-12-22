export interface ExecutionResult {
  success: boolean;
  output: string;
  duration: number;
  command?: string;
  error?: string;
}

export interface Finding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category?: string;
  title: string;
  description?: string;
  evidence?: string | string[];
  recommendation?: string;
}

export interface OperationConfig {
  objective: string;
}

export interface OrchestratorEvent {
  type: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface OperationReport {
  id: string;
  objective: string;
  startTime: number;
  endTime: number;
  duration: number;
  results: ExecutionResult[];
  findings: Finding[];
  recommendations: string[];
  summary: string;
  success: boolean;
  exitReason?: string;
  statusSummary?: string;
}

export class UnifiedOrchestrator {
  results: ExecutionResult[] = [];
  findings: Finding[] = [];

  private listeners = new Set<(event: OrchestratorEvent) => void>();

  onEvent(callback: (event: OrchestratorEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  protected emit(event: OrchestratorEvent): void {
    for (const cb of this.listeners) {
      try {
        cb(event);
      } catch {
        // Ignore listener failures to avoid breaking orchestration
      }
    }
  }

  async execute(config: Partial<OperationConfig>): Promise<OperationReport> {
    const start = Date.now();
    const report = this.generateReport(config.objective ?? '');
    const end = Date.now();
    return {
      ...report,
      id: report.id ?? `report-${start}`,
      objective: config.objective ?? '',
      startTime: start,
      endTime: end,
      duration: end - start,
    };
  }

  generateReport(objective: string): OperationReport {
    const dedupedFindings: Finding[] = [];
    const recSet = new Set<string>();
    const seen = new Map<string, Finding>();

    for (const finding of this.findings) {
      const key = `${finding.title}|${finding.recommendation ?? ''}`;
      const existing = seen.get(key);
      if (existing) {
        const evidence = [
          ...(Array.isArray(existing.evidence) ? existing.evidence : existing.evidence ? [existing.evidence] : []),
          ...(Array.isArray(finding.evidence) ? finding.evidence : finding.evidence ? [finding.evidence] : []),
        ];
        existing.evidence = Array.from(new Set(evidence));
        continue;
      }
      const clone: Finding = { ...finding };
      seen.set(key, clone);
      dedupedFindings.push(clone);
      if (clone.recommendation) {
        recSet.add(clone.recommendation);
      }
    }

    // Derive recommendations if none are present
    if (recSet.size === 0) {
      const lower = objective.toLowerCase();
      if (lower.includes('ml') || lower.includes('model') || lower.includes('train')) {
        recSet.add('Validate model outputs against a held-out set');
        recSet.add('Document evaluation metrics and risks');
      } else if (lower.includes('research') || lower.includes('cure')) {
        recSet.add('Peer review findings with a subject-matter expert');
        recSet.add('Validate data provenance and ethics approvals');
      } else {
        recSet.add('Review results with a teammate');
        recSet.add('Verify outputs and rerun if needed');
      }
    }

    const failedCommands = this.results.filter((r) => r && !r.success);
    const hasCritical = dedupedFindings.some((f) => f.severity === 'critical');

    let exitReason: OperationReport['exitReason'] = 'success';
    let success = true;
    if (failedCommands.length) {
      exitReason = 'failed-commands';
      success = false;
    } else if (hasCritical) {
      exitReason = 'critical-findings';
      success = false;
    }

    const statusSummary = [
      `${this.results.length} command(s)`,
      failedCommands.length ? `${failedCommands.length} failed` : 'all passed',
      dedupedFindings.length ? `${dedupedFindings.length} finding(s)` : 'no findings',
    ].join(' | ');

    return {
      id: `report-${Date.now()}`,
      objective,
      startTime: Date.now(),
      endTime: Date.now(),
      duration: 0,
      results: this.results.slice(),
      findings: dedupedFindings,
      recommendations: Array.from(recSet),
      summary: statusSummary,
      success,
      exitReason,
      statusSummary,
    };
  }
}
