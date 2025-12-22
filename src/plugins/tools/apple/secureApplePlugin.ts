import type { ToolSuite } from '../../../core/toolRuntime.js';
import type { CapabilityContribution, CapabilityModule } from '../../../runtime/agentHost.js';
import type { ToolPlugin } from '../registry.js';
import { createSecureAppleExploitationTools } from '../../../tools/secureAppleExploitation.js';

class SecureAppleCapabilityModule implements CapabilityModule {
  id = 'tool.apple.secure';
  description = 'SECURE Apple exploitation tooling suite';

  async create(): Promise<CapabilityContribution> {
    const { tools } = createSecureAppleExploitationTools();
    const toolSuite: ToolSuite = {
      id: 'apple.tools.secure',
      description: 'Secure Apple security assessment tools (patched)',
      tools,
    };

    return {
      id: this.id,
      description: this.description,
      toolSuite,
    };
  }
}

export function createSecureAppleToolPlugin(): ToolPlugin {
  return {
    id: 'tool.apple.secure',
    targets: ['universal'],
    create: () => new SecureAppleCapabilityModule(),
  };
}