import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUnifiedOpsTools } from '../src/tools/unifiedOps.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'unified-ops-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('UnifiedOps', () => {
  it('lists available tools', async () => {
    const [unified] = createUnifiedOpsTools(tmpDir);
    const output = await unified.handler({ tool: 'list' });
    expect(output).toContain('Available tools:');
    expect(output).toContain('Bash');
    expect(output).toContain('GenerateTool');
    expect(output).toContain('HumanIntegration');
  });

  it('dispatches to GenerateTool', async () => {
    const [unified] = createUnifiedOpsTools(tmpDir);
    const result = await unified.handler({
      tool: 'GenerateTool',
      args: {
        name: 'SampleTool',
        description: 'Demo tool',
        intent: 'test',
      },
    });
    const parsed = JSON.parse(String(result));
    expect(parsed.name).toBe('SampleTool');
    expect(parsed.toolDefinition?.name).toBe('SampleTool');
  });
});
