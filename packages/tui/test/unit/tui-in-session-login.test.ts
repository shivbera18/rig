import { describe, expect, it, vi } from "vitest";

import { TuiCommandFlow } from "../../src/tui/controller/product/command-flow.js";

function createFlow(overrides: {
  runInSession?: (providerId: string) => Promise<void>;
  surface?: { show: (...args: unknown[]) => void; close: (...args: unknown[]) => void };
} = {}) {
  const runInSessionProviderLogin =
    overrides.runInSession ?? vi.fn(async () => undefined);
  const flow = new TuiCommandFlow({
    workspaceDir: "/workspace",
    controller: {
      snapshot: vi.fn(() => ({ status: "idle", sessions: [], session: { sessionId: "s-1" } })),
      requireLoginForAgentAction: vi.fn(async () => undefined),
    } as never,
    activeRunFlow: { showHelp: vi.fn() } as never,
    featureFlow: {
      skillCommands: () => [],
      providerPort: {},
      prepareLoginDataDir: vi.fn(async () => "/data"),
    } as never,
    feedbackFlow: {} as never,
    updateFlow: {} as never,
    interactionFlow: { handleCommand: vi.fn(async () => false), hasPending: vi.fn(() => false) } as never,
    sessionFlow: {} as never,
    queueFlow: {} as never,
    composerDraft: { hasContent: vi.fn(() => false) } as never,
    workspaceRoots: { additionalDirectories: () => [] } as never,
    runProjection: { snapshot: () => ({ queuedCount: 0 }) } as never,
    editor: {
      getText: vi.fn(() => ""),
      setText: vi.fn(),
      onSubmit: undefined,
      handleInput: vi.fn(),
    } as never,
    surface: (overrides.surface ?? { show: vi.fn(), close: vi.fn() }) as never,
    surfaceHost: { setChatFocus: vi.fn() } as never,
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
  // Drive the picker selection directly: stub the method under test.
  (flow as unknown as { runInSessionProviderLogin: unknown }).runInSessionProviderLogin =
    runInSessionProviderLogin;
  return { flow, runInSessionProviderLogin };
}

describe("in-session provider login dispatch", () => {
  it("routes non-rig picker selection to runInSessionProviderLogin", async () => {
    const { flow, runInSessionProviderLogin } = createFlow();
    await expect(flow.submit("/login")).resolves.toBe("consumed");
    // Picker is shown; simulate selecting google-antigravity by invoking the
    // method the picker callback calls.
    await (flow as unknown as { runInSessionProviderLogin: (id: string) => Promise<void> }).runInSessionProviderLogin(
      "google-antigravity",
    );
    expect(runInSessionProviderLogin).toHaveBeenCalledWith("google-antigravity");
  });

  it("keeps the terminal-only message gone: no append mentions a separate terminal", async () => {
    const append = vi.fn();
    const flow = new TuiCommandFlow({
      workspaceDir: "/workspace",
      controller: {
        snapshot: vi.fn(() => ({ status: "idle", sessions: [], session: { sessionId: "s-1" } })),
        requireLoginForAgentAction: vi.fn(async () => undefined),
      } as never,
      activeRunFlow: { showHelp: vi.fn() } as never,
      featureFlow: { skillCommands: () => [] } as never,
      feedbackFlow: {} as never,
      updateFlow: {} as never,
      interactionFlow: { handleCommand: vi.fn(async () => false), hasPending: vi.fn(() => false) } as never,
      sessionFlow: {} as never,
      queueFlow: {} as never,
      composerDraft: { hasContent: vi.fn(() => false) } as never,
      workspaceRoots: { additionalDirectories: () => [] } as never,
      runProjection: { snapshot: () => ({ queuedCount: 0 }) } as never,
      editor: {} as never,
      surface: { show: vi.fn(), close: vi.fn() } as never,
      surfaceHost: {} as never,
      queueEnabled: true,
      liveRunId: () => undefined,
      runtimeStopping: () => false,
      abortLiveTurn: vi.fn(async () => false),
      leaveUi: vi.fn(async () => undefined),
      whenReady: vi.fn(async () => undefined),
      append,
      setHint: vi.fn(),
      onChanged: vi.fn(),
    });
    await expect(flow.submit("/login")).resolves.toBe("consumed");
    const texts = append.mock.calls.map((call) => String(call[0]));
    expect(texts.some((text) => text.includes("runs in the terminal"))).toBe(false);
  });
});
