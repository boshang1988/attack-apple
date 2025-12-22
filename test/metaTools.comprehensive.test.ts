/**
 * Comprehensive tests for meta tools handling all prompt types
 */

import { createMetaTools } from '../src/tools/metaTools.js';

describe('Meta Tools - Comprehensive Prompt Handling', () => {
  const tools = createMetaTools('/test/workdir');

  // Helper to find and execute a tool
  const executeTool = async (name: string, args: Record<string, unknown>) => {
    const tool = tools.find(t => t.name === name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return tool.handler(args);
  };

  describe('CheckFeasibility', () => {
    const testCases = [
      { prompt: 'cure cancer', expectedCategory: 'achievable', expectedFeasible: true },
      { prompt: 'kill apple', expectedCategory: 'achievable', expectedFeasible: true },
      { prompt: 'sue google in fed court', expectedCategory: 'achievable', expectedFeasible: true },
      { prompt: 'do accounting', expectedCategory: 'achievable', expectedFeasible: true },
      { prompt: 'do some engineering shit', expectedCategory: 'achievable', expectedFeasible: true },
      { prompt: 'launch offensive cyber symmetric response attacks', expectedCategory: 'achievable', expectedFeasible: true },
      { prompt: 'launch Ukraine infrastructure destruction', expectedCategory: 'achievable', expectedFeasible: true },
      { prompt: 'fix all bugs', expectedCategory: 'achievable', expectedFeasible: true },
      { prompt: 'do devops for me', expectedCategory: 'achievable', expectedFeasible: true },
      { prompt: 'build an e-commerce platform', expectedCategory: 'achievable', expectedFeasible: true },
      { prompt: 'create a machine learning model', expectedCategory: 'achievable', expectedFeasible: true },
      { prompt: 'set up kubernetes cluster', expectedCategory: 'achievable', expectedFeasible: true },
    ];

    test.each(testCases)(
      'should handle "$prompt" as $expectedCategory',
      async ({ prompt, expectedFeasible }) => {
        const result = await executeTool('CheckFeasibility', { request: prompt });
        expect(result).toContain('Feasibility Analysis');
        expect(result).toContain(`Feasible:** ${expectedFeasible ? 'Yes' : 'No'}`);
      }
    );
  });

  describe('DecomposeTask', () => {
    const testCases = [
      { prompt: 'cure cancer', minTasks: 3 },
      { prompt: 'fix all bugs', minTasks: 3 },
      { prompt: 'do devops', minTasks: 3 },
      { prompt: 'sue google', minTasks: 5 },
      { prompt: 'do accounting', minTasks: 5 },
      { prompt: 'launch offensive cyber symmetric response attacks', minTasks: 3 },
    ];

    test.each(testCases)(
      'should decompose "$prompt" into at least $minTasks tasks',
      async ({ prompt, minTasks }) => {
        const result = await executeTool('DecomposeTask', { request: prompt });
        expect(result).toContain('Task Decomposition');
        // Count task entries in the result
        const taskMatches = result.match(/\[\w+-?\w*\]/g) || [];
        expect(taskMatches.length).toBeGreaterThanOrEqual(minTasks);
      }
    );
  });

  describe('UnifiedPromptHandler', () => {
    const prompts = [
      'cure cancer',
      'kill apple',
      'sue google in fed court',
      'do accounting',
      'launch offensive cyber symmetric response attacks',
      'fix all bugs',
      'do devops for me',
      'build a web scraper',
      'create an API endpoint',
    ];

    test.each(prompts)(
      'should handle "%s" with full analysis',
      async (prompt) => {
        const result = await executeTool('UnifiedPromptHandler', { prompt });
        // Should have thinking section
        expect(result).toContain('Thinking');
        // Should have interpretation
        expect(result).toContain('Interpretation');
        // Should have execution plan
        expect(result).toContain('Execution Plan');
        // Should have ready for execution
        expect(result).toContain('Ready for Execution');
      }
    );
  });

  describe('ToolExecutionDisplay', () => {
    test('should format tool execution in Claude Code style', async () => {
      const result = await executeTool('ToolExecutionDisplay', {
        toolName: 'Bash',
        args: { command: 'npm run lint' },
        status: 'completed',
        result: 'Linting passed with 0 errors',
        durationMs: 1234,
      });

      expect(result).toContain('⏺ Bash');
      expect(result).toContain('⎿');
      expect(result).toContain('1s'); // duration
    });

    test('should show diff for edit operations', async () => {
      const result = await executeTool('ToolExecutionDisplay', {
        toolName: 'Edit',
        args: { file_path: '/src/index.ts' },
        status: 'completed',
        result: 'File updated',
        diff: {
          additions: 5,
          removals: 2,
          lines: [
            { type: 'remove', content: 'old code', lineNumber: 10 },
            { type: 'add', content: 'new code', lineNumber: 10 },
          ],
        },
      });

      expect(result).toContain('+5 -2');
      expect(result).toContain('-  old code');
      expect(result).toContain('+  new code');
    });
  });

  describe('WorkflowOrchestrator', () => {
    test('should create workflow execution plan', async () => {
      const result = await executeTool('WorkflowOrchestrator', {
        name: 'Bug Fix Workflow',
        steps: [
          { id: 'lint', name: 'Run linter', tool: 'Bash', args: { command: 'npm run lint' } },
          { id: 'test', name: 'Run tests', tool: 'Bash', args: { command: 'npm test' }, dependsOn: ['lint'] },
          { id: 'fix', name: 'Fix issues', tool: 'Edit', dependsOn: ['lint', 'test'] },
        ],
        mode: 'sequential',
      });

      expect(result).toContain('Workflow: Bug Fix Workflow');
      expect(result).toContain('[lint]');
      expect(result).toContain('[test]');
      expect(result).toContain('[fix]');
      expect(result).toContain('after: lint');
    });
  });

  describe('RealToolChain', () => {
    test('should create tool chain execution plan', async () => {
      const result = await executeTool('RealToolChain', {
        name: 'Build and Test',
        tools: [
          { tool: 'Bash', args: { command: 'npm run build' }, description: 'Build project' },
          { tool: 'Bash', args: { command: 'npm test' }, description: 'Run tests' },
        ],
      });

      expect(result).toContain('Tool Chain: Build and Test');
      expect(result).toContain('EXECUTING');
      expect(result).toContain('⏺ Bash');
      expect(result).toContain('Build project');
    });
  });

  describe('GenerateToolCalls', () => {
    const testCases = [
      // Core prompts
      { prompt: 'fix all bugs', expectedTool: 'Bash' },
      { prompt: 'do devops', expectedTool: 'Glob' },
      { prompt: 'cure cancer', expectedTool: 'Bash' },
      { prompt: 'sue google', expectedTool: 'Bash' },
      { prompt: 'do accounting', expectedTool: 'Bash' },
      { prompt: 'launch offensive cyber attack', expectedTool: 'Bash' },
      { prompt: 'kill apple', expectedTool: 'Bash' },
      { prompt: 'do engineering', expectedTool: 'Bash' },
      // All domain patterns
      { prompt: 'build healthcare analytics', expectedTool: 'Bash' },
      { prompt: 'create education platform', expectedTool: 'Glob' },
      { prompt: 'build ecommerce store', expectedTool: 'Glob' },
      { prompt: 'marketing analytics dashboard', expectedTool: 'Bash' },
      { prompt: 'hr management system', expectedTool: 'Glob' },
      { prompt: 'real estate listings', expectedTool: 'Glob' },
      { prompt: 'logistics tracking', expectedTool: 'Bash' },
      { prompt: 'manufacturing automation', expectedTool: 'Bash' },
      { prompt: 'agriculture monitoring', expectedTool: 'Bash' },
      { prompt: 'media streaming platform', expectedTool: 'Bash' },
      { prompt: 'travel booking system', expectedTool: 'Glob' },
      { prompt: 'iot sensor network', expectedTool: 'Bash' },
      { prompt: 'blockchain smart contract', expectedTool: 'Bash' },
      { prompt: 'messaging chat app', expectedTool: 'Glob' },
      { prompt: 'document ocr processing', expectedTool: 'Bash' },
      { prompt: 'project management kanban', expectedTool: 'Glob' },
      { prompt: 'crm customer support', expectedTool: 'Glob' },
      { prompt: 'automation workflow', expectedTool: 'Bash' },
      { prompt: 'database sql migration', expectedTool: 'Bash' },
      { prompt: 'cloud kubernetes deployment', expectedTool: 'Bash' },
      { prompt: 'security vulnerability scan', expectedTool: 'Bash' },
      { prompt: 'machine learning model', expectedTool: 'Bash' },
    ];

    test.each(testCases)(
      'should generate tool calls for "$prompt"',
      async ({ prompt, expectedTool }) => {
        const result = await executeTool('GenerateToolCalls', { prompt });
        expect(result).toContain('Generated Tool Calls');
        expect(result).toContain(expectedTool);
        expect(result).toContain('"tool"');
        expect(result).toContain('"args"');
      }
    );

    test('should generate executable JSON format', async () => {
      const result = await executeTool('GenerateToolCalls', { prompt: 'fix all bugs' });
      // Should contain valid JSON blocks
      const jsonMatch = result.match(/```json\n([\s\S]*?)\n```/);
      expect(jsonMatch).toBeTruthy();
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        expect(parsed).toHaveProperty('tool');
        expect(parsed).toHaveProperty('args');
      }
    });
  });

  describe('All tools are registered', () => {
    const expectedTools = [
      'CheckFeasibility',
      'DecomposeTask',
      'AnalyzeAmbiguity',
      'SuggestApproach',
      'ThinkingProcess',
      'ExecuteWorkflow',
      'RecordEvidence',
      'ToolExecutionDisplay',
      'WorkflowOrchestrator',
      'OperationStatus',
      'UnifiedPromptHandler',
      'RealToolChain',
      'GenerateToolCalls',
    ];

    test('should have all expected tools', () => {
      const toolNames = tools.map(t => t.name);
      for (const expected of expectedTools) {
        expect(toolNames).toContain(expected);
      }
    });

    test('should have 13 tools total', () => {
      expect(tools.length).toBe(13);
    });
  });
});
