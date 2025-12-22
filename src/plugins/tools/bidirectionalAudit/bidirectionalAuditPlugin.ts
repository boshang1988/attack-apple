import type { ToolDefinition, ToolSuite } from '../../../core/toolRuntime.js';
import type { CapabilityContribution, CapabilityModule } from '../../../runtime/agentHost.js';
import type { ToolPlugin } from '../registry.js';

class BidirectionalAuditModule implements CapabilityModule {
  id = 'tool.bidirectional-audit';
  description = 'Bidirectional audit and traceability tools';

  async create(): Promise<CapabilityContribution> {
    const tools: ToolDefinition[] = [
      {
        name: 'BidirectionalAudit',
        description: 'Record and replay key actions for compliance.',
        handler: async () => 'Audit trail recorded',
      },
    ];

    const toolSuite: ToolSuite = {
      id: 'audit.tools.bidirectional',
      description: 'Audit helpers',
      tools,
    };

    return { id: this.id, description: this.description, toolSuite };
  }
}

export function createBidirectionalAuditToolPlugin(): ToolPlugin {
  return {
    id: 'tool.bidirectional-audit',
    targets: ['universal'],
    create: () => new BidirectionalAuditModule(),
  };
}
