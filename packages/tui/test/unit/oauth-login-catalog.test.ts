import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  createPortCredentialWriter,
  resolveRigLoginOAuthPaths,
} from "../../src/login/credential-store.js";
import { NEVER_EXPIRES } from "../../src/login/engines/oauth-login.js";
import type {
  RigDiscoverProviderModelsInput,
  RigProviderModel,
  RigProviderRuntimePort,
} from "../../src/provider/contract.js";

interface PortStub extends RigProviderRuntimePort {
  readonly created: unknown[];
  readonly savedCandidates: unknown[];
  syncOAuthProviderModels: (
    input: { readonly providerId: string; readonly access: string },
  ) => Promise<{ refreshError?: string }>;
}

function createStub(
  overrides: {
    readonly listUserModelProviders?: () => Promise<readonly PortStubListRow[]>;
    readonly discoverUserModelsCandidate?: (
      input: RigDiscoverProviderModelsInput,
    ) => Promise<readonly RigProviderModel[]>;
  } = {},
): { port: PortStub; calls: { created: unknown[]; saved: unknown[] } } {
  const calls: { created: unknown[]; saved: unknown[] } = { created: [], saved: [] };
  const rows: PortStubListRow[] = [];
  const port = {
    created: calls.created,
    savedCandidates: calls.saved,
    discoverUserModelsCandidate:
      overrides.discoverUserModelsCandidate ??
      (async (): Promise<readonly RigProviderModel[]> => []),
    listProviderPresets: async () => [],
    getCodexOAuthStatus: async () => ({ state: "disconnected" as const, providerId: "openai-codex" }),
    startCodexOAuthLogin: async () => ({
      state: "pending" as const,
      providerId: "openai-codex",
    }),
    cancelCodexOAuthLogin: async () => ({
      state: "disconnected" as const,
      providerId: "openai-codex",
    }),
    listUserModelProviders: overrides.listUserModelProviders ?? (async () => [...rows]),
    getRigApiKeyStatus: async () => ({ hasApiKey: false }),
    getRigModelSource: async () => "token_plan" as const,
    setRigModelSource: async (source: "token_plan" | "rig_api_key") => source,
    upsertRigApiKey: async () => undefined,
    createUserModelProvider: async (input: unknown) => {
      calls.created.push(input);
    },
    saveUserModelProviderCandidate: async (input: unknown) => {
      calls.saved.push(input);
      return { success: true as const };
    },
    updateUserModelProvider: async () => undefined,
    deleteUserModelProvider: async () => undefined,
    testUserModelProvider: async () => ({ success: true as const, status: { state: "available" } }),
    testUserModel: async () => ({ success: true as const, status: { state: "available" } }),
    syncOAuthProviderModels: async (input: {
      readonly providerId: string;
      readonly access: string;
    }) => {
      rows.push({
        providerId: input.providerId.startsWith("custom_provider:")
          ? input.providerId
          : `custom_provider:${input.providerId}`,
        name: input.providerId,
        kind: "custom",
        enabled: true,
        models: [{ modelId: "discovered-model-1" }],
      });
      return {};
    },
  } as unknown as PortStub;
  return { port, calls };
}

interface PortStubListRow {
  readonly providerId: string;
  readonly name?: string;
  readonly kind?: string;
  readonly enabled?: boolean;
  readonly models?: readonly { readonly modelId: string }[];
}

