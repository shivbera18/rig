import { describe, expect, it, vi } from "vitest";

import { TUI_COMMAND_DESCRIPTORS } from "../../src/application/command-descriptors.js";
import { createTuiCommandCatalog } from "../../src/tui/commands/catalog.js";
import { TuiCommandFlow } from "../../src/tui/controller/product/command-flow.js";
import { TuiFeatureFlow } from "../../src/tui/controller/product/feature-flow.js";
import { TranscriptStore } from "../../src/tui/transcript/store.js";

function createCatalog() {
  return createTuiCommandCatalog([], {}, () => ({
    hasSession: true,
    hasParentSession: false,
    managedTokenPresent: true,
    queueEnabled: true,
    hasLiveRun: false,
    queuedCount: 0,
    canRetry: false,
  }));
}

function createFlow(featureFlow: unknown, controller: unknown) {
  return new TuiCommandFlow({
    workspaceDir: "/workspace",
    controller: controller as never,
    activeRunFlow: { showHelp: vi.fn() } as never,
    featureFlow: featureFlow as never,
    feedbackFlow: {} as never,
    updateFlow: {} as never,
    interactionFlow: { handleCommand: vi.fn(async () => false), hasPending: vi.fn(() => false) } as never,
    sessionFlow: {} as never,
    queueFlow: {} as never,
    composerDraft: { hasContent: vi.fn(() => false) } as never,
    workspaceRoots: { additionalDirectories: () => [] } as never,
    runProjection: { snapshot: () => ({ queuedCount: 0 }) } as never,
    editor: {} as never,
    surface: {} as never,
    surfaceHost: {} as never,
    queueEnabled: true,
    liveRunId: () => undefined,
    runtimeStopping: () => false,
    abortLiveTurn: vi.fn(async () => false),
    leaveUi: vi.fn(async () => undefined),
    whenReady: vi.fn(async () => undefined),
    append: vi.fn(),
    setHint: vi.fn(),
    onChanged: vi.fn(),
  });
}

describe("shake command registration", () => {
  it("exposes the shake descriptor", () => {
    expect(TUI_COMMAND_DESCRIPTORS.shake).toEqual({
      name: "shake",
      description: "Drop heavy content from context (tool results, large blocks)",
    });
  });

  it("catalogs shake as idle-only with mode completions", () => {
    const catalog = createCatalog();
    const shake = catalog.commands.find((command) => command.name === "shake");
    expect(shake).toMatchObject({
      argumentHint: "[elide | images | thinking]",
      runAvailability: "idle",
    });
    expect(shake?.visibleWhen?.({ hasSession: false } as never)).toBe(false);
    expect(shake?.visibleWhen?.({ hasSession: true } as never)).toBe(true);
    const completions = shake?.getArgumentCompletions?.("") ?? [];
    expect(completions.map((completion) => completion.value).sort()).toEqual([
      "elide",
      "images",
      "thinking",
    ]);
  });

  it("routes /shake images through the login gate to shakeSession", async () => {
    const shakeSession = vi.fn(async () => undefined);
    const requireLoginForAgentAction = vi.fn(async () => undefined);
    const flow = createFlow(
      { skillCommands: () => [], shakeSession },
      {
        snapshot: () => ({ status: "idle", sessions: [], session: { sessionId: "s-1" } }),
        requireLoginForAgentAction,
      },
    );
    await expect(flow.submit("/shake images")).resolves.toBe("consumed");
    expect(requireLoginForAgentAction).toHaveBeenCalledOnce();
    expect(shakeSession).toHaveBeenCalledWith("images", false);
  });
});

describe("shakeSession", () => {
  function createHarness() {
    let activeSessionId: string | undefined = "session-a";
    const append = vi.fn();
    const setCompacting = vi.fn();
    const requestShake = vi.fn();
    const runtime = {
      requestShake,
      requestCompaction: vi.fn(),
      listModels: vi.fn(async () => []),
      getAccountStatus: vi.fn(async () => ({ status: "needs-login", warnings: [] })),
    };
    const flow = new TuiFeatureFlow({
      runtime: runtime as never,
      controller: {
        snapshot: () => ({
          sessions: [],
          session: activeSessionId
            ? { sessionId: activeSessionId, agentName: "rig", workspaceDir: "/workspace" }
            : undefined,
        }),
        refreshCurrentSessionHistory: vi.fn(),
        refreshStatusMetricsNow: vi.fn(),
      } as never,
      surface: { show: vi.fn(), close: vi.fn() } as never,
      surfaceHost: {
        pushFeature: () => ({ id: "x", close: () => true, isActive: () => false }),
        getActiveSurface: () => ({ kind: "chat" }),
      } as never,
      editor: { setText: vi.fn() } as never,
      transcript: new TranscriptStore(),
      transcriptView: { toggleDetailMode: vi.fn() } as never,
      workspaceDir: "/workspace",
      defaultAgentName: "rig",
      terminalRows: () => 40,
      append,
      setCompacting,
      setHint: vi.fn(),
      onChanged: vi.fn(),
      onNewSession: vi.fn(),
      onOpenSession: vi.fn(async () => undefined),
      onArchivedCurrentSession: vi.fn(),
      refreshAutocomplete: vi.fn(),
    } as never);
    return { append, setCompacting, requestShake, flow, clearSession: () => { activeSessionId = undefined; } };
  }

  it("warns on unknown mode without calling the runtime", async () => {
    const harness = createHarness();
    await harness.flow.shakeSession("nope", false);
    expect(harness.append).toHaveBeenCalledWith(
      'Unknown /shake mode "nope". Use elide, images, or thinking.',
      "warning",
    );
    expect(harness.requestShake).not.toHaveBeenCalled();
  });

  it("warns when a turn is live or no session exists", async () => {
    const harness = createHarness();
    await harness.flow.shakeSession("", true);
    expect(harness.append).toHaveBeenCalledWith(
      "Stop the running turn before shaking this Session.",
      "warning",
    );
    harness.clearSession();
    await harness.flow.shakeSession("", false);
    expect(harness.requestShake).not.toHaveBeenCalled();
  });

  it("appends the mode summary on success", async () => {
    const harness = createHarness();
    harness.requestShake.mockResolvedValueOnce({
      success: true,
      mode: "images",
      imagesDropped: 2,
      messagesBefore: 10,
      messagesAfter: 10,
    });
    await harness.flow.shakeSession("images", false);
    expect(harness.requestShake).toHaveBeenCalledWith("session-a", "rig", "images");
    expect(harness.append).toHaveBeenCalledWith("Dropped 2 images from this session.");
    expect(harness.setCompacting.mock.calls).toEqual([[true], [false]]);
  });

  it("reports the no-op line on NOTHING_TO_SHAKE", async () => {
    const harness = createHarness();
    harness.requestShake.mockResolvedValueOnce({ success: false, code: "NOTHING_TO_SHAKE" });
    await harness.flow.shakeSession("thinking", false);
    expect(harness.append).toHaveBeenCalledWith("No thinking blocks found in this session.");
  });

  it("maps a thrown NOTHING_TO_SHAKE key to the no-op line", async () => {
    const harness = createHarness();
    harness.requestShake.mockRejectedValueOnce(
      Object.assign(new Error("Nothing to shake"), { key: "NOTHING_TO_SHAKE" }),
    );
    await harness.flow.shakeSession("thinking", false);
    expect(harness.append).toHaveBeenCalledWith("No thinking blocks found in this session.");
  });
});
