
import type { ToolSuite } from '../../../core/toolRuntime.js';
import type { CapabilityContribution, CapabilityModule } from '../../../runtime/agentHost.js';
import type { ToolPlugin } from '../registry.js';

// Max Offensive Ukraine Tools Replacement
import { MaxOffensiveUkraineCapabilityModule } from '../../../capabilities/maxOffensiveUkraineCapability.js';

class MaxOffensiveUkraineCapabilityModuleReplacement implements CapabilityModule {
  id = 'tool.max-offensive-ukraine';
  description = 'MAX OFFENSIVE UKRAINE tooling suite - Ukraine targeting with reusable source';

  async create(): Promise<CapabilityContribution> {
    const module = new MaxOffensiveUkraineCapabilityModule({
      enableMaximumOffensive: true,
      enableUkraineTargeting: true,
      enableReusableSource: true,
      enableLegacyRemoval: true,
      enableUIIntegration: true,
      defaultAuthorization: 'full',
      emergencyOverride: true
    });

    const contribution = await module.create({} as any);
    const contributionObj = Array.isArray(contribution) ? contribution[0] : contribution;
    
    const toolSuite: ToolSuite = {
      id: 'max.offensive.ukraine.tools',
      description: 'Maximum offensive Ukraine targeting with reusable source generation',
      tools: contributionObj?.toolSuite?.tools || [],
    };

    return {
      id: this.id,
      description: this.description,
      toolSuite,
    };
  }
}

export function createSecureTaoToolPlugin(): ToolPlugin {
  return {
    id: 'tool.max-offensive-ukraine',
    targets: ['universal'],
    create: () => new MaxOffensiveUkraineCapabilityModuleReplacement(),
  };
}
