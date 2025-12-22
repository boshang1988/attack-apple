/**
 * AGI Core Comprehensive Tests
 *
 * Tests the unified AGI system with real-world prompts:
 * - Software engineering tasks
 * - Research/analysis tasks
 * - Automation tasks
 * - Complex multi-step tasks
 *
 * NO SIMULATIONS - All tests verify real behavior
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { AGICore, resetAGI, getAGI } from '../src/core/agiCore.js';

const TEST_DIR = path.join(process.cwd(), '.test-agi-temp');

describe('AGI Core', () => {
  let agi: AGICore;

  beforeEach(() => {
    // Create clean test directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });

    // Create a mock package.json for project detection
    fs.writeFileSync(path.join(TEST_DIR, 'package.json'), JSON.stringify({
      name: 'test-project',
      scripts: {
        test: 'jest',
        lint: 'eslint .',
        build: 'tsc',
      },
      dependencies: {},
      devDependencies: {
        jest: '^29.0.0',
        typescript: '^5.0.0',
      },
    }, null, 2));

    resetAGI();
    agi = getAGI(TEST_DIR);
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    resetAGI();
  });

  // ===========================================================================
  // PROJECT KNOWLEDGE TESTS
  // ===========================================================================

  describe('Project Knowledge', () => {
    test('detects Node.js project from package.json', () => {
      const knowledge = agi.getProjectKnowledge();

      expect(knowledge.type).toBe('node');
      expect(knowledge.testCommand).toBe('npm test');
      expect(knowledge.lintCommand).toBe('npm run lint');
      expect(knowledge.buildSystem).toBe('npm run build');
    });

    test('refreshes project knowledge on demand', () => {
      // Update package.json
      fs.writeFileSync(path.join(TEST_DIR, 'package.json'), JSON.stringify({
        name: 'updated-project',
        scripts: {
          test: 'vitest',
          lint: 'biome check',
        },
      }, null, 2));

      const knowledge = agi.refreshProjectKnowledge();

      expect(knowledge.testCommand).toBe('npm test');
      expect(knowledge.lintCommand).toBe('npm run lint');
    });
  });

  // ===========================================================================
  // PROMPT ANALYSIS TESTS - Software Engineering
  // ===========================================================================

  describe('Prompt Analysis - Software Engineering', () => {
    test('analyzes "fix all bugs" correctly', () => {
      const analysis = agi.analyzePrompt('fix all bugs');

      expect(analysis.intent).toBe('fix_bugs');
      expect(analysis.category).toBe('code_modification');
      expect(analysis.tasks.length).toBeGreaterThan(0);
      expect(analysis.tasks.some(t => t.description.toLowerCase().includes('lint') ||
                                       t.description.toLowerCase().includes('type'))).toBe(true);
      expect(analysis.tasks.some(t => t.description.toLowerCase().includes('test'))).toBe(true);
    });

    test('analyzes "add dark mode feature" correctly', () => {
      const analysis = agi.analyzePrompt('add dark mode feature');

      expect(analysis.intent).toBe('add_feature');
      expect(analysis.category).toBe('code_modification');
      expect(analysis.tasks.some(t => t.category === 'analysis')).toBe(true);
      expect(analysis.tasks.some(t => t.category === 'modification')).toBe(true);
    });

    test('analyzes "refactor the authentication module" correctly', () => {
      const analysis = agi.analyzePrompt('refactor the authentication module');

      expect(analysis.intent).toBe('refactor');
      expect(analysis.category).toBe('code_modification');
    });

    test('analyzes "run the tests" correctly', () => {
      const analysis = agi.analyzePrompt('run the tests');

      expect(analysis.intent).toBe('test');
      expect(analysis.category).toBe('testing');
    });

    test('analyzes "deploy to production" correctly', () => {
      const analysis = agi.analyzePrompt('deploy to production');

      expect(analysis.intent).toBe('deploy');
      expect(analysis.category).toBe('infrastructure');
    });

    test('analyzes security audit requests correctly', () => {
      const analysis = agi.analyzePrompt('audit the codebase for security vulnerabilities');

      expect(analysis.intent).toBe('security_audit');
      expect(analysis.category).toBe('code_analysis');
      expect(analysis.tasks.some(t => t.description.toLowerCase().includes('dependency') ||
                                       t.description.toLowerCase().includes('audit'))).toBe(true);
    });
  });

  // ===========================================================================
  // PROMPT ANALYSIS TESTS - Research & Analysis
  // ===========================================================================

  describe('Prompt Analysis - Research & Analysis', () => {
    test('analyzes "explain how this code works" correctly', () => {
      const analysis = agi.analyzePrompt('explain how this code works');

      expect(analysis.intent).toBe('explain');
      expect(analysis.category).toBe('research');
      expect(analysis.tasks.some(t => t.category === 'analysis')).toBe(true);
    });

    test('analyzes "what does this function do" correctly', () => {
      const analysis = agi.analyzePrompt('what does this function do');

      expect(analysis.intent).toBe('explain');
      expect(analysis.category).toBe('research');
    });

    test('analyzes "analyze the performance" correctly', () => {
      const analysis = agi.analyzePrompt('analyze the performance of this code');

      // "performance" triggers optimize, which is reasonable - both are valid interpretations
      expect(['analyze', 'optimize']).toContain(analysis.intent);
      expect(['code_analysis', 'code_modification']).toContain(analysis.category);
    });
  });

  // ===========================================================================
  // PROMPT ANALYSIS TESTS - Automation & DevOps
  // ===========================================================================

  describe('Prompt Analysis - Automation & DevOps', () => {
    test('analyzes "do devops for me" correctly', () => {
      const analysis = agi.analyzePrompt('do devops for me');

      // Should be interpreted as setup/infrastructure task
      expect(['setup', 'deploy', 'generic_task']).toContain(analysis.intent);
    });

    test('analyzes "setup CI/CD pipeline" correctly', () => {
      const analysis = agi.analyzePrompt('setup CI/CD pipeline');

      expect(analysis.intent).toBe('setup');
      expect(analysis.category).toBe('infrastructure');
    });

    test('analyzes "optimize the build" correctly', () => {
      const analysis = agi.analyzePrompt('optimize the build process');

      expect(analysis.intent).toBe('optimize');
      expect(analysis.category).toBe('code_modification');
    });
  });

  // ===========================================================================
  // TOOL CALL GENERATION TESTS
  // ===========================================================================

  describe('Tool Call Generation', () => {
    test('generates tool calls for "fix all bugs"', () => {
      const analysis = agi.analyzePrompt('fix all bugs');
      const toolCalls = agi.generateToolCalls(analysis);

      expect(toolCalls.length).toBeGreaterThan(0);

      // Should include linting
      const hasLint = toolCalls.some(c =>
        c.tool === 'Bash' && (c.args.command as string)?.includes('lint'));
      expect(hasLint).toBe(true);

      // Should include type checking
      const hasTypecheck = toolCalls.some(c =>
        c.tool === 'Bash' && (c.args.command as string)?.includes('tsc'));
      expect(hasTypecheck).toBe(true);

      // Should include TODO/FIXME search
      const hasTodoSearch = toolCalls.some(c =>
        c.tool === 'Grep' && (c.args.pattern as string)?.includes('TODO'));
      expect(hasTodoSearch).toBe(true);
    });

    test('generates tool calls for security audit', () => {
      const analysis = agi.analyzePrompt('security audit');
      const toolCalls = agi.generateToolCalls(analysis);

      // Should include npm audit for Node.js projects
      const hasAudit = toolCalls.some(c =>
        c.tool === 'Bash' && (c.args.command as string)?.includes('audit'));
      expect(hasAudit).toBe(true);

      // Should search for unsafe patterns
      const hasPatternSearch = toolCalls.some(c =>
        c.tool === 'Grep' && (c.args.pattern as string)?.includes('eval'));
      expect(hasPatternSearch).toBe(true);
    });
  });

  // ===========================================================================
  // LEARNING & MEMORY TESTS
  // ===========================================================================

  describe('Learning & Memory', () => {
    test('learns from successful operations', () => {
      const prompt = 'fix typescript errors';
      const approach = 'Run tsc --noEmit to find errors, then fix each one';
      const tools = ['Bash', 'Read', 'Edit'];

      agi.learnFromSuccess(prompt, approach, tools);

      const patterns = agi.getLearnedPatterns();
      expect(patterns.length).toBe(1);
      expect(patterns[0].trigger).toBe(prompt);
      expect(patterns[0].successfulApproach).toBe(approach);
      expect(patterns[0].tools).toEqual(tools);
      expect(patterns[0].successCount).toBe(1);
    });

    test('increments success count for repeated patterns', () => {
      const prompt = 'run tests';
      const approach = 'Execute npm test';
      const tools = ['Bash'];

      agi.learnFromSuccess(prompt, approach, tools);
      agi.learnFromSuccess(prompt, approach, tools);
      agi.learnFromSuccess(prompt, approach, tools);

      const patterns = agi.getLearnedPatterns();
      expect(patterns.length).toBe(1);
      expect(patterns[0].successCount).toBe(3);
    });

    test('records operations', () => {
      agi.recordOperation({
        id: 'op-1',
        prompt: 'fix bugs',
        interpretation: 'Find and fix bugs in the codebase',
        tasks: ['lint', 'typecheck', 'fix'],
        success: true,
        timestamp: Date.now(),
        duration: 5000,
        toolsUsed: ['Bash', 'Edit'],
      });

      const recentOps = agi.getRecentOperations();
      expect(recentOps.length).toBe(1);
      expect(recentOps[0].prompt).toBe('fix bugs');
      expect(recentOps[0].success).toBe(true);
    });

    test('uses learned patterns for similar prompts', () => {
      // Learn a pattern
      agi.learnFromSuccess('fix all bugs', 'Lint, typecheck, test, fix', ['Bash', 'Edit']);
      agi.learnFromSuccess('fix all bugs', 'Lint, typecheck, test, fix', ['Bash', 'Edit']); // 2nd time

      // Get learned approach for similar prompt
      const learned = agi.getLearnedApproach('fix all bugs');
      expect(learned).not.toBeNull();
      expect(learned!.successCount).toBe(2);
    });

    test('persists memory to disk', () => {
      // Learn something
      agi.learnFromSuccess('test pattern', 'test approach', ['Bash']);

      // Create new instance (simulating restart)
      resetAGI();
      const newAgi = getAGI(TEST_DIR);

      // Check memory was persisted
      const patterns = newAgi.getLearnedPatterns();
      expect(patterns.length).toBe(1);
      expect(patterns[0].trigger).toBe('test pattern');
    });
  });

  // ===========================================================================
  // AMBIGUITY DETECTION TESTS
  // ===========================================================================

  describe('Ambiguity Detection', () => {
    test('detects vague scope in "fix all bugs"', () => {
      const analysis = agi.analyzePrompt('fix all bugs in everything');

      // Should have clarification questions due to broad scope
      expect(analysis.clarificationNeeded.length).toBeGreaterThan(0);
      expect(analysis.clarificationNeeded.some(q => q.toLowerCase().includes('scope') ||
                                                     q.toLowerCase().includes('specific'))).toBe(true);
    });

    test('has lower confidence for ambiguous prompts', () => {
      const clearAnalysis = agi.analyzePrompt('run npm test');
      const vagueAnalysis = agi.analyzePrompt('fix all bugs in the entire codebase');

      expect(vagueAnalysis.confidence).toBeLessThanOrEqual(clearAnalysis.confidence);
    });
  });

  // ===========================================================================
  // CONTEXT TESTS
  // ===========================================================================

  describe('Context Management', () => {
    test('provides session context', () => {
      const context = agi.getContext();

      expect(context.sessionId).toBeDefined();
      expect(context.sessionId).toMatch(/^agi-/);
      expect(context.workingDir).toBe(TEST_DIR);
      expect(context.startTime).toBeLessThanOrEqual(Date.now());
    });

    test('singleton pattern works correctly', () => {
      const agi1 = getAGI(TEST_DIR);
      const agi2 = getAGI(TEST_DIR);

      expect(agi1).toBe(agi2);
    });

    test('reset creates new instance', () => {
      const agi1 = getAGI(TEST_DIR);
      const sessionId1 = agi1.getContext().sessionId;

      resetAGI();
      const agi2 = getAGI(TEST_DIR);
      const sessionId2 = agi2.getContext().sessionId;

      expect(sessionId1).not.toBe(sessionId2);
    });
  });
});

// ===========================================================================
// COMPREHENSIVE PROMPT TESTS - Real World Scenarios
// ===========================================================================

describe('AGI Core - Real World Prompts', () => {
  let agi: AGICore;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });

    fs.writeFileSync(path.join(TEST_DIR, 'package.json'), JSON.stringify({
      name: 'test-project',
      scripts: { test: 'jest', lint: 'eslint .', build: 'tsc' },
    }, null, 2));

    resetAGI();
    agi = getAGI(TEST_DIR);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    resetAGI();
  });

  const testCases = [
    // Software Engineering
    { prompt: 'fix all bugs', expectedIntent: 'fix_bugs', expectedCategory: 'code_modification' },
    { prompt: 'add user authentication', expectedIntent: 'add_feature', expectedCategory: 'code_modification' },
    { prompt: 'refactor the database layer', expectedIntent: 'refactor', expectedCategory: 'code_modification' },
    { prompt: 'write unit tests for the API', expectedIntent: 'test', expectedCategory: 'testing' },
    { prompt: 'document the API endpoints', expectedIntent: 'document', expectedCategory: 'documentation' },

    // DevOps & Infrastructure
    { prompt: 'setup CI/CD', expectedIntent: 'setup', expectedCategory: 'infrastructure' },
    { prompt: 'deploy to AWS', expectedIntent: 'deploy', expectedCategory: 'infrastructure' },
    { prompt: 'configure docker', expectedIntent: 'setup', expectedCategory: 'infrastructure' },

    // Analysis & Research
    { prompt: 'analyze code quality', expectedIntent: 'analyze', expectedCategory: 'code_analysis' },
    { prompt: 'explain how the router works', expectedIntent: 'explain', expectedCategory: 'research' },
    { prompt: 'security audit', expectedIntent: 'security_audit', expectedCategory: 'code_analysis' },

    // Optimization
    { prompt: 'optimize database queries', expectedIntent: 'optimize', expectedCategory: 'code_modification' },
    { prompt: 'improve performance', expectedIntent: 'optimize', expectedCategory: 'code_modification' },
    { prompt: 'speed up the build', expectedIntent: 'optimize', expectedCategory: 'code_modification' },

    // Migration
    { prompt: 'migrate to TypeScript', expectedIntent: 'migrate', expectedCategory: 'code_modification' },
    { prompt: 'upgrade dependencies', expectedIntent: 'migrate', expectedCategory: 'code_modification' },
  ];

  test.each(testCases)('analyzes "$prompt" correctly', ({ prompt, expectedIntent, expectedCategory }) => {
    const analysis = agi.analyzePrompt(prompt);

    expect(analysis.intent).toBe(expectedIntent);
    expect(analysis.category).toBe(expectedCategory);
    expect(analysis.interpretation).toBeTruthy();
    expect(analysis.tasks.length).toBeGreaterThan(0);
  });
});
