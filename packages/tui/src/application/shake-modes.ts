/** Shake modes + one-line summary. Dependency-free leaf (cf oh-my-pi shake-types). */
export type ShakeMode = "elide" | "images" | "thinking";

export interface ShakeOutcome {
  mode: ShakeMode;
  toolResultsDropped: number;
  blocksDropped: number;
  imagesDropped?: number;
  thinkingBlocksDropped?: number;
  tokensFreed: number;
  messagesBefore: number;
  messagesAfter: number;
}

/** Empty defaults to elide. */
export function parseShakeMode(args: string): ShakeMode | { error: string } {
  const verb = args.trim().toLowerCase();
  if (verb === "" || verb === "elide") return "elide";
  if (verb === "images") return "images";
  if (verb === "thinking") return "thinking";
  return { error: `Unknown /shake mode "${verb}". Use elide, images, or thinking.` };
}

export function formatShakeSummary(
  result: Pick<
    ShakeOutcome,
    "mode" | "toolResultsDropped" | "blocksDropped" | "tokensFreed"
  > & { imagesDropped?: number; thinkingBlocksDropped?: number },
): string {
  if (result.mode === "images") {
    const n = result.imagesDropped ?? 0;
    return n === 0
      ? "No images found in this session."
      : `Dropped ${n} image${n === 1 ? "" : "s"} from this session.`;
  }
  if (result.mode === "thinking") {
    const n = result.thinkingBlocksDropped ?? 0;
    return n === 0
      ? "No thinking blocks found in this session."
      : `Dropped ${n} thinking block${n === 1 ? "" : "s"} from this session${result.tokensFreed > 0 ? ` (~${result.tokensFreed} tokens freed)` : ""}.`;
  }
  const parts: string[] = [];
  if (result.toolResultsDropped > 0) {
    parts.push(`${result.toolResultsDropped} tool result${result.toolResultsDropped === 1 ? "" : "s"}`);
  }
  if (result.blocksDropped > 0) {
    parts.push(`${result.blocksDropped} block${result.blocksDropped === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) return "Nothing to shake.";
  // tokensFreed estimated as freedBytes / 4 (no tokenizer on this path).
  return `Shook ${parts.join(" + ")} (~${result.tokensFreed} tokens freed).`;
}
