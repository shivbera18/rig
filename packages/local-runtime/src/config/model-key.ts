// Source-aware model key parsing for BYOK provider sources.
//
// Model keys keep the legacy `providerId/modelId` shape; the providerId part
// encodes which config tree the provider lives in:
//
//   'rig/Rig-M3'                    -> config.provider (builtin tree)
//   'rig_api/Rig-M3'               -> config.rig_api (user Rig API key)
//   custom_provider?:openai-work/gpt-4.1' -> config.custom_provider['openai-work']
//
// 'rig_api' is a reserved provider id: it always resolves to the BYOK
// source and never falls back to the legacy provider map (config-side
// enforcement drops a hand-written `provider.rig_api` entry at read time).

export const RIG_API_PROVIDER_ID = 'rig_api';
export const CUSTOM_PROVIDER_ID_PREFIX = 'custom_provider:';

export type ModelProviderSource = 'provider' | 'rig_api' | 'custom-provider';

export interface ParsedProviderId {
  source: ModelProviderSource;
  /** Full provider id as used in model keys (e.g. custom_provider?:openai-work'). */
  providerId: string;
  /** Key into the source config tree (e.g. 'openai-work', 'rig', 'rig_api'). */
  providerKey: string;
}

export interface ParsedModelKey extends ParsedProviderId {
  modelId: string;
}

export function parseProviderId(
  providerId: string | undefined | null,
): ParsedProviderId | undefined {
  if (typeof providerId !== 'string' || providerId.length === 0) return undefined;
  if (providerId === RIG_API_PROVIDER_ID) {
    return { source: 'rig_api', providerId, providerKey: RIG_API_PROVIDER_ID };
  }
  if (providerId.startsWith(CUSTOM_PROVIDER_ID_PREFIX)) {
    const providerKey = providerId.slice(CUSTOM_PROVIDER_ID_PREFIX.length);
    if (!providerKey) return undefined;
    return { source: 'custom-provider', providerId, providerKey };
  }
  return { source: 'provider', providerId, providerKey: providerId };
}

export function parseSourceQualifiedModelKey(
  raw: string | undefined | null,
): ParsedModelKey | undefined {
  if (typeof raw !== 'string') return undefined;
  const slash = raw.indexOf('/');
  if (slash <= 0 || slash === raw.length - 1) return undefined;
  const parsedProvider = parseProviderId(raw.slice(0, slash));
  if (!parsedProvider) return undefined;
  return { ...parsedProvider, modelId: raw.slice(slash + 1) };
}

export function formatModelKey(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}
