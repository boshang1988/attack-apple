import { AuthorizedSecurityCapabilityModule } from '../../../capabilities/authorizedSecurityCapability.js';
import type { ToolPlugin } from '../registry.js';

export function createAuthorizedSecurityToolPlugin(): ToolPlugin {
  return {
    id: 'tool.authorized-security',
    targets: ['node', 'cloud'],
    create: () => new AuthorizedSecurityCapabilityModule(),
  };
}
