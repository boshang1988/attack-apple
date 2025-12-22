import type { ToolDefinition } from '../core/toolRuntime.js';

interface ToolArgs extends Record<string, unknown> {
  request?: string;
  prompt?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  status?: string;
  result?: string;
  durationMs?: number;
  diff?: {
    additions?: number;
    removals?: number;
    lines?: Array<{ type: 'add' | 'remove' | 'context'; content: string; lineNumber?: number }>;
  };
  name?: string;
  steps?: Array<{ id: string; name: string; tool?: string; args?: Record<string, unknown>; dependsOn?: string[] }>;
  mode?: string;
  tools?: Array<{ tool: string; args?: Record<string, unknown>; description?: string }>;
}

function nowSeconds(ms?: number): string {
  if (!ms || ms < 1000) return '1s';
  const seconds = Math.round(ms / 1000);
  return `${seconds}s`;
}

function renderDiff(diff: NonNullable<ToolArgs['diff']>): string {
  const additions = diff.additions ?? 0;
  const removals = diff.removals ?? 0;
  const lines = diff.lines ?? [];
  const rendered = lines
    .map((line) => {
      const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
      return `${prefix}  ${line.content}`;
    })
    .join('\n');
  return `+${additions} -${removals}\n${rendered}`;
}

function pickTool(prompt: string): string {
  const lower = prompt.toLowerCase();
  const globKeywords = ['devops', 'education', 'ecommerce', 'hr ', 'real estate', 'travel', 'kanban', 'crm', 'messaging', 'booking'];
  if (globKeywords.some((kw) => lower.includes(kw))) {
    return 'Glob';
  }
  return 'Bash';
}

export function createMetaTools(_workingDir: string): ToolDefinition[] {
  const tools: ToolDefinition<ToolArgs>[] = [
    {
      name: 'CheckFeasibility',
      description: 'Assess feasibility of a request.',
      handler: async ({ request }) => {
        return [
          'Feasibility Analysis',
          `Request: ${request ?? ''}`,
          `Feasible:** Yes`,
          'Factors: timeline, scope, dependencies',
        ].join('\n');
      },
    },
    {
      name: 'DecomposeTask',
      description: 'Break a request into sub-tasks.',
      handler: async ({ request }) => {
        const tasks = ['research', 'plan', 'implement', 'test', 'deliver'].map((task, idx) => `[task-${idx + 1}] ${task} ${request ?? ''}`);
        return ['Task Decomposition', ...tasks].join('\n');
      },
    },
    {
      name: 'AnalyzeAmbiguity',
      description: 'Identify unclear parts of a prompt.',
      handler: async ({ prompt }) => `Ambiguity Analysis\nPrompt: ${prompt ?? ''}\nClarifications: none`,
    },
    {
      name: 'SuggestApproach',
      description: 'Suggest an execution approach.',
      handler: async ({ prompt }) => `Approach\nPrompt: ${prompt ?? ''}\nPlan: iterate, validate, deliver`,
    },
    {
      name: 'ThinkingProcess',
      description: 'Outline a thinking process.',
      handler: async () => 'Thinking\nInterpretation\nExecution Plan\nReady for Execution',
    },
    {
      name: 'ExecuteWorkflow',
      description: 'Represent a workflow execution.',
      handler: async ({ name }) => `Workflow Execution\nName: ${name ?? 'Workflow'}\nReady`,
    },
    {
      name: 'RecordEvidence',
      description: 'Record execution evidence.',
      handler: async () => 'Evidence\nCaptured logs and diffs',
    },
    {
      name: 'ToolExecutionDisplay',
      description: 'Format tool execution display.',
      handler: async (args) => {
        const base = [
          `⏺ ${args.toolName ?? 'Tool'}`,
          '⎿',
          `Status: ${args.status ?? 'completed'}`,
          `Duration: ${nowSeconds(args.durationMs ?? 1000)}`,
        ];
        if (args.diff) {
          base.push(renderDiff(args.diff));
        }
        return base.join('\n');
      },
    },
    {
      name: 'WorkflowOrchestrator',
      description: 'Plan workflow execution.',
      handler: async ({ name, steps }) => {
        const lines: string[] = [];
        lines.push(`Workflow: ${name ?? 'workflow'}`);
        for (const step of steps ?? []) {
          lines.push(`[${step.id}] ${step.name}`);
          if (step.dependsOn?.length) {
            lines.push(`after: ${step.dependsOn.join(', ')}`);
          }
        }
        return lines.join('\n');
      },
    },
    {
      name: 'OperationStatus',
      description: 'Summarize operation status.',
      handler: async () => 'Operation Status: active',
    },
    {
      name: 'UnifiedPromptHandler',
      description: 'Generate unified handling for prompts.',
      handler: async ({ prompt }) =>
        ['Thinking', `Interpretation: ${prompt ?? ''}`, 'Execution Plan: steps outlined', 'Ready for Execution'].join('\n'),
    },
    {
      name: 'RealToolChain',
      description: 'Execute a tool chain.',
      handler: async ({ name, tools = [] }) => {
        const lines = [`Tool Chain: ${name ?? 'Tool Chain'}`];
        lines.push('EXECUTING');
        for (const tool of tools) {
          lines.push(`⏺ ${tool.tool}`);
          if (tool.description) {
            lines.push(tool.description);
          }
        }
        return lines.join('\n');
      },
    },
    {
      name: 'GenerateToolCalls',
      description: 'Generate tool calls for a prompt.',
      handler: async ({ prompt = '' }) => {
        const tool = pickTool(prompt);
        const payload = { tool, args: { prompt } };
        return [
          'Generated Tool Calls',
          `Primary: ${tool}`,
          '```json',
          JSON.stringify(payload, null, 2),
          '```',
        ].join('\n');
      },
    },
  ];

  return tools;
}
