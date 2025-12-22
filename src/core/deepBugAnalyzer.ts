export interface BugReport {
  title: string;
  description: string;
  expectedBehavior?: string;
  actualBehavior?: string;
  stackTrace?: string;
}

export interface BugAnalysisResult {
  primaryCause?: {
    category: string;
    description: string;
    confidence: number;
  };
  contributingFactors: Array<{
    category: string;
    description: string;
    confidence: number;
  }>;
  recommendedActions: string[];
  confidence: number;
}

export class DeepBugAnalyzer {
  async analyze(
    bug: BugReport,
    codeContext: Map<string, string>,
    depth: 'shallow' | 'moderate' | 'deep' = 'moderate'
  ): Promise<BugAnalysisResult> {
    const signals: string[] = [];
    const contextText = Array.from(codeContext.values()).join('\n').toLowerCase();
    const lowerDesc = `${bug.description ?? ''} ${bug.stackTrace ?? ''}`.toLowerCase();

    if (lowerDesc.includes('null') || lowerDesc.includes('undefined') || contextText.includes('null') || contextText.includes('undefined')) {
      signals.push('null/undefined access');
    }
    if (lowerDesc.includes('race') || lowerDesc.includes('concurrent')) {
      signals.push('possible race condition');
    }

    const primaryCause = signals.length
      ? {
          category: 'code',
          description: signals[0]!,
          confidence: 0.7,
        }
      : {
          category: 'unknown',
          description: 'Insufficient context; investigate logs and inputs.',
          confidence: 0.4,
        };

    const contributingFactors = signals.slice(1).map((signal) => ({
      category: 'code',
      description: signal,
      confidence: 0.5,
    }));

    const recommendedActions = [
      'Add null/undefined guards around user input',
      'Capture minimal reproduction steps',
      'Add unit tests around the failing path',
    ];
    if (depth === 'deep') {
      recommendedActions.push('Trace async boundaries to rule out race conditions');
    }

    return {
      primaryCause,
      contributingFactors,
      recommendedActions,
      confidence: primaryCause.confidence,
    };
  }
}
