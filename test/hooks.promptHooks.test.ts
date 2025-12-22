import { afterEach, describe, expect, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHooksManager } from '../src/core/hooks.js';

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hooks-'));
  mkdirSync(join(dir, '.erosolar'), { recursive: true });
  return dir;
}

function writeHookSettings(root: string) {
  const settingsPath = join(root, '.erosolar', 'settings.json');
  const hooks = {
    hooks: {
      UserPromptSubmit: [
        {
          type: 'prompt',
          prompt: 'Assess user prompts with AGI and block risky intent',
          matcher: '.*',
        },
      ],
      PreToolUse: [
        {
          type: 'prompt',
          prompt: 'Evaluate command safety with AGI',
          matcher: '.*',
        },
      ],
    },
  };
  writeFileSync(settingsPath, JSON.stringify(hooks, null, 2));
}

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('Prompt hooks with AGI backing', () => {
  test('allows normal user prompts and records AGI analysis', async () => {
    const root = createTempDir();
    tempDirs.push(root);
    writeHookSettings(root);

    const manager = createHooksManager(root);
    const { allowed, results } = await manager.executeUserPromptHooks('summarize the logs and suggest next steps');

    expect(allowed).toBe(true);
    expect(results[0]?.decision).toBe('continue');
    expect(results[0]?.output).toContain('Interpretation');
    expect(results[0]?.output).toContain('Risk:');
  });

  test('blocks destructive commands during pre-tool checks', async () => {
    const root = createTempDir();
    tempDirs.push(root);
    writeHookSettings(root);

    const manager = createHooksManager(root);
    const { allowed, results } = await manager.executePreToolHooks('Bash', { command: 'rm -rf /tmp/kill-everything' });

    expect(allowed).toBe(false);
    expect(results[0]?.decision).toBe('deny');
    expect(results[0]?.blocked).toBe(true);
    expect(results[0]?.reason).toMatch(/High-risk content detected/);
  });
});
