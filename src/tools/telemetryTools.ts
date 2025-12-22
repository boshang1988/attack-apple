import { RepoUpgradeOrchestrator } from '../core/repoUpgradeOrchestrator.js';

export function getRepoTelemetrySnapshot(): Record<string, { winsPrimary: number; winsRefiner: number }> {
  const snapshot: Record<string, { winsPrimary: number; winsRefiner: number }> = {};
  for (const [key, value] of RepoUpgradeOrchestrator.repoTypeTelemetry.entries()) {
    snapshot[key] = value;
  }
  return snapshot;
}
