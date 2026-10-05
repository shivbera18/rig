import { describe, expect, it, vi } from 'vitest';

import type { LocalByokConfigDraft, LocalRuntimeConfig } from './contracts.js';
import {
  GOOGLE_ANTIGRAVITY_PROVIDER_ID,
  GOOGLE_GEMINI_CLI_PROVIDER_ID,
  refreshOAuthProviderModels,
  syncOAuthProviderModels,
} from './oauth-provider-refresh.js';

function createConfig(): LocalRuntimeConfig {
  return { dataDir: '/tmp/oauth-refresh-test', provider: {} };
}

function createUpdater(target: LocalRuntimeConfig) {
  return vi.fn(
    async (
      mutate: (
        draft: LocalByokConfigDraft,
        currentConfig: LocalRuntimeConfig,
      ) => void | Promise<void>,
    ) => {
      const draft: LocalByokConfigDraft = {
        custom_provider: target.custom_provider
          ? structuredClone(target.custom_provider)
          : undefined,
        defaultModel: target.defaultModel,
      };
      await mutate(draft, target);
      target.custom_provider = draft.custom_provider as LocalRuntimeConfig['custom_provider'];
      target.defaultModel = draft.defaultModel;
      return { config: target };
    },
  );
}

function antigravityResponse(models: Record<string, object>) {
  return async (url: unknown) => {
    if (String(url).includes('fetchAvailableModels')) {
      return new Response(JSON.stringify({ models }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  };
}

describe('refreshOAuthProviderModels', () => {
  it('discovers Antigravity models and merges without clobbering user edits', async () => {
    const config = createConfig();
    config.custom_provider = {
      [GOOGLE_ANTIGRAVITY_PROVIDER_ID]: {
        name: 'Antigravity',
        enabled: false,
        options: { authMode: 'oauth', baseURL: 'https://custom.example/v1' },
        models: { 'gemini-3-pro': { name: 'Mine', limit: { context: 1 } } },
      },
    };
    const deps = {
      configGetter: () => config,
      updateByokConfig: createUpdater(config),
      fetchImpl: antigravityResponse({
        'gemini-3-pro': { displayName: 'Gemini 3 Pro', maxTokens: 500_000 },
        'gemini-3-flash': { displayName: 'Flash' },
      }) as unknown as typeof fetch,
    };

    await refreshOAuthProviderModels(deps, GOOGLE_ANTIGRAVITY_PROVIDER_ID, 'tok');

    const provider = config.custom_provider?.[GOOGLE_ANTIGRAVITY_PROVIDER_ID];
    expect(provider?.enabled).toBe(false);
    expect(provider?.options?.baseURL).toBe('https://custom.example/v1');
    expect(provider?.options).not.toHaveProperty('apiKey');
    expect(provider?.models?.['gemini-3-pro']).toMatchObject({
      name: 'Mine',
      limit: { context: 1, output: 64_000 },
    });
    expect(provider?.models?.['gemini-3-flash']?.name).toBe('Flash');
  });

  it('falls back to quota discovery for Gemini CLI on fetchAvailableModels failure', async () => {
    const config = createConfig();
    config.custom_provider = {
      [GOOGLE_GEMINI_CLI_PROVIDER_ID]: {
        name: 'Gemini CLI',
        options: { authMode: 'oauth', baseURL: 'https://custom.example/v1' },
        models: {},
      },
    };
    const fetchImpl = (async (url: unknown) => {
      const target = String(url);
      if (target.includes('loadCodeAssist')) return new Response(JSON.stringify({}), { status: 200 });
      if (target.includes('retrieveUserQuota')) {
        return new Response(JSON.stringify({ buckets: [{ modelId: 'gemini-2.5-pro' }] }), {
          status: 200,
        });
      }
      return new Response(null, { status: 403 });
    }) as unknown as typeof fetch;
    const deps = { configGetter: () => config, updateByokConfig: createUpdater(config), fetchImpl };

    await refreshOAuthProviderModels(deps, GOOGLE_GEMINI_CLI_PROVIDER_ID, 'tok');

    expect(config.custom_provider?.[GOOGLE_GEMINI_CLI_PROVIDER_ID]?.models?.['gemini-2.5-pro']).toBeDefined();
  });

  it('leaves existing models untouched when discovery fails', async () => {
    const config = createConfig();
    config.custom_provider = {
      [GOOGLE_ANTIGRAVITY_PROVIDER_ID]: {
        name: 'Antigravity',
        options: { authMode: 'oauth', baseURL: 'https://custom.example/v1' },
        models: { keep: { name: 'Keep' } },
      },
    };
    const before = structuredClone(config.custom_provider);
    const deps = {
      configGetter: () => config,
      updateByokConfig: createUpdater(config),
      fetchImpl: (async () => new Response(null, { status: 403 })) as unknown as typeof fetch,
    };

    await expect(
      refreshOAuthProviderModels(deps, GOOGLE_ANTIGRAVITY_PROVIDER_ID, 'tok'),
    ).rejects.toThrow(/Model discovery failed/);
    expect(config.custom_provider).toEqual(before);
  });

  it('syncOAuthProviderModels never throws and single-flights concurrent syncs', async () => {
    const config = createConfig();
    config.custom_provider = {
      [GOOGLE_ANTIGRAVITY_PROVIDER_ID]: {
        name: 'Antigravity',
        options: { authMode: 'oauth', baseURL: 'https://custom.example/v1' },
        models: {},
      },
    };
    const fetchImpl = vi.fn(antigravityResponse({ a: {} }) as unknown as typeof fetch);
    const deps = { configGetter: () => config, updateByokConfig: createUpdater(config), fetchImpl };

    const [first, second] = await Promise.all([
      syncOAuthProviderModels(deps, { providerId: GOOGLE_ANTIGRAVITY_PROVIDER_ID, access: 'tok' }),
      syncOAuthProviderModels(deps, { providerId: GOOGLE_ANTIGRAVITY_PROVIDER_ID, access: 'tok' }),
    ]);
    expect(first).toEqual({});
    expect(second).toEqual({});
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('fetchAvailableModels'))).toHaveLength(1);

    const failing = await syncOAuthProviderModels(
      {
        configGetter: () => config,
        updateByokConfig: createUpdater(config),
        fetchImpl: (async () => new Response(null, { status: 500 })) as unknown as typeof fetch,
      },
      { providerId: GOOGLE_ANTIGRAVITY_PROVIDER_ID, access: 'tok' },
    );
    expect(failing.refreshError).toMatch(/Model discovery failed/);
  });

  it('discovers generic OAuth providers via GET <base>/models with the access token', async () => {
    const config = createConfig();
    config.custom_provider = {
      anthropic: {
        name: 'Anthropic',
        options: { authMode: 'oauth', baseURL: 'https://api.anthropic.example/v1' },
        models: {},
      },
    };
    const seen: Array<[unknown, unknown?]> = [];
    const fetchImpl = (async (url: unknown, init?: { headers?: Headers }) => {
      seen.push([url, init?.headers]);
      return new Response(JSON.stringify({ data: [{ id: 'claude-pro', name: 'Claude Pro' }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const deps = { configGetter: () => config, updateByokConfig: createUpdater(config), fetchImpl };

    await refreshOAuthProviderModels(deps, 'anthropic', 'tok');

    expect(String(seen[0]?.[0])).toContain('/models');
    expect(config.custom_provider?.anthropic?.models?.['claude-pro']?.name).toBe('Claude Pro');
  });
});
