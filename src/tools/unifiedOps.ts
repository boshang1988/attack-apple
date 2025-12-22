import type { ToolDefinition } from '../core/toolRuntime.js';
import { createHumanOpsTools } from './humanOpsTools.js';

interface UnifiedOpsArgs {
  tool?: string;
  args?: Record<string, unknown>;
}

function runGenerateTool(args: Record<string, unknown>): object {
  const name = typeof args['name'] === 'string' && args['name'].trim() ? args['name'].trim() : 'GeneratedTool';
  const description = typeof args['description'] === 'string' ? args['description'] : 'Generated tool';
  const intent = typeof args['intent'] === 'string' ? args['intent'] : 'general';
  return {
    name,
    description,
    intent,
    toolDefinition: {
      name,
      description,
      parameters: { type: 'object', properties: {}, additionalProperties: true },
    },
  };
}

export function createUnifiedOpsTools(workingDir: string): ToolDefinition[] {
  const humanTools = createHumanOpsTools();
  const humanIntegration = humanTools.find((t) => t.name === 'HumanIntegration');

  return [
    {
      name: 'UnifiedOps',
      description: 'Unified Ops router for developer + human-in-the-loop workflows.',
      parameters: {
        type: 'object',
        properties: {
          tool: { type: 'string', description: 'Tool to invoke (list | GenerateTool | HumanIntegration | Bash)' },
          args: { type: 'object', description: 'Arguments for the dispatched tool' },
        },
      },
      handler: async ({ tool, args }: UnifiedOpsArgs) => {
        const target = (tool ?? '').toString();
        if (!target || target === 'list') {
          return [
            'Available tools:',
            '- Bash',
            '- GenerateTool',
            '- HumanIntegration',
          ].join('\n');
        }

        if (target === 'GenerateTool') {
          return JSON.stringify(runGenerateTool(args ?? {}), null, 2);
        }

        if (target === 'HumanIntegration' && humanIntegration) {
          return humanIntegration.handler?.(args ?? {});
        }

        if (target === 'Bash') {
          const command = typeof args?.['command'] === 'string' ? args['command'] : '';
          return `Bash command requested in ${workingDir}:\n${command}`;
        }

        return `Unknown tool: ${target}`;
      },
    },
    ...humanTools,
  ];
}
