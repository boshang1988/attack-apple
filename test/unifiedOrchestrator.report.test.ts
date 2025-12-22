import { describe, expect, it } from '@jest/globals';
import { UnifiedOrchestrator, type ExecutionResult, type Finding } from '../src/core/unifiedOrchestrator.js';

const makeResult = (overrides: Partial<ExecutionResult> = {}): ExecutionResult => ({
  success: true,
  output: 'ok',
  duration: 1,
  command: 'echo ok',
  ...overrides,
});

describe('UnifiedOrchestrator reporting', () => {
  it('deduplicates findings/recommendations and surfaces failed commands clearly', () => {
    const orchestrator = new UnifiedOrchestrator();

    (orchestrator as any).results = [
      makeResult({ command: 'echo ok' }),
      makeResult({ command: 'npm run lint', success: false, error: 'lint failed', output: 'lint failed', duration: 2 }),
      makeResult({ command: 'echo done' }),
    ];

    (orchestrator as any).findings = [
      {
        severity: 'critical',
        category: 'Security',
        title: 'Potential secrets in code',
        description: 'hit',
        evidence: 'secret-one',
        recommendation: 'Remove secrets',
      },
      {
        severity: 'critical',
        category: 'Security',
        title: 'Potential secrets in code',
        description: 'hit again',
        evidence: 'secret-two',
        recommendation: 'Remove secrets',
      },
      {
        severity: 'medium',
        category: 'Code Quality',
        title: 'Linting errors',
        description: 'lint',
        evidence: '2 errors',
        recommendation: 'Run lint',
      },
    ] satisfies Finding[];

    const report = orchestrator.generateReport('Test run');

    expect(report.findings.filter(f => f.title === 'Potential secrets in code')).toHaveLength(1);
    const mergedSecret = report.findings.find(f => f.title === 'Potential secrets in code');
    expect(mergedSecret?.evidence).toContain('secret-one');
    expect(mergedSecret?.evidence).toContain('secret-two');
    expect(report.recommendations).toEqual(['Remove secrets', 'Run lint']);
    expect(report.exitReason).toBe('failed-commands');
    expect(report.statusSummary).toMatch(/failed/i);
  });

  it('marks critical findings when commands succeed', () => {
    const orchestrator = new UnifiedOrchestrator();
    (orchestrator as any).results = [
      makeResult({ command: 'echo ok' }),
      makeResult({ command: 'echo ok 2' }),
    ];
    (orchestrator as any).findings = [
      {
        severity: 'critical',
        category: 'Security',
        title: 'High risk',
        description: 'risk',
        evidence: 'evidence',
      },
    ] satisfies Finding[];

    const report = orchestrator.generateReport('Audit');

    expect(report.exitReason).toBe('critical-findings');
    expect(report.success).toBe(false);
  });

  it('ALWAYS generates next steps even when no findings exist', () => {
    const orchestrator = new UnifiedOrchestrator();
    (orchestrator as any).results = [
      makeResult({ command: 'python pipeline.py', output: 'wrote cancer_data.csv' }),
      makeResult({ command: 'python train.py', output: 'model trained' }),
    ];
    (orchestrator as any).findings = []; // No findings

    const report = orchestrator.generateReport('cure cancer research');

    // Should generate meaningful next steps even without findings
    expect(report.recommendations.length).toBeGreaterThan(0);
    // Should include research-specific next steps
    expect(report.recommendations.some(r => r.toLowerCase().includes('validate') || r.toLowerCase().includes('expert') || r.toLowerCase().includes('peer review'))).toBe(true);
  });

  it('generates context-aware next steps for ML tasks', () => {
    const orchestrator = new UnifiedOrchestrator();
    (orchestrator as any).results = [
      makeResult({ command: 'python train_model.py', output: 'model.json created' }),
    ];
    (orchestrator as any).findings = [];

    const report = orchestrator.generateReport('train ML model');

    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.recommendations.some(r => r.toLowerCase().includes('model') || r.toLowerCase().includes('test'))).toBe(true);
  });

  it('generates generic next steps for unknown task types', () => {
    const orchestrator = new UnifiedOrchestrator();
    (orchestrator as any).results = [
      makeResult({ command: 'do something', output: 'done' }),
    ];
    (orchestrator as any).findings = [];

    const report = orchestrator.generateReport('random task');

    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.recommendations.some(r => r.toLowerCase().includes('review') || r.toLowerCase().includes('verify'))).toBe(true);
  });
});
