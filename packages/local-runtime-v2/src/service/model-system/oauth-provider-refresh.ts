/**
 * OAuth provider model refresh for non-Codex providers.
 *
 * Generalizes the `CodexOAuthManager` refresh lifecycle (single-flight per
 * provider, merge-preserving `updateByokConfig` draft write, failed refresh
 * leaves existing models untouched) to the login-time OAuth providers:
 * `google-antigravity` discovers via `fetchAvailableModels`,
 * `google-gemini-cli` falls back to quota discovery on `null`, and any other
 * provider with a base URL reuses the generic `GET <base>/models` client
 * with the OAuth access token as bearer.
 */

import {
  fetchAntigravityDiscoveryModels,
  ANTIGRAVITY_PRIMARY_ENDPOINT,
} from './connectivity/antigravity-discovery.js';
import {
  fetchGeminiCliQuotaModels,
  GEMINI_CLI_DEFAULT_ENDPOINT,
} from './connectivity/gemini-cli-quota-discovery.js';
import { ModelDiscoveryClient } from './connectivity/discover-models.js';
import type {
  LocalByokConfigDraft,
  LocalCustomProviderConfig,
  LocalCustomProvidersConfig,
  LocalModelConfig,
  LocalRuntimeConfig,
} from './contracts.js';

export const GOOGLE_ANTIGRAVITY_PROVIDER_ID = 'google-antigravity';
export const GOOGLE_GEMINI_CLI_PROVIDER_ID = 'google-gemini-cli';

export interface OAuthProviderRefreshDeps {
  configGetter: () => LocalRuntimeConfig;
  updateByokConfig: (
    mutate: (
      draft: LocalByokConfigDraft,
      currentConfig: LocalRuntimeConfig,
    ) => void | Promise<void>,
  ) => Promise<unknown>;
  fetchImpl?: typeof fetch;
}

export interface OAuthProviderSyncInput {
  readonly providerId: string;
  readonly access: string;
}

const pendingRefreshes = new Map<string, Promise<{ refreshError?: string }>>();

/**
 * Best-effort post-login model sync. Always resolves: `{}` on success,
 * `{ refreshError }` when discovery failed. Never throws for discovery
 * failures, so login success and discovery failure stay separate states.
 * Single-flight per provider: concurrent syncs share one discovery run.
 */
export function syncOAuthProviderModels(
  deps: OAuthProviderRefreshDeps,
  input: OAuthProviderSyncInput,
): Promise<{ refreshError?: string }> {
  const providerId = input.providerId.trim();
  if (!providerId) return Promise.resolve({ refreshError: 'Provider id is required.' });
  const pending = pendingRefreshes.get(providerId);
  if (pending) return pending;
  const operation = refreshOAuthProviderModels(deps, providerId, input.access).then(
    () => ({} as { refreshError?: string }),
    (error: unknown) => ({
      refreshError: error instanceof Error ? error.message : String(error),
    }),
  );
  pendingRefreshes.set(providerId, operation);
  void operation.finally(() => {
    if (pendingRefreshes.get(providerId) === operation) pendingRefreshes.delete(providerId);
  });
  return operation;
}

/** Explicit refresh entry point for provider settings; throws on failure. */
export async function refreshOAuthProviderModels(
  deps: OAuthProviderRefreshDeps,
  providerId: string,
  access: string,
): Promise<void> {
  const normalized = providerId.trim();
  const catalog = await discoverOAuthCatalog(deps, normalized, access);
  if (!catalog) {
    throw new Error(
      `Model discovery failed for '${normalized}'. Retry from /model.`,
    );
  }
  await deps.updateByokConfig((draft, currentConfig) => {
    const exists =
      currentConfig.custom_provider?.[normalized] ?? currentConfig.provider?.[normalized];
    if (!exists) return;
    configureOAuthProvider(draft, currentConfig, normalized, catalog);
  });
}

