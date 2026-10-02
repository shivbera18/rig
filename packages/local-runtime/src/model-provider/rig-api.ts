import { RIG_API_MODEL_CATALOG, getRuntimeRegion } from '@rig/config';

import type { LocalModelConfig, LocalRuntimeConfig } from '../config/types.js';

export const RIG_API_FORMAT = 'anthropic-messages';
const MESSAGES_PATH = RIG_API_FORMAT.split('-')[0];
export const RIG_API_DEFAULT_BASE_URL =
  getRuntimeRegion() === 'cn'
    ? `https://api.rig.cn/${MESSAGES_PATH}`
    : `https://api.rig.io/${MESSAGES_PATH}`;
export const RIG_API_PROVIDER_NAME = 'Rig API';

export function rigApiBaseUrl(config: LocalRuntimeConfig): string {
  return config.rig_api?.baseURL?.trim() || RIG_API_DEFAULT_BASE_URL;
}

/** The API-key catalog is builtin; only user-owned context selections are overlaid. */
export function rigApiModels(config: LocalRuntimeConfig): Record<string, LocalModelConfig> {
  const catalog = RIG_API_MODEL_CATALOG as Record<string, LocalModelConfig>;
  const overrides = config.rig_api?.modelContextLimits;
  if (!overrides) return catalog;
  return Object.fromEntries(
    Object.entries(catalog).map(([modelId, model]) => {
      const context = overrides[modelId];
      return [
        modelId,
        context !== undefined && model.contextWindowOptions?.includes(context)
          ? { ...model, limit: { ...model.limit, context } }
          : model,
      ];
    }),
  );
}
