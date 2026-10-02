import type { PiBeforeToolCallHook } from '@rig/agent-core/pi-turn-runner';

import type { ReviewTurnState } from './turn-state.js';

// Bash retains ordinary permission checks; Review adds no argument policy.
const REVIEW_ALLOWED_TOOLS = new Set(['read', 'grep', 'glob', 'skill', 'bash']);
// Native controls enforce session ownership in the task service. Review must
// retain them when an allowed Bash call runs in the background.
const REVIEW_TASK_CONTROLS = new Set(['task_query', 'task_output', 'task_stop']);

export function createReviewToolGuard(state: ReviewTurnState): {
  beforeToolCall: PiBeforeToolCallHook;
} {
  return {
    beforeToolCall(toolContext) {
      if (!state.isReviewActivated()) return undefined;

      const toolName = toolContext.toolCall.name;
      if (toolName === 'code_review') {
        return {
          block: true,
          reason: buildRepeatedCodeReviewReason(state.prepared),
        };
      }
      if (toolName === 'skill' && readSkillName(toolContext.args) === 'code-review') {
        return {
          block: true,
          reason: buildRepeatedCodeReviewSkillReason(state.prepared),
        };
      }
      const source = readToolSource(toolContext.toolCall);
      if (source !== 'configured' && REVIEW_ALLOWED_TOOLS.has(toolName)) return undefined;
      if ((source === undefined || source === 'builtin') && REVIEW_TASK_CONTROLS.has(toolName)) {
        return undefined;
      }

      return {
        block: true,
        reason: `Code Review tool policy denied "${toolName}".`,
      };
    },
  };
}

function readSkillName(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const name = (input as { name?: unknown }).name;
  return typeof name === 'string' ? name.trim().toLowerCase() : undefined;
}

function buildRepeatedCodeReviewSkillReason(_prepared: ReviewTurnState['prepared']): string {
  return 'Structured Review is already active. Do not load the code-review Skill; continue with the allowed read-only tools.';
}

function buildRepeatedCodeReviewReason(prepared: ReviewTurnState['prepared']): string {
  const isSlash = prepared?.trigger === 'slash';
  return isSlash
    ? 'Code Review is already active for this Slash request. Do not call code_review again. Inspect the current changes using the allowed read-only tools and return the review result.'
    : 'Code Review is already active for this turn. Do not call code_review again. Continue with the allowed read-only tools and return the review result.';
}

function readToolSource(toolCall: unknown): unknown {
  if (!toolCall || typeof toolCall !== 'object') return undefined;
  return (toolCall as { source?: unknown }).source;
}
