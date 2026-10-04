import { describe, expect, it } from "vitest";

import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { planSessionShake } from "./session-shake.js";

function assistantTool(id: string, name: string, timestamp: number): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id, name, arguments: {} }],
    stopReason: "toolUse",
    timestamp,
  } as unknown as AgentMessage;
}

function toolResult(id: string, name: string, text: string, timestamp: number): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: name,
    content: [{ type: "text", text }],
    isError: false,
    timestamp,
  };
}

function userText(text: string, timestamp: number): AgentMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp } as AgentMessage;
}

function assistantText(text: string, timestamp: number): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    timestamp,
  } as unknown as AgentMessage;
}

describe("planSessionShake", () => {
  it("elide trims unprotected tool results and keeps the newest round", () => {
    const messages = [
      assistantTool("a", "read", 1),
      toolResult("a", "read", "old output", 2),
      assistantTool("b", "read", 3),
      toolResult("b", "read", "new output", 4),
    ];
    const plan = planSessionShake({ messages, mode: "elide" });
    expect(plan.changed).toBe(true);
    expect(plan.toolResultsDropped).toBe(1);
    expect(plan.messages).toHaveLength(messages.length);
    expect(JSON.stringify(plan.messages[1])).toContain("removed by context compaction");
    expect(JSON.stringify(plan.messages[3])).toContain("new output");
  });

  it("elide strips large fenced spans and preserves surrounding text", () => {
    const fence = `\`\`\`ts\n${"x".repeat(2000)}\n\`\`\``;
    const messages = [assistantText(`intro\n${fence}\noutro`, 1)];
    const plan = planSessionShake({ messages, mode: "elide" });
    expect(plan.changed).toBe(true);
    expect(plan.blocksDropped).toBe(1);
    const text = JSON.stringify(plan.messages[0]);
    expect(text).not.toContain("xxxx");
    expect(text).toContain("intro");
    expect(text).toContain("outro");
  });

  it("elide preserves text between two large fenced spans", () => {
    const fence = `\`\`\`ts\n${"y".repeat(2000)}\n\`\`\``;
    const messages = [assistantText(`head\n${fence}\nMIDDLE\n${fence}\ntail`, 1)];
    const plan = planSessionShake({ messages, mode: "elide" });
    expect(plan.blocksDropped).toBe(2);
    const text = JSON.stringify(plan.messages[0]);
    for (const kept of ["head", "MIDDLE", "tail"]) expect(text).toContain(kept);
  });

  it("thinking strips thinking blocks but keeps the message", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "hmm" },
          { type: "text", text: "answer" },
        ],
        stopReason: "stop",
        timestamp: 1,
      } as unknown as AgentMessage,
    ];
    const plan = planSessionShake({ messages, mode: "thinking" });
    expect(plan.changed).toBe(true);
    expect(plan.thinkingBlocksDropped).toBe(1);
    expect(plan.messages).toHaveLength(1);
    expect(JSON.stringify(plan.messages[0])).not.toContain("hmm");
  });

  it("images strips media blocks", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image", data: "abc", mimeType: "image/png" },
        ],
        timestamp: 1,
      } as unknown as AgentMessage,
    ];
    const plan = planSessionShake({ messages, mode: "images" });
    expect(plan.changed).toBe(true);
    expect(plan.imagesDropped).toBe(1);
  });

  it("thinking clears top-level thinking_content fields", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: "answer" }],
        thinking_content: "private reasoning",
        stopReason: "stop",
        timestamp: 1,
      } as unknown as AgentMessage,
    ];
    const plan = planSessionShake({ messages, mode: "thinking" });
    expect(plan.changed).toBe(true);
    expect(plan.thinkingBlocksDropped).toBe(1);
    expect(JSON.stringify(plan.messages[0])).not.toContain("private reasoning");
  });

  it("returns changed:false for empty and already-shaken inputs", () => {
    expect(planSessionShake({ messages: [], mode: "elide" }).changed).toBe(false);
    const shaken = [
      assistantTool("a", "read", 1),
      {
        role: "toolResult",
        toolCallId: "a",
        toolName: "read",
        content: [{ type: "text", text: "[Tool result removed by context compaction.]" }],
        isError: false,
        timestamp: 2,
      } as unknown as AgentMessage,
      userText("hi", 3),
    ];
    const plan = planSessionShake({ messages: shaken, mode: "elide" });
    expect(plan.changed).toBe(false);
  });

  it("throws on unknown mode", () => {
    expect(() =>
      planSessionShake({ messages: [userText("hi", 1)], mode: "nope" as never }),
    ).toThrow();
  });
});
