import type { RuntimeConversation } from '@rig/conversation-contract';

import type { V1ConversationCompatibilityOptions } from './contracts.js';
import { V1ConversationCompatibilityService } from './v1-conversation-compat.js';

export function createV1ConversationCompatibility(
  options: V1ConversationCompatibilityOptions,
): RuntimeConversation {
  return new V1ConversationCompatibilityService(options);
}
