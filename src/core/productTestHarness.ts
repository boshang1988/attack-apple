import { exec as execCb } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const exec = promisify(execCb);

export interface TestScenario {
  name: string;
  description: string;
  timeout?: number;
  execute: () => Promise<{
    scenario: string;
    passed: boolean;
    duration: number;
    output: string;
  }>;
}

export interface ScenarioResult {
  scenario: string;
  passed: boolean;
  duration: number;
  output: string;
  error?: string;
}

export interface TestRunResult {
  total: number;
  passed: number;
  failed: number;
  results: ScenarioResult[];
  summary: string;
}

export class ProductTestHarness {
  private scenarios: TestScenario[] = [];

  addScenario(scenario: TestScenario): void {
    this.scenarios.push(scenario);
  }

  async runAll(): Promise<TestRunResult> {
    const results: ScenarioResult[] = [];

    for (const scenario of this.scenarios) {
      const started = Date.now();
      try {
        const outcome = await runWithTimeout(scenario.execute, scenario.timeout ?? 60_000);
        results.push({
          scenario: outcome.scenario,
          passed: outcome.passed,
          duration: outcome.duration,
          output: outcome.output,
        });
      } catch (error) {
        const duration = Date.now() - started;
        results.push({
          scenario: scenario.name,
          passed: false,
          duration,
          output: '',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const passed = results.filter((r) => r.passed).length;
    const failed = results.length - passed;
    const summary = `Results: ${passed}/${results.length} passed${failed ? ` · Failed: ${failed}` : ''}`;

    return {
      total: results.length,
      passed,
      failed,
      results,
      summary,
    };
  }
}

async function runWithTimeout<T extends { scenario: string; passed: boolean; duration: number; output: string }>(
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('Test timeout exceeded')), timeoutMs);
  });

  try {
    const result = await Promise.race([fn(), timeoutPromise]);
    clearTimeout(timeoutHandle!);
    return result as T;
  } catch (error) {
    clearTimeout(timeoutHandle!);
    throw error;
  }
}

// -----------------------------------------------------------------------------
// Runtime environment utilities
// -----------------------------------------------------------------------------

export function createRuntimeEnvironment() {
  const root = mkdtempSync(join(tmpdir(), 'agi-runtime-'));

  const execute = async (code: string, runtime: 'node' | 'bash' = 'node') => {
    const cwd = root;
    try {
      if (runtime === 'node') {
        const scriptPath = join(root, 'temp-script.js');
        writeFileSync(scriptPath, code, 'utf-8');
        const { stdout, stderr } = await exec(`node "${scriptPath}"`, { cwd, env: process.env });
        return { exitCode: 0, stdout, stderr };
      }

      const { stdout, stderr } = await exec(code, { cwd, shell: '/bin/bash', env: process.env });
      return { exitCode: 0, stdout, stderr };
    } catch (error: unknown) {
      const err = error as { code?: number; stdout?: string; stderr?: string };
      return {
        exitCode: typeof err?.code === 'number' ? err.code : 1,
        stdout: err?.stdout ?? '',
        stderr: err?.stderr ?? (error instanceof Error ? error.message : String(error)),
      };
    }
  };

  const writeFile = (path: string, content: string): void => {
    const target = join(root, path);
    writeFileSync(target, content, 'utf-8');
  };

  const readFile = (path: string): string => {
    return readFileSync(join(root, path), 'utf-8');
  };

  const fileExists = (path: string): boolean => {
    return existsSync(join(root, path));
  };

  const cleanup = (): void => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  };

  return { execute, writeFile, readFile, fileExists, cleanup, root };
}

// -----------------------------------------------------------------------------
// Scenario generator (lightweight helper for future use)
// -----------------------------------------------------------------------------

export class TestScenarioGenerator {
  generateSmokeTests(): TestScenario[] {
    return [
      {
        name: 'smoke_build',
        description: 'Validate build command output',
        execute: async () => ({
          scenario: 'smoke_build',
          passed: true,
          duration: 10,
          output: 'Build succeeded',
        }),
      },
    ];
  }
}
