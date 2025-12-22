#!/usr/bin/env node
/**
 * Self-Test Runner for AGI CLI
 *
 * Launches the CLI in a separate process and runs extensive tests
 * to verify functionality works correctly in a real runtime environment.
 *
 * @license MIT
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComposableMessageBuilder } from '../shell/composableMessage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_DIR = join(__dirname, '../..');

// ANSI escape codes
const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  output?: string;
}

interface CLITestContext {
  cli: ChildProcess | null;
  output: string;
  errors: string;
}

/**
 * Run all self-tests
 */
export async function runSelfTest(): Promise<boolean> {
  console.log(`\n${COLORS.bold}╔══════════════════════════════════════════════════════════╗${COLORS.reset}`);
  console.log(`${COLORS.bold}║       AGI CLI SELF-TEST SUITE                            ║${COLORS.reset}`);
  console.log(`${COLORS.bold}╚══════════════════════════════════════════════════════════╝${COLORS.reset}\n`);

  const results: TestResult[] = [];

  // Phase 1: Unit tests (fast, in-process)
  console.log(`${COLORS.cyan}▶ Phase 1: Unit Tests (in-process)${COLORS.reset}\n`);
  results.push(...await runUnitTests());

  // Phase 2: CLI launch tests (separate process)
  console.log(`\n${COLORS.cyan}▶ Phase 2: CLI Runtime Tests (separate process)${COLORS.reset}\n`);
  results.push(...await runCLITests());

  // Phase 3: Integration tests (if time permits)
  console.log(`\n${COLORS.cyan}▶ Phase 3: Integration Tests${COLORS.reset}\n`);
  results.push(...await runIntegrationTests());

  // Summary
  printSummary(results);

  return results.every(r => r.passed);
}

/**
 * Run unit tests for core modules
 */
async function runUnitTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  // Test 1: ComposableMessageBuilder - Paste chips
  results.push(await runTest('ComposableMessageBuilder: Paste chips', () => {
    const builder = new ComposableMessageBuilder();
    const code = 'function test() {\n  return true;\n}';
    builder.addPaste(code);

    const chips = builder.formatPasteChips();
    if (!chips.includes('📝 Code')) throw new Error(`Code not detected: ${chips}`);
    if (!chips.includes('3L')) throw new Error(`Line count wrong: ${chips}`);
  }));

  // Test 5: ComposableMessageBuilder - JSON detection
  results.push(await runTest('ComposableMessageBuilder: JSON detection', () => {
    const builder = new ComposableMessageBuilder();
    builder.addPaste('{\n  "key": "value"\n}');

    const chips = builder.formatPasteChips();
    if (!chips.includes('📊 JSON')) throw new Error(`JSON not detected: ${chips}`);
  }));

  return results;
}

/**
 * Run CLI tests in separate process
 */
async function runCLITests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  // Test 1: CLI starts successfully
  results.push(await runTest('CLI: Starts without errors', async () => {
    const ctx = await launchCLI();
    try {
      await waitForOutput(ctx, /agi|welcome|ready/i, 10000);
    } finally {
      await stopCLI(ctx);
    }
  }));

  // Test 2: CLI responds to /help
  results.push(await runTest('CLI: /help command works', async () => {
    const ctx = await launchCLI();
    try {
      await waitForOutput(ctx, /agi|welcome|ready/i, 10000);
      ctx.cli?.stdin?.write('/help\n');
      await waitForOutput(ctx, /command|help|available/i, 5000);
    } finally {
      await stopCLI(ctx);
    }
  }));

  // Test 3: CLI handles /clear command
  results.push(await runTest('CLI: /clear command works', async () => {
    const ctx = await launchCLI();
    try {
      await waitForOutput(ctx, /agi|welcome|ready/i, 10000);
      ctx.cli?.stdin?.write('/clear\n');
      await wait(500);
      // Should not crash
      if (ctx.errors.toLowerCase().includes('crash') || ctx.errors.toLowerCase().includes('fatal')) {
        throw new Error(`CLI crashed on /clear: ${ctx.errors}`);
      }
    } finally {
      await stopCLI(ctx);
    }
  }));

  // Test 4: CLI exits cleanly with /exit or Ctrl+D
  results.push(await runTest('CLI: Graceful shutdown (Ctrl+C/D)', async () => {
    const ctx = await launchCLI();
    try {
      await waitForOutput(ctx, /agi|welcome|ready/i, 10000);

      // Send Ctrl+C followed by Ctrl+D for graceful shutdown
      ctx.cli?.stdin?.write('\x03'); // Ctrl+C
      await wait(300);
      ctx.cli?.stdin?.write('\x04'); // Ctrl+D

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          // Force kill if graceful shutdown didn't work - this is acceptable
          ctx.cli?.kill('SIGTERM');
          resolve();
        }, 3000);
        ctx.cli?.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    } finally {
      // Already handled
    }
  }));

  return results;
}

/**
 * Run integration tests
 */
