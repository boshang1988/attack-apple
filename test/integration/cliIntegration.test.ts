/**
 * CLI Integration Tests
 * Verifies that the unified orchestration plugins and core tools are wired correctly.
 */

import { describe, it, expect } from '@jest/globals';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createOrchestrationToolPlugin } from '../../src/plugins/tools/orchestration/orchestrationPlugin.js';
import { createBidirectionalAuditToolPlugin } from '../../src/plugins/tools/bidirectionalAudit/bidirectionalAuditPlugin.js';
import { createLocalFilesystemToolPlugin } from '../../src/plugins/tools/filesystem/localFilesystemPlugin.js';
import { createLocalSearchToolPlugin } from '../../src/plugins/tools/search/localSearchPlugin.js';
import { createEditToolPlugin } from '../../src/plugins/tools/edit/editPlugin.js';
import type { ToolDefinition } from '../../src/core/toolRuntime.js';

describe('CLI Integration', () => {
  describe('Unified orchestrator plugin', () => {
    it('creates the orchestration tool suite with key tools', async () => {
      const plugin = createOrchestrationToolPlugin();
      const module = await plugin.create({ workingDir: process.cwd(), env: process.env });
      const contribution = await module!.create({
        profile: 'agi-code',
        workspaceContext: null,
        workingDir: process.cwd(),
        env: process.env,
      });

      expect(contribution?.toolSuite?.id).toBe('orchestration.tools.unified');
      const toolNames = contribution?.toolSuite?.tools.map((t) => t.name) ?? [];
      expect(toolNames.length).toBeGreaterThan(0);
      expect(toolNames).toEqual(
        expect.arrayContaining([
          'analyze_errors',
          'verify_result',
          'hypothesis',
          'run_build',
          'run_tests',
          'run_lint',
          'run_type_check',
          'quality_gate',
          'summarize_orchestration',
        ])
      );
    });

    it('runs orchestration build/test flows and summaries without invoking heavy tasks', async () => {
      const workspace = mkdtempSync(join(tmpdir(), 'erosolar-orchestration-'));

      try {
        // Tiny script for a fast "build" run
        writeFileSync(join(workspace, 'echo-ok.js'), 'console.log("orchestration-ok")');

        const plugin = createOrchestrationToolPlugin();
        const module = await plugin.create({ workingDir: workspace, env: process.env });
        const contribution = await module!.create({
          profile: 'agi-code',
          workspaceContext: null,
          workingDir: workspace,
          env: process.env,
        });

        const tools = new Map((contribution?.toolSuite?.tools ?? []).map((t) => [t.name, t]));

        const summarize = tools.get('summarize_orchestration')!;
        expect(await summarize.handler!()).toMatch(/No orchestration runs/i);

        const qualityGate = tools.get('quality_gate')!;
        const qualityOutput = await qualityGate.handler!({
          dryRun: true,
          steps: ['build', 'lint', 'type-check', 'test', 'health'],
        });
        expect(qualityOutput).toMatch(/build/i);
        expect(qualityOutput).toMatch(/lint/i);
        expect(qualityOutput).toMatch(/type-check/i);
        expect(qualityOutput).toMatch(/test/i);

        const runBuild = tools.get('run_build')!;
        const buildOutput = await runBuild.handler!({
          command: `${process.execPath} echo-ok.js`,
          cwd: workspace,
        });
        expect(buildOutput).toMatch(/orchestration-ok/);

        const summarizeAfter = await summarize.handler!();
        expect(summarizeAfter).toMatch(/build/i);

        const analyze = tools.get('analyze_errors')!;
        const analysis = await analyze.handler!({ error: 'lint failed' });
        expect(analysis.toLowerCase()).toContain('lint');
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    });
  });

  describe('Bidirectional audit plugin', () => {
    it('exposes the bidirectional audit tool', async () => {
      const plugin = createBidirectionalAuditToolPlugin();
      const module = await plugin.create({ workingDir: process.cwd(), env: process.env });
      const contribution = await module!.create({
        profile: 'agi-code',
        workspaceContext: null,
        workingDir: process.cwd(),
        env: process.env,
      });

      const suites = contribution?.toolSuites ?? (contribution?.toolSuite ? [contribution.toolSuite] : []);
      expect(suites.length).toBeGreaterThan(0);

      const tools = suites.flatMap((suite) => suite.tools);
      const names = tools.map((t) => t.name);
      expect(names).toContain('BidirectionalAudit');
    });
  });
});

describe('Core engineering toolchain integration', () => {
  const profile = 'agi-code';
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  /**
   * Collect tool definitions from core CLI plugins without invoking an LLM.
   */
  async function loadToolMap(workingDir: string): Promise<Record<string, ToolDefinition>> {
    const toolDefs: ToolDefinition[] = [];
    const plugins = [
      createLocalFilesystemToolPlugin(),
      createLocalSearchToolPlugin(),
      createEditToolPlugin(),
    ];

    for (const plugin of plugins) {
      const created = await plugin.create({ workingDir, env: process.env });
      const modules = Array.isArray(created) ? created : [created];

      for (const module of modules) {
        if (!module) continue;
        const contributionResult = await module.create({
          profile: profile as any,
          workspaceContext: null,
          workingDir,
          env: process.env,
        });
        const contributions = Array.isArray(contributionResult) ? contributionResult : [contributionResult];
        for (const contribution of contributions) {
          if (contribution?.toolSuite) {
            toolDefs.push(...contribution.toolSuite.tools);
          }
          if (contribution?.toolSuites?.length) {
            for (const suite of contribution.toolSuites) {
              toolDefs.push(...suite.tools);
            }
          }
        }
      }
    }

    return toolDefs.reduce<Record<string, ToolDefinition>>((acc, tool) => {
      acc[tool.name] = tool;
      return acc;
    }, {});
  }

  it('exposes core filesystem/search/edit tools', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'erosolar-cli-core-'));
    tempDirs.push(workspace);

    const tools = await loadToolMap(workspace);
    expect(tools['list_files']).toBeDefined();
    expect(tools['read_file']).toBeDefined();
    expect(tools['Grep']).toBeDefined();
    expect(tools['Edit']).toBeDefined();
  });

  it('supports basic read/search/edit workflow', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'erosolar-cli-workflow-'));
    tempDirs.push(workspace);

    const srcDir = join(workspace, 'src');
    mkdirSync(srcDir, { recursive: true });

    const filePath = join(srcDir, 'example.ts');
    const originalContent = [
      'export function hello(name: string) {',
      '  return `hi ${name}`;',
      '}',
      '',
    ].join('\n');
    writeFileSync(filePath, originalContent);

    const tools = await loadToolMap(workspace);
    const listFiles = tools['list_files'];
    const readFile = tools['read_file'];
    const grep = tools['Grep'];
    const edit = tools['Edit'];

    // List files
    const listing = await listFiles.handler!({ path: 'src', recursive: true });
    expect(listing).toContain('example.ts');

    // Read file
    const readOutput = await readFile.handler!({ path: 'src/example.ts' });
    expect(readOutput).toContain('hello');

    // Search for content
    const grepOutput = await grep.handler!({
      pattern: 'hello',
      path: workspace,
      output_mode: 'files_with_matches',
    });
    expect(grepOutput).toContain('example.ts');

    // Edit file content
    const editOutput = await edit.handler!({
      file_path: filePath,
      old_string: 'return `hi ${name}`;',
      new_string: 'return `hello ${name}`;',
      replace_all: true,
    });
    expect(editOutput).toContain('hello');

    const updated = readFileSync(filePath, 'utf-8');
    expect(updated).toContain('hello ${name}');
  });
});
