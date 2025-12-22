import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { IsolatedVerifier } from '../src/core/isolatedVerifier.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execAsync = promisify(exec);

describe('Isolated Verification System', () => {
  let verifier: IsolatedVerifier;
  let tempDir: string;

  beforeEach(() => {
    verifier = new IsolatedVerifier();
    tempDir = mkdtempSync(join(tmpdir(), 'isolated-verification-'));
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Basic functionality', () => {
    test('should create instance', () => {
      expect(verifier).toBeInstanceOf(IsolatedVerifier);
    });

    test('should verify simple task completion', async () => {
      const result = await verifier.verifyTaskCompletion('Test task', {
        taskDescription: 'Test task description',
        expectedFiles: [],
        verificationCommands: ['echo "Test verification"'],
      });

      expect(result.success).toBe(true);
      expect(result.report).toContain('ISOLATED VERIFICATION REPORT');
    });

    test('should handle verification failures', async () => {
      const result = await verifier.verifyTaskCompletion('Failing task', {
        taskDescription: 'Task that should fail',
        expectedFiles: [],
        verificationCommands: ['exit 1'], // This should fail
      });

      expect(result.success).toBe(false);
      expect(result.report).toContain('VERIFICATION FAILED');
    });

    test('should create verification script', async () => {
      const scriptPath = await verifier.createVerificationScript({
        taskDescription: 'Test task',
        expectedFiles: ['test.txt'],
        verificationCommands: ['ls -la', 'cat test.txt'],
      });

      expect(scriptPath).toBeTruthy();
      expect(scriptPath).toContain('isolated-verification-');
    });
  });

  describe('Integration with Main CLI', () => {
    test('should work with basic verification via npm', async () => {
      const result = await execAsync('npm run isolated-verify -- "Test verification"', {
        timeout: 45000
      });

      expect(result.stdout).toContain('ISOLATED VERIFICATION REPORT');
      // Success is indicated by not throwing - promisify(exec) doesn't return code
      expect(result.stdout).toBeDefined();
    });

    test('should work with task verification via npm', async () => {
      const result = await execAsync('npm run isolated-verify:task -- "Test task"', {
        timeout: 45000
      });

      // Task verification runs the full verification flow
      expect(result.stdout).toContain('ISOLATED VERIFICATION REPORT');
      expect(result.stdout).toContain('VERIFICATION STEPS');
    }, 60000); // Increased timeout for this specific test
  });

  describe('Error handling', () => {
    test('should handle missing verification commands', async () => {
      const result = await verifier.verifyTaskCompletion('Empty task', {
        taskDescription: 'Task with no verification',
        expectedFiles: [],
        verificationCommands: [],
      });

      expect(result.success).toBe(true); // Empty commands should still succeed
      expect(result.report).toContain('NO VERIFICATION COMMANDS');
    });

    test('should handle script execution errors', async () => {
      const result = await verifier.verifyTaskCompletion('Error task', {
        taskDescription: 'Task with script errors',
        expectedFiles: [],
        verificationCommands: ['invalid-command-that-does-not-exist'],
      });

      expect(result.success).toBe(false);
      expect(result.report).toContain('VERIFICATION FAILED');
    });
  });

  describe('File system operations', () => {
    test('should verify file existence', async () => {
      const testFile = join(tempDir, 'test.txt');
      writeFileSync(testFile, 'test content');

      const result = await verifier.verifyTaskCompletion('File task', {
        taskDescription: 'Task that creates files',
        expectedFiles: [testFile],
        verificationCommands: [`test -f "${testFile}"`],
      });

      expect(result.success).toBe(true);
    });

    test('should detect missing files', async () => {
      const result = await verifier.verifyTaskCompletion('Missing file task', {
        taskDescription: 'Task that should have created files',
        expectedFiles: [join(tempDir, 'nonexistent.txt')],
        verificationCommands: ['echo "Checking files"'],
      });

      expect(result.success).toBe(false);
      expect(result.report).toContain('MISSING FILES');
    });
  });

  describe('Performance and reliability', () => {
    test('should complete within reasonable time', async () => {
      const startTime = Date.now();
      const result = await verifier.verifyTaskCompletion('Performance test', {
        taskDescription: 'Quick verification',
        expectedFiles: [],
        verificationCommands: ['sleep 1', 'echo "Done"'],
      });

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds
      expect(result.success).toBe(true);
    });

    test('should handle concurrent verifications', async () => {
      const promises = Array(3).fill(0).map((_, i) =>
        verifier.verifyTaskCompletion(`Concurrent task ${i}`, {
          taskDescription: `Concurrent task ${i}`,
          expectedFiles: [],
          verificationCommands: [`echo "Task ${i} complete"`],
        })
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });
  });
});