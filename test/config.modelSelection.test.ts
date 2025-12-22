import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

function runResolveProfile(envOverrides: Record<string, string | undefined>): SpawnSyncReturns<string> {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return spawnSync(
    'node',
    [
      '--loader',
      'ts-node/esm',
      '-e',
      `
        import { resolveProfileConfig } from './src/config.js';
        const cfg = resolveProfileConfig('agi-code', null);
        console.log(JSON.stringify({ provider: cfg.provider, model: cfg.model, providerLocked: cfg.providerLocked }));
      `,
    ],
    {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
    }
  );
}

describe('resolveProfileConfig model/provider alignment (ts-node)', () => {
  it('infers provider from model when provider env is absent', () => {
    const result = runResolveProfile({
      AGI_CODE_MODEL: 'gpt-4o',
      AGI_CODE_PROVIDER: undefined,
    });

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout.trim()) as { provider: string; model: string; providerLocked: boolean };
    expect(payload.model).toBe('gpt-4o');
    expect(payload.provider).toBe('openai');
    expect(payload.providerLocked).toBe(false);
  });

  it('overrides mismatched provider env when model belongs to another provider', () => {
    const result = runResolveProfile({
      AGI_CODE_MODEL: 'claude-3-5-sonnet-20241022',
      AGI_CODE_PROVIDER: 'deepseek',
    });

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout.trim()) as { provider: string; model: string; providerLocked: boolean };
    expect(payload.provider).toBe('anthropic');
    expect(payload.model).toBe('claude-3-5-sonnet-20241022');
  });
});