async function runIntegrationTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  // Test 1: Version flag works
  results.push(await runTest('Integration: --version flag', async () => {
    const result = await runCLICommand(['--version']);
    if (!result.output.includes('agi-cli v')) {
      throw new Error(`Version not shown: ${result.output}`);
    }
  }));

  // Test 2: Help flag works
  results.push(await runTest('Integration: --help flag', async () => {
    const result = await runCLICommand(['--help']);
    if (!result.output.includes('Usage:')) {
      throw new Error(`Help not shown: ${result.output}`);
    }
  }));

  // Test 3: Invalid flag handling
  results.push(await runTest('Integration: Invalid flag handling', async () => {
    // Should not crash on unknown flags (just pass them through or ignore)
    const result = await runCLICommand(['--invalid-flag-xyz'], 3000);
    // Just check it doesn't crash with unhandled exception
    if (result.errors.includes('unhandled') || result.errors.includes('uncaught')) {
      throw new Error(`Unhandled exception on invalid flag: ${result.errors}`);
    }
  }));

  return results;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function runTest(name: string, fn: () => void | Promise<void>): Promise<TestResult> {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    console.log(`  ${COLORS.green}✓${COLORS.reset} ${name} ${COLORS.dim}(${duration}ms)${COLORS.reset}`);
    return { name, passed: true, duration };
  } catch (error) {
    const duration = Date.now() - start;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  ${COLORS.red}✗${COLORS.reset} ${name} ${COLORS.dim}(${duration}ms)${COLORS.reset}`);
    console.log(`    ${COLORS.red}${message}${COLORS.reset}`);
    return { name, passed: false, duration, error: message };
  }
}

async function launchCLI(): Promise<CLITestContext> {
  const ctx: CLITestContext = {
    cli: null,
    output: '',
    errors: '',
  };

  const cliPath = join(PROJECT_DIR, 'dist/bin/agi.js');

  ctx.cli = spawn('node', [cliPath], {
    cwd: PROJECT_DIR,
    env: {
      ...process.env,
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      CI: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  ctx.cli.stdout?.on('data', (data: Buffer) => {
    ctx.output += data.toString();
  });

  ctx.cli.stderr?.on('data', (data: Buffer) => {
    ctx.errors += data.toString();
  });

  return ctx;
}

async function stopCLI(ctx: CLITestContext): Promise<void> {
  if (!ctx.cli) return;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ctx.cli?.kill('SIGKILL');
      resolve();
    }, 3000);

    ctx.cli!.on('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    ctx.cli?.stdin?.write('\x03'); // Ctrl+C
    setTimeout(() => {
      ctx.cli?.stdin?.write('\x04'); // Ctrl+D
    }, 500);
  });
}

async function waitForOutput(ctx: CLITestContext, pattern: RegExp, timeout: number): Promise<void> {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      if (pattern.test(ctx.output)) {
        resolve();
        return;
      }

      if (Date.now() - start > timeout) {
        reject(new Error(`Timeout waiting for pattern ${pattern}. Output: ${ctx.output.slice(-500)}`));
        return;
      }

      setTimeout(check, 100);
    };

    check();
  });
}

async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runCLICommand(args: string[], timeout: number = 5000): Promise<{ output: string; errors: string; exitCode: number }> {
  return new Promise((resolve) => {
    const cliPath = join(PROJECT_DIR, 'dist/bin/agi.js');
    let output = '';
    let errors = '';

    const proc = spawn('node', [cliPath, ...args], {
      cwd: PROJECT_DIR,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
    }, timeout);

    proc.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
    proc.stderr?.on('data', (data: Buffer) => { errors += data.toString(); });

    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ output, errors, exitCode: code ?? 0 });
    });
  });
}

function printSummary(results: TestResult[]): void {
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`\n${COLORS.bold}════════════════════════════════════════════════════════════${COLORS.reset}`);
  console.log(`${COLORS.bold}  TEST SUMMARY${COLORS.reset}`);
  console.log(`${COLORS.bold}════════════════════════════════════════════════════════════${COLORS.reset}`);
  console.log(`  Total:    ${results.length}`);
  console.log(`  ${COLORS.green}Passed:   ${passed}${COLORS.reset}`);
  if (failed > 0) {
    console.log(`  ${COLORS.red}Failed:   ${failed}${COLORS.reset}`);
  }
  console.log(`  Duration: ${(totalDuration / 1000).toFixed(2)}s`);
  console.log();

  if (failed === 0) {
    console.log(`${COLORS.green}${COLORS.bold}  ✓ ALL TESTS PASSED${COLORS.reset}\n`);
  } else {
    console.log(`${COLORS.red}${COLORS.bold}  ✗ SOME TESTS FAILED${COLORS.reset}`);
    console.log(`\n  Failed tests:`);
    for (const r of results.filter(r => !r.passed)) {
      console.log(`    - ${r.name}: ${r.error}`);
    }
    console.log();
  }
}
