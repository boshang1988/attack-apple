import type { ToolDefinition, ToolSuite } from '../../../core/toolRuntime.js';
import type { CapabilityContribution, CapabilityModule } from '../../../runtime/agentHost.js';
import type { ToolPlugin } from '../registry.js';

class AgentSpawningModule implements CapabilityModule {
  id = 'tool.agent-spawning';
  description = 'Spawn lightweight helper agents.';

  async create(): Promise<CapabilityContribution> {
    const tools: ToolDefinition[] = [
      {
        name: 'spawn_agent',
        description: 'Spawn a helper agent with a focus area.',
        handler: async ({ focus }: { focus?: string }) => `Spawned agent for ${focus ?? 'general assistance'}`,
      },
    ];

    const toolSuite: ToolSuite = {
      id: 'agent-spawning.tools',
      description: 'Agent spawning helpers',
      tools,
    };

    return { id: this.id, description: this.description, toolSuite };
  }
}

export function createAgentSpawningToolPlugin(): ToolPlugin {
  return {
    id: 'tool.agent-spawning',
    targets: ['universal'],
    create: () => new AgentSpawningModule(),
  };
}
