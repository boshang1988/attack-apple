/**
 * Integration tests for enhanced capabilities
 * Tests the full workflow of hypothesis engine, bug analyzer, and test harness
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { HypothesisEngine, BugHypothesisAnalyzer, type Evidence } from '../../src/core/hypothesisEngine.js';
import { DeepBugAnalyzer, type BugReport } from '../../src/core/deepBugAnalyzer.js';
import { ProductTestHarness, createRuntimeEnvironment, TestScenarioGenerator } from '../../src/core/productTestHarness.js';

describe('Enhanced Capabilities Integration', () => {
  describe('Hypothesis Engine', () => {
    let engine: HypothesisEngine;

    beforeEach(() => {
      engine = new HypothesisEngine(5);
    });

    it('should generate and track hypotheses', () => {
      const hypothesis = engine.generateHypothesis('Test hypothesis', []);

      expect(hypothesis).toBeDefined();
      expect(hypothesis.description).toBe('Test hypothesis');
      expect(hypothesis.confidence).toBeGreaterThanOrEqual(0);
      expect(hypothesis.confidence).toBeLessThanOrEqual(1);
      expect(hypothesis.status).toBe('pending');
    });

    it('should update confidence when evidence is added', () => {
      const hypothesis = engine.generateHypothesis('Bug is a race condition', []);
      const initialConfidence = hypothesis.confidence;

      const evidence: Evidence = {
        type: 'observation',
        content: 'Error only occurs intermittently',
        weight: 0.8,
        timestamp: new Date(),
      };

      engine.addEvidence(hypothesis.id, evidence);

      const updated = engine.getHypothesis(hypothesis.id);
      expect(updated).toBeDefined();
      expect(updated!.confidence).not.toBe(initialConfidence);
      expect(updated!.evidence).toHaveLength(1);
    });

    it('should return best hypothesis', () => {
      const h1 = engine.generateHypothesis('Low confidence hypothesis', [{
        type: 'observation',
        content: 'Weak evidence',
        weight: 0.1,
        timestamp: new Date(),
      }]);

      const h2 = engine.generateHypothesis('High confidence hypothesis', [{
        type: 'observation',
        content: 'Strong evidence',
        weight: 0.9,
        timestamp: new Date(),
      }]);

      const best = engine.getBestHypothesis();
      expect(best).toBeDefined();
      // Best hypothesis should have higher confidence
      expect(best!.confidence).toBeGreaterThanOrEqual(h1.confidence);
    });
  });

  describe('Deep Bug Analyzer', () => {
    let analyzer: DeepBugAnalyzer;

    beforeEach(() => {
      analyzer = new DeepBugAnalyzer();
    });

    it('should analyze bug and generate causal factors', async () => {
      const bugReport: BugReport = {
        title: 'Null reference error',
        description: 'User profile throws null reference exception',
        expectedBehavior: 'Should display user profile',
        actualBehavior: 'Throws null reference error',
        stackTrace: 'TypeError: Cannot read property "name" of null\n  at getUserProfile (user.ts:42)',
      };

      const codeContext = new Map<string, string>();
      codeContext.set('user.ts', `
        function getUserProfile(userId) {
          const user = findUser(userId);
          return user.name; // Line 42
        }
      `);

      const result = await analyzer.analyze(bugReport, codeContext, 'shallow');

      expect(result).toBeDefined();
      expect(result.primaryCause).toBeDefined();
      expect(result.contributingFactors).toBeDefined();
      expect(result.recommendedActions.length).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should detect code-level factors', async () => {
      const bugReport: BugReport = {
        title: 'Undefined error',
        description: 'Variable is undefined',
      };

      const codeContext = new Map<string, string>();
      codeContext.set('test.ts', `
        const obj = {};
        // TODO: Replace with logger
// TODO: Replace with logger
console.log(obj.property.nested);
      `);

      const result = await analyzer.analyze(bugReport, codeContext, 'moderate');

      expect(result.primaryCause?.category).toBe('code');
      expect(result.primaryCause?.description).toContain('null');
    });
  });

  describe('Product Test Harness', () => {
    let harness: ProductTestHarness;

    beforeEach(() => {
      harness = new ProductTestHarness();
    });

    it('should run test scenarios and report results', async () => {
      harness.addScenario({
        name: 'simple_test',
        description: 'A simple passing test',
        execute: async () => ({
          scenario: 'simple_test',
          passed: true,
          duration: 10,
          output: 'Test passed',
        }),
      });

      const results = await harness.runAll();

      expect(results.total).toBe(1);
      expect(results.passed).toBe(1);
      expect(results.failed).toBe(0);
      expect(results.summary).toContain('1');
    });

    it('should handle test failures', async () => {
      harness.addScenario({
        name: 'failing_test',
        description: 'A failing test',
        execute: async () => ({
          scenario: 'failing_test',
          passed: false,
          duration: 15,
          output: 'Expected true but got false',
        }),
      });

      const results = await harness.runAll();

      expect(results.total).toBe(1);
      expect(results.passed).toBe(0);
      expect(results.failed).toBe(1);
      expect(results.summary).toContain('Failed');
    });

    it('should enforce timeouts', async () => {
      harness.addScenario({
        name: 'timeout_test',
        description: 'Test that times out',
        timeout: 100,
        execute: async () => {
          await new Promise(resolve => setTimeout(resolve, 200));
          return {
            scenario: 'timeout_test',
            passed: true,
            duration: 200,
            output: 'Should not reach here',
          };
        },
      });

      const results = await harness.runAll();

      expect(results.failed).toBe(1);
      expect(results.results[0].error).toContain('timeout');
    });
  });

  describe('Runtime Environment', () => {
    it('should execute Node.js code', async () => {
      const env = createRuntimeEnvironment();

      try {
        const result = await env.execute('console.log("Hello, World!");', 'node');

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Hello, World!');
        expect(result.stderr).toBe('');
      } finally {
        env.cleanup();
      }
    });

    it('should execute bash commands', async () => {
      const env = createRuntimeEnvironment();

      try {
        const result = await env.execute('echo "test"', 'bash');

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('test');
      } finally {
        env.cleanup();
      }
    });

    it('should handle errors', async () => {
      const env = createRuntimeEnvironment();

      try {
        const result = await env.execute('throw new Error("Test error");', 'node');

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain('Error');
      } finally {
        env.cleanup();
      }
    });

    it('should support file operations', async () => {
      const env = createRuntimeEnvironment();

      try {
        env.writeFile('test.txt', 'Hello, World!');
        expect(env.fileExists('test.txt')).toBe(true);

        const content = env.readFile('test.txt');
        expect(content).toBe('Hello, World!');
      } finally {
        env.cleanup();
      }
    });
  });

  describe('End-to-End Workflow', () => {
    it('should support complete bug investigation workflow', async () => {
      // 1. Generate hypotheses
      const engine = new HypothesisEngine();
      const h1 = engine.generateHypothesis('Null reference bug');
      const h2 = engine.generateHypothesis('Race condition bug');

      // 2. Add evidence
      engine.addEvidence(h1.id, {
        type: 'observation',
        content: 'Error always on line 42',
        weight: 0.7,
        timestamp: new Date(),
      });

      engine.addEvidence(h2.id, {
        type: 'observation',
        content: 'Error only intermittent',
        weight: -0.5,
        timestamp: new Date(),
      });

      // 3. Get best hypothesis
      const best = engine.getBestHypothesis();
      expect(best?.description).toContain('Null reference');

      // 4. Deep analyze
      const analyzer = new DeepBugAnalyzer();
      const result = await analyzer.analyze({
        title: 'Test bug',
        description: best!.description,
      }, new Map(), 'shallow');

      expect(result.primaryCause).toBeDefined();

      // 5. Test the fix
      const harness = new ProductTestHarness();
      harness.addScenario({
        name: 'verify_fix',
        description: 'Verify null check works',
        execute: async () => ({
          scenario: 'verify_fix',
          passed: true,
          duration: 10,
          output: 'Fix verified',
        }),
      });

      const testResults = await harness.runAll();
      expect(testResults.passed).toBe(1);
    });
  });
});
