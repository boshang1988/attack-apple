import { OffensiveDestructionCapabilityModule } from '../../../capabilities/offensiveDestructionCapability.js';
import type { ToolPlugin } from '../registry.js';

export function createOffensiveDestructionToolPlugin(): ToolPlugin {
  return {
    id: 'tool.offensive-destruction',
    targets: ['node', 'cloud'],
    create: () => new OffensiveDestructionCapabilityModule(),
  };
}