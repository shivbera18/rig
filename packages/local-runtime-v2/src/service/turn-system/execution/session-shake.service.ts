import type { AgentMessage } from "@earendil-works/pi-agent-core";

import type { ShakeMode, ShakeOutcome } from "../contracts.js";
import type { SessionSystemCanonicalHistoryProvider } from "../../session-system/index.js";
import { planSessionShake } from "../compaction/algorithm/session-shake.js";

export interface SessionShakeServiceOptions {
  readonly history: Pick<SessionSystemCanonicalHistoryProvider, "read" | "replace">;
  readonly nowMs?: () => number;
}

export interface SessionShakeExecuteInput {
  readonly sessionId: string;
  readonly mode: ShakeMode;
}

/** Mechanical, non-LLM history rewrite behind the shake turn lease. No artifact writes. */
export function createSessionShakeService(options: SessionShakeServiceOptions) {
  const nowMs = options.nowMs ?? Date.now;
  return {
    async execute(input: SessionShakeExecuteInput): Promise<ShakeOutcome> {
      const snapshot = await options.history.read(input.sessionId);
      const messages = snapshot.messages as readonly AgentMessage[];
      const plan = planSessionShake({ messages, mode: input.mode });
      const messagesBefore = messages.length;
      if (!plan.changed) {
        return { status: "unchanged", reason: "nothing-to-shake" };
      }
      const replacementEntries = plan.messages.map((message, index) => ({
        message,
        identity:
          index < snapshot.identityVector.length && snapshot.identityVector[index]
            ? {
                kind: "preserve" as const,
                messageId: snapshot.identityVector[index] as string,
              }
            : { kind: "new" as const, seed: `shake:${input.mode}:${String(index)}` },
      }));
      const turnId = `shake-${input.mode}-${nowMs()}`;
      await options.history.replace({
        sessionId: input.sessionId,
        turnId,
        reason: "replaceMessages",
        messages: plan.messages,
        replacementEntries,
        operation: {
          id: `shake:${input.mode}:${String(nowMs())}`,
          kind: "replace",
        },
        metadata: { replacementId: turnId },
      } as Parameters<SessionSystemCanonicalHistoryProvider["replace"]>[0]);
      return {
        status: "completed",
        shakeId: turnId,
        mode: input.mode,
        toolResultsDropped: plan.toolResultsDropped,
        blocksDropped: plan.blocksDropped,
        imagesDropped: plan.imagesDropped,
        thinkingBlocksDropped: plan.thinkingBlocksDropped,
        tokensFreed: Math.max(0, Math.round(plan.freedBytes / 4)),
        messagesBefore,
        messagesAfter: plan.messages.length,
      };
    },
  };
}

export type SessionShakeService = ReturnType<typeof createSessionShakeService>;
