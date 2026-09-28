import type { ResolvedAgentCapabilities } from '@rig/config';

import type { HostedAgentCapabilityRestrictions } from './hosted-agent-capabilities.js';

export function applyHostedCapabilityRestrictions(
  capabilities: ResolvedAgentCapabilities,
  restrictions: HostedAgentCapabilityRestrictions,
): ResolvedAgentCapabilities {
  if (!restrictions.disableRig) return capabilities;
  return {
    ...capabilities,
    features: {
      ...capabilities.features,
      rig: false,
    },
  };
}
