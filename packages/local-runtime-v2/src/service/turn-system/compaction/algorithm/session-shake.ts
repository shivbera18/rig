import type { AgentMessage } from "@earendil-works/pi-agent-core";

import {
  buildAttachmentFreeCandidate,
  buildToolTrimCandidate,
} from "./history-reduction.js";

// Kept in sync with packages/tui/src/application/shake-modes.ts.
export type ShakeMode = "elide" | "images" | "thinking";

export interface ShakePlanInput {
  readonly messages: readonly AgentMessage[];
  readonly mode: ShakeMode;
}

export interface ShakePlan {
  readonly messages: readonly AgentMessage[];
  readonly toolResultsDropped: number;
  readonly blocksDropped: number;
  readonly imagesDropped: number;
  readonly thinkingBlocksDropped: number;
  readonly freedBytes: number;
  readonly changed: boolean;
}
const BLOCK_REMOVED_TEXT = "[Block removed by context shake.]";
const EMPTY_TEXT_BLOCK = { type: "text", text: "" } as const;

// Minimum span size for fenced/XML elision. oh-my-pi gates on ~400 tokens;
// with no tokenizer on this path, bytes/4 approximates tokens.
const FENCE_MIN_BYTES = 1600;

const OPENING_XML = /^<([a-z_-]+)(?:\s+[^>]*)?>$/;
const CLOSING_XML = /^<\/([a-z_-]+)>$/;

export function planSessionShake(input: ShakePlanInput): ShakePlan {
  const messages = input.messages;
  if (messages.length === 0) return emptyPlan(messages);
  switch (input.mode) {
    case "elide":
      return planElide(messages);
    case "images":
      return planImages(messages);
    case "thinking":
      return planThinking(messages);
    default:
      throw new Error(`Unknown shake mode: ${String(input.mode)}`);
  }
}

function emptyPlan(messages: readonly AgentMessage[]): ShakePlan {
  return {
    messages,
    toolResultsDropped: 0,
    blocksDropped: 0,
    imagesDropped: 0,
    thinkingBlocksDropped: 0,
    freedBytes: 0,
    changed: false,
  };
}

function planElide(messages: readonly AgentMessage[]): ShakePlan {
  // Newest-round protection comes from buildToolTrimCandidate's
  // PROTECTED_TOOL_ROUND_RATIO; incomplete tool tails throw, in which case
  // tool elision is skipped but block elision still runs.
  let afterTools = messages;
  let toolResultsDropped = 0;
  let toolFreedBytes = 0;
  try {
    const candidate = buildToolTrimCandidate(messages);
    toolResultsDropped = candidate.trimmedResultCount;
    if (toolResultsDropped > 0) {
      toolFreedBytes = diffTextBytes(messages, candidate.messages);
      afterTools = candidate.messages;
    }
  } catch {
    // Unsettled/orphan tool tail: leave tool results alone.
  }
  const blockResult = elideBlockSpans(afterTools);
  const freedBytes = toolFreedBytes + blockResult.freedBytes;
  const changed = toolResultsDropped > 0 || blockResult.blocksDropped > 0;
  return {
    messages: changed ? blockResult.messages : messages,
    toolResultsDropped,
    blocksDropped: blockResult.blocksDropped,
    imagesDropped: 0,
    thinkingBlocksDropped: 0,
    freedBytes,
    changed,
  };
}

function planImages(messages: readonly AgentMessage[]): ShakePlan {
  const candidate = buildAttachmentFreeCandidate(messages);
  if (candidate.replacedBlockCount === 0) return emptyPlan(messages);
  return {
    messages: candidate.messages,
    toolResultsDropped: 0,
    blocksDropped: 0,
    imagesDropped: candidate.replacedBlockCount,
    thinkingBlocksDropped: 0,
    freedBytes: diffTextBytes(messages, candidate.messages),
    changed: true,
  };
}

function planThinking(messages: readonly AgentMessage[]): ShakePlan {
  const replacements = new Map<number, AgentMessage>();
  let thinkingBlocksDropped = 0;
  let freedBytes = 0;
  messages.forEach((message, index) => {
    if (message.role !== "assistant") return;
    let changed = false;
    const replacement = { ...message };
    for (const field of ["thinking_content", "thinking", "thinkingContent"] as const) {
      const value = Reflect.get(message, field);
      if (typeof value === "string" && value.length > 0) {
        thinkingBlocksDropped += 1;
        freedBytes += Buffer.byteLength(value, "utf8");
        Reflect.deleteProperty(replacement, field);
        changed = true;
      }
    }
    const duration = Reflect.get(message, "thinking_duration_ms");
    if (typeof duration === "number") {
      Reflect.deleteProperty(replacement, "thinking_duration_ms");
      changed = true;
    }
    const content = Reflect.get(message, "content");
    if (Array.isArray(content)) {
      const kept = content.filter((block) => {
        if (typeof block !== "object" || block === null || Reflect.get(block, "type") !== "thinking")
          return true;
        thinkingBlocksDropped += 1;
        freedBytes += Buffer.byteLength(JSON.stringify(block), "utf8");
        return false;
      });
      if (kept.length !== content.length) {
        Reflect.set(replacement, "content", kept.length > 0 ? kept : [{ ...EMPTY_TEXT_BLOCK }]);
        changed = true;
      }
    }
    if (changed) replacements.set(index, replacement);
  });
  if (replacements.size === 0) return emptyPlan(messages);
  return {
    messages: messages.map((message, index) => replacements.get(index) ?? message),
    toolResultsDropped: 0,
    blocksDropped: 0,
    imagesDropped: 0,
    thinkingBlocksDropped,
    freedBytes,
    changed: true,
  };
}

