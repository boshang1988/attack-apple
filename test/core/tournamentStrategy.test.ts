import { buildEvaluatorConfig, type TelemetrySnapshot } from '../../src/core/tournamentStrategy.js';
import type { RepoUpgradeModule } from '../../src/core/repoUpgradeOrchestrator.js';

const moduleBase: RepoUpgradeModule = {
  id: 'm',
  label: 'Module',
  description: '',
  scope: [],
  steps: [],
};

function moduleWithLabel(label: string, scope: string[]): RepoUpgradeModule {
  return { ...moduleBase, label, scope };
}

describe('buildEvaluatorConfig', () => {
  it('applies repo-type defaults for tests', () => {
    const cfg = buildEvaluatorConfig(moduleWithLabel('Tests', ['test/**/*']));
    expect(cfg.rewardWeights.alpha).toBeCloseTo(0.7);
    expect(cfg.evaluators.find((e) => e.id === 'hard-metrics')?.weight).toBeGreaterThan(1.5);
  });

  it('applies telemetry bias towards primary (hard metric focus)', () => {
    const telemetry = new Map<string, TelemetrySnapshot>();
    telemetry.set('general', { winsPrimary: 10, winsRefiner: 0 });

    const cfg = buildEvaluatorConfig(moduleWithLabel('General', ['src/**/*']), telemetry);
    expect(cfg.rewardWeights.alpha).toBeGreaterThan(0.6);
  });

  it('applies telemetry bias towards refiner (quality/reward focus)', () => {
    const telemetry = new Map<string, TelemetrySnapshot>();
    telemetry.set('general', { winsPrimary: 0, winsRefiner: 10 });

    const cfg = buildEvaluatorConfig(moduleWithLabel('General', ['src/**/*']), telemetry);
    expect(cfg.rewardWeights.beta).toBeGreaterThanOrEqual(0.3);
    expect(cfg.evaluators.find((e) => e.id === 'quality')?.weight).toBeGreaterThan(1.0);
  });
});