async function discoverOAuthCatalog(
  deps: OAuthProviderRefreshDeps,
  providerId: string,
  access: string,
): Promise<LocalCustomProviderConfig | null> {
  const fetchImpl = deps.fetchImpl;
  if (providerId === GOOGLE_ANTIGRAVITY_PROVIDER_ID) {
    const discovered = await fetchAntigravityDiscoveryModels({
      token: access,
      ...(fetchImpl ? { fetcher: fetchImpl } : {}),
    });
    return discovered ? toOAuthCatalog(providerId, discovered.models, discovered.endpoint) : null;
  }
  if (providerId === GOOGLE_GEMINI_CLI_PROVIDER_ID) {
    const discovered = await fetchAntigravityDiscoveryModels({
      token: access,
      ...(fetchImpl ? { fetcher: fetchImpl } : {}),
    });
    const resolved =
      discovered ??
      (await fetchGeminiCliQuotaModels({
        token: access,
        ...(fetchImpl ? { fetcher: fetchImpl } : {}),
      }));
    return resolved ? toOAuthCatalog(providerId, resolved.models, resolved.endpoint) : null;
  }
  return discoverGenericOAuthCatalog(fetchImpl, deps, providerId, access);
}

function toOAuthCatalog(
  providerId: string,
  models: Record<string, LocalModelConfig>,
  endpoint: string,
): LocalCustomProviderConfig {
  return {
    name: providerId,
    kind: 'oauth',
    enabled: true,
    options: { authMode: 'oauth', baseURL: endpoint },
    models,
  };
}

async function discoverGenericOAuthCatalog(
  fetchImpl: typeof fetch | undefined,
  deps: OAuthProviderRefreshDeps,
  providerId: string,
  access: string,
): Promise<LocalCustomProviderConfig | null> {
  const baseUrl =
    deps.configGetter().custom_provider?.[providerId]?.options?.baseURL?.trim() ||
    deps.configGetter().provider?.[providerId]?.options?.baseURL?.trim() ||
    fallbackDiscoveryBaseUrl(providerId);
  if (!baseUrl) return null;
  const client = new ModelDiscoveryClient(fetchImpl);
  const result = await client.discover({ api: 'openai-completions', baseUrl, apiKey: access });
  if (!result.ok) return null;
  const models: Record<string, LocalModelConfig> = {};
  for (const model of result.models) {
    models[model.modelId] = {
      name: model.displayName ?? model.modelId,
    };
  }
  return toOAuthCatalog(providerId, models, baseUrl);
}

function fallbackDiscoveryBaseUrl(providerId: string): string | undefined {
  if (providerId === GOOGLE_ANTIGRAVITY_PROVIDER_ID) return ANTIGRAVITY_PRIMARY_ENDPOINT;
  if (providerId === GOOGLE_GEMINI_CLI_PROVIDER_ID) return GEMINI_CLI_DEFAULT_ENDPOINT;
  return undefined;
}

function configureOAuthProvider(
  draft: LocalByokConfigDraft,
  currentConfig: LocalRuntimeConfig,
  providerId: string,
  catalog: LocalCustomProviderConfig,
): void {
  const tree = (draft.custom_provider ?? {}) as LocalCustomProvidersConfig;
  const current =
    currentConfig.custom_provider?.[providerId] ?? currentConfig.provider?.[providerId];
  if (!current) return;
  tree[providerId] = mergeOAuthProvider(current, catalog);
  draft.custom_provider = tree as Record<string, unknown>;
}

function mergeOAuthProvider(
  current: LocalCustomProviderConfig,
  catalog: LocalCustomProviderConfig,
): LocalCustomProviderConfig {
  const currentOptions = { ...(current.options ?? {}) };
  delete currentOptions.apiKey;
  return {
    ...current,
    api: current.api ?? catalog.api,
    name: current.name ?? catalog.name,
    kind: 'oauth',
    enabled: current.enabled ?? true,
    options: {
      ...currentOptions,
      baseURL: current.options?.baseURL ?? catalog.options?.baseURL,
      authMode: 'oauth',
    },
    models: mergeOAuthModels(current.models ?? {}, catalog.models ?? {}),
  };
}

function mergeOAuthModels(
  current: Record<string, LocalModelConfig>,
  discovered: Record<string, LocalModelConfig>,
): Record<string, LocalModelConfig> {
  // Stored fields are authoritative, including old catalog values whose edit history is unknown.
  const models = new Map(Object.entries(current));
  for (const [id, model] of Object.entries(discovered)) {
    const existing = models.get(id);
    models.set(id, {
      ...model,
      ...existing,
      ...(model.limit ?? existing?.limit ? { limit: { ...model.limit, ...existing?.limit } } : {}),
      ...(model.modalities ?? existing?.modalities
        ? { modalities: { ...model.modalities, ...existing?.modalities } }
        : {}),
      ...(model.thinking ?? existing?.thinking
        ? { thinking: { ...model.thinking, ...existing?.thinking } }
        : {}),
    });
  }
  return Object.fromEntries(models);
}
