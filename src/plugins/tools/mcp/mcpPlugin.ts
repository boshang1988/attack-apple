import type { ToolDefinition, ToolSuite } from '../../../core/toolRuntime.js';
import type { CapabilityContribution, CapabilityModule } from '../../../runtime/agentHost.js';
import type { ToolPlugin } from '../registry.js';

class McpCapabilityModule implements CapabilityModule {
  id = 'tool.mcp';
  description = 'MCP bridge (stubbed)';

  async create(): Promise<CapabilityContribution> {
    const tools: ToolDefinition[] = [
      {
        name: 'mcp_call',
        description: 'Call an MCP server.',
        handler: async ({ target }: { target?: string }) => `MCP called: ${target ?? 'default'}`,
      },
    ];

    const toolSuite: ToolSuite = {
      id: 'mcp.tools',
      description: 'MCP integration',
      tools,
    };

    return { id: this.id, description: this.description, toolSuite };
  }
}

export function createMcpToolPlugin(): ToolPlugin {
  return {
    id: 'tool.mcp',
    targets: ['universal'],
    create: () => new McpCapabilityModule(),
  };
}