describe("OAuth login provisions the model catalog", () => {
  it("saveOAuth creates a custom_provider row so /model lists the provider", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "rig-login-catalog-"));
    const rows: PortStubListRow[] = [];
    const { port } = createStub({
      listUserModelProviders: async () => [...rows],
    });
    const create = port.createUserModelProvider.bind(port);
    port.createUserModelProvider = (async (input: unknown) => {
      const created = input as { name: string; models?: readonly { readonly modelId: string }[] };
      rows.push({
        providerId: "custom_provider:google-antigravity",
        name: created.name,
        kind: "custom",
        enabled: true,
        models: created.models ?? [],
      });
      return create(input as never);
    }) as typeof port.createUserModelProvider;
    const writer = createPortCredentialWriter(port, {
      prepareDataDir: async () => dataDir,
    });

    await writer.saveOAuth("google-antigravity", {
      access: "tok",
      refresh: "ref",
      expires: NEVER_EXPIRES,
    });

    // Tokens still land in auth.json (existing behavior).
    const { credentialPath } = resolveRigLoginOAuthPaths(dataDir);
    const raw = await readFile(credentialPath, "utf8");
    expect(raw).toContain("google-antigravity");

    // Root cause: nothing provisioned the catalog row, so the explorer stayed empty.
    const providers = await port.listUserModelProviders();
    const row = providers.find((provider) => provider.providerId === "custom_provider:google-antigravity");
    expect(row).toBeDefined();
    expect(row?.enabled).not.toBe(false);
    expect(row?.models?.length ?? 0).toBeGreaterThan(0);
  });

  it("saveOAuth keeps login success when the seed row exists but refresh throws", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "rig-login-catalog-"));
    const rows: PortStubListRow[] = [
      {
        providerId: "custom_provider:google-antigravity",
        name: "Antigravity",
        kind: "oauth",
        enabled: true,
        models: [{ modelId: "google-antigravity" }],
      },
    ];
    const { port, calls } = createStub({
      listUserModelProviders: async () => [...rows],
    });
    port.syncOAuthProviderModels = vi.fn(async () => {
      throw new Error("discovery down");
    });
    const writer = createPortCredentialWriter(port, {
      prepareDataDir: async () => dataDir,
    });

    const result = await writer.saveOAuth("google-antigravity", {
      access: "tok",
      refresh: "ref",
      expires: NEVER_EXPIRES,
    });

    expect(result).toEqual({ refreshError: "discovery down" });
    expect(calls.created).toHaveLength(0);
    const { credentialPath } = resolveRigLoginOAuthPaths(dataDir);
    expect(await readFile(credentialPath, "utf8")).toContain("google-antigravity");
  });

  it("saveOAuth surfaces a refresh failure instead of failing login", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "rig-login-catalog-"));
    const { port } = createStub();
    port.syncOAuthProviderModels = vi.fn(async () => ({ refreshError: "boom" }));
    const writer = createPortCredentialWriter(port, {
      prepareDataDir: async () => dataDir,
    });

    const result = await writer.saveOAuth("google-antigravity", {
      access: "tok",
      refresh: "ref",
      expires: NEVER_EXPIRES,
    });

    expect(result).toEqual({ refreshError: "boom" });
    const { credentialPath } = resolveRigLoginOAuthPaths(dataDir);
    expect(await readFile(credentialPath, "utf8")).toContain("google-antigravity");
  });
});

describe("API-key login seeds discovered models", () => {
  it("saveApiKey creates the provider with discovered models, not models: []", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "rig-login-catalog-"));
    const { port, calls } = createStub({
      discoverUserModelsCandidate: async () => [{ modelId: "glm-5.2" }],
    });
    const writer = createPortCredentialWriter(port, {
      prepareDataDir: async () => dataDir,
    });

    await writer.saveApiKey("zai", "sk-x");

    expect(calls.created).toHaveLength(1);
    const created = calls.created[0] as { models: readonly { modelId: string }[] };
    expect(created.models.map((model) => model.modelId)).toContain("glm-5.2");
  });

  it("saveApiKey still creates the provider when discovery fails", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "rig-login-catalog-"));
    const { port, calls } = createStub({
      discoverUserModelsCandidate: async () => {
        throw new Error("no endpoint");
      },
    });
    const writer = createPortCredentialWriter(port, {
      prepareDataDir: async () => dataDir,
    });

    await writer.saveApiKey("zai", "sk-x");

    expect(calls.created).toHaveLength(1);
  });
});