function elideBlockSpans(messages: readonly AgentMessage[]): {
  messages: readonly AgentMessage[];
  blocksDropped: number;
  freedBytes: number;
} {
  const replacements = new Map<number, AgentMessage>();
  let blocksDropped = 0;
  let freedBytes = 0;
  messages.forEach((message, index) => {
    if (message.role !== "assistant" && message.role !== "user") return;
    const content = Reflect.get(message, "content");
    if (typeof content === "string") {
      const elided = elideTextSpans(content);
      if (!elided) return;
      blocksDropped += elided.blocks;
      freedBytes += elided.freedBytes;
      replacements.set(index, { ...message, content: elided.text } as AgentMessage);
      return;
    }
    if (!Array.isArray(content)) return;
    let messageBlocks = 0;
    let messageFreed = 0;
    const nextContent = content.map((block) => {
      if (typeof block !== "object" || block === null || Reflect.get(block, "type") !== "text")
        return block;
      const text = Reflect.get(block, "text");
      if (typeof text !== "string") return block;
      const elided = elideTextSpans(text);
      if (!elided) return block;
      messageBlocks += elided.blocks;
      messageFreed += elided.freedBytes;
      return { ...block, text: elided.text };
    });
    if (messageBlocks === 0) return;
    blocksDropped += messageBlocks;
    freedBytes += messageFreed;
    const replacement = { ...message };
    Reflect.set(replacement, "content", nextContent);
    replacements.set(index, replacement);
  });
  return {
    messages:
      replacements.size === 0
        ? messages
        : messages.map((message, index) => replacements.get(index) ?? message),
    blocksDropped,
    freedBytes,
  };
}

function elideTextSpans(text: string): { text: string; blocks: number; freedBytes: number } | undefined {
  const ranges = scanTextForBlockRanges(text).filter(
    (range) => range.end - range.start >= FENCE_MIN_BYTES,
  );
  if (ranges.length === 0) return undefined;
  let out = "";
  let cursor = 0;
  let freedBytes = 0;
  for (const range of ranges) {
    out += text.slice(cursor, range.start);
    out += BLOCK_REMOVED_TEXT;
    freedBytes +=
      Buffer.byteLength(text.slice(range.start, range.end), "utf8") - BLOCK_REMOVED_TEXT.length;
    cursor = range.end;
  }
  out += text.slice(cursor);
  return { text: out, blocks: ranges.length, freedBytes: Math.max(0, freedBytes) };
}

// Port of oh-my-pi scanTextForBlockRanges: fenced ``` / ~~~ spans plus
// top-level lowercase-tag XML spans. Unterminated spans yield no range;
// XML detection is suppressed inside fences.
function scanTextForBlockRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let inFence = false;
  let fenceStart = -1;
  const tagStack: string[] = [];
  let xmlStart = -1;
  let lineStart = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i !== text.length && text[i] !== "\n") continue;
    const line = text.slice(lineStart, i);
    const lineEnd = i;
    const trimmedStart = line.trimStart();
    const isFenceLine = trimmedStart.startsWith("```") || trimmedStart.startsWith("~~~");
    if (isFenceLine) {
      if (!inFence) {
        inFence = true;
        fenceStart = lineStart;
      } else {
        inFence = false;
        ranges.push({ start: fenceStart, end: lineEnd });
        fenceStart = -1;
      }
      lineStart = i + 1;
      continue;
    }
    if (!inFence) {
      const isOpeningXml = line.length === trimmedStart.length && OPENING_XML.test(trimmedStart);
      if (isOpeningXml) {
        const match = OPENING_XML.exec(trimmedStart);
        if (match?.[1]) {
          if (tagStack.length === 0) xmlStart = lineStart;
          tagStack.push(match[1]);
        }
      } else {
        const closingMatch = CLOSING_XML.exec(trimmedStart);
        if (
          closingMatch?.[1] &&
          tagStack.length > 0 &&
          tagStack[tagStack.length - 1] === closingMatch[1]
        ) {
          tagStack.pop();
          if (tagStack.length === 0 && xmlStart >= 0) {
            ranges.push({ start: xmlStart, end: lineEnd });
            xmlStart = -1;
          }
        }
      }
    }
    lineStart = i + 1;
  }
  return mergeRanges(ranges);
}

function mergeRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const kept: Array<{ start: number; end: number }> = [];
  let lastEnd = -1;
  for (const range of sorted) {
    if (range.start < lastEnd) continue;
    kept.push(range);
    lastEnd = range.end;
  }
  return kept;
}

function diffTextBytes(before: readonly AgentMessage[], after: readonly AgentMessage[]): number {
  let freed = 0;
  for (let i = 0; i < before.length; i++) {
    freed +=
      Buffer.byteLength(JSON.stringify(before[i]), "utf8") -
      Buffer.byteLength(JSON.stringify(after[i]), "utf8");
  }
  return Math.max(0, freed);
}
