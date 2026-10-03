import { describe, expect, it } from "vitest";

import { formatShakeSummary, parseShakeMode } from "../../src/application/shake-modes.js";

describe("parseShakeMode", () => {
  it.each([["", "elide"], ["elide", "elide"], ["ELIDE", "elide"]] as const)(
    "parses %p as elide",
    (input, expected) => {
      expect(parseShakeMode(input)).toBe(expected);
    },
  );
  it("parses images and thinking case-insensitively", () => {
    expect(parseShakeMode("images")).toBe("images");
    expect(parseShakeMode("THINKING")).toBe("thinking");
  });
  it("rejects unknown modes with the exact error", () => {
    expect(parseShakeMode("nope")).toEqual({
      error: 'Unknown /shake mode "nope". Use elide, images, or thinking.',
    });
  });
});

describe("formatShakeSummary", () => {
  it("summarizes elide counts", () => {
    expect(
      formatShakeSummary({ mode: "elide", toolResultsDropped: 2, blocksDropped: 1, tokensFreed: 100 }),
    ).toBe("Shook 2 tool results + 1 block (~100 tokens freed).");
  });
  it("reports nothing to shake", () => {
    expect(
      formatShakeSummary({ mode: "elide", toolResultsDropped: 0, blocksDropped: 0, tokensFreed: 0 }),
    ).toBe("Nothing to shake.");
  });
  it("summarizes images mode", () => {
    expect(
      formatShakeSummary({ mode: "images", toolResultsDropped: 0, blocksDropped: 0, tokensFreed: 0, imagesDropped: 0 }),
    ).toBe("No images found in this session.");
    expect(
      formatShakeSummary({ mode: "images", toolResultsDropped: 0, blocksDropped: 0, tokensFreed: 0, imagesDropped: 3 }),
    ).toBe("Dropped 3 images from this session.");
  });
  it("summarizes thinking mode", () => {
    expect(
      formatShakeSummary({ mode: "thinking", toolResultsDropped: 0, blocksDropped: 0, tokensFreed: 0, thinkingBlocksDropped: 0 }),
    ).toBe("No thinking blocks found in this session.");
    expect(
      formatShakeSummary({ mode: "thinking", toolResultsDropped: 0, blocksDropped: 0, tokensFreed: 50, thinkingBlocksDropped: 1 }),
    ).toBe("Dropped 1 thinking block from this session (~50 tokens freed).");
  });
});
