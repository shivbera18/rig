/**
 * Antigravity model discovery (`POST {endpoint}/v1internal:fetchAvailableModels`).
 *
 * Port of `oh-my-pi/packages/catalog/src/discovery/antigravity.ts` minus the
 * `ModelSpec` normalization and variant collapsing: results land directly in
 * `LocalModelConfig` records so the OAuth refresh path can merge them with
 * the Codex union semantics. Same `null` (failed) vs `{}` (empty) contract.
 */

import type { LocalModelConfig } from '../contracts.js';
import { getAntigravityUserAgent } from './gemini-headers.js';

export const ANTIGRAVITY_PRIMARY_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com';
export const ANTIGRAVITY_SANDBOX_ENDPOINT =
  'https://daily-cloudcode-pa.sandbox.googleapis.com';
const FETCH_AVAILABLE_MODELS_PATH = '/v1internal:fetchAvailableModels';

const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_TOKENS = 64_000;
export const ANTIGRAVITY_DISCOVERY_DENYLIST: Record<string, true> = {
  chat_20706: true,
  chat_23310: true,
  'gemini-2.5-pro': true,
};

export interface AntigravityDiscoveryOptions {
  readonly token: string;
  readonly endpoint?: string;
  readonly userAgent?: string;
  readonly signal?: AbortSignal;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface AntigravityDiscoveryResult {
  readonly models: Record<string, LocalModelConfig>;
  readonly endpoint: string;
}

interface AntigravityApiModel {
  displayName?: string;
  supportsImages?: boolean;
  supportsThinking?: boolean;
  maxTokens?: number;
  maxOutputTokens?: number;
  isInternal?: boolean;
}

export async function fetchAntigravityDiscoveryModels(
  options: AntigravityDiscoveryOptions,
): Promise<AntigravityDiscoveryResult | null> {
  const token = options.token.trim();
  if (!token) return null;
  const fetcher = options.fetcher ?? globalThis.fetch;
  const endpoints = options.endpoint
    ? [trimTrailingSlashes(options.endpoint)]
    : [ANTIGRAVITY_PRIMARY_ENDPOINT, ANTIGRAVITY_SANDBOX_ENDPOINT];
  for (const endpoint of endpoints) {
    const result = await fetchFromEndpoint(fetcher, endpoint, token, options);
    if (result) return result;
  }
  return null;
}

async function fetchFromEndpoint(
  fetcher: typeof fetch,
  endpoint: string,
  token: string,
  options: AntigravityDiscoveryOptions,
): Promise<AntigravityDiscoveryResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const response = await fetcher(`${endpoint}${FETCH_AVAILABLE_MODELS_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': options.userAgent ?? getAntigravityUserAgent(),
      },
      body: JSON.stringify({}),
      signal: options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal,
    });
    if (!response.ok) return null;
    const models = normalizeModels(await readJson(response));
    return models ? { models, endpoint } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function normalizeModels(payload: unknown): Record<string, LocalModelConfig> | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  if (!('models' in payload)) return undefined;
  const record = payload.models;
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined;
  const models: Record<string, LocalModelConfig> = {};
  for (const [modelId, value] of Object.entries(record)) {
    if (!modelId.trim() || ANTIGRAVITY_DISCOVERY_DENYLIST[modelId] === true) continue;
    const model = readApiModel(value);
    if (!model || model.isInternal === true) continue;
    const image = model.supportsImages === true;
    models[modelId] = {
      name: model.displayName?.trim() || modelId,
      reasoning: model.supportsThinking === true,
      attachment: image,
      tool_call: true,
      modalities: { input: image ? ['text', 'image'] : ['text'], output: ['text'] },
      limit: {
        context: toPositiveNumber(model.maxTokens, DEFAULT_CONTEXT_WINDOW),
        output: toPositiveNumber(model.maxOutputTokens, DEFAULT_MAX_TOKENS),
      },
    };
  }
  return models;
}

function readApiModel(value: unknown): AntigravityApiModel | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const displayName = 'displayName' in value ? value.displayName : undefined;
  const supportsImages = 'supportsImages' in value ? value.supportsImages : undefined;
  const supportsThinking = 'supportsThinking' in value ? value.supportsThinking : undefined;
  const maxTokens = 'maxTokens' in value ? value.maxTokens : undefined;
  const maxOutputTokens = 'maxOutputTokens' in value ? value.maxOutputTokens : undefined;
  const isInternal = 'isInternal' in value ? value.isInternal : undefined;
  return {
    ...(typeof displayName === 'string' ? { displayName } : {}),
    ...(typeof supportsImages === 'boolean' ? { supportsImages } : {}),
    ...(typeof supportsThinking === 'boolean' ? { supportsThinking } : {}),
    ...(typeof maxTokens === 'number' ? { maxTokens } : {}),
    ...(typeof maxOutputTokens === 'number' ? { maxOutputTokens } : {}),
    ...(typeof isInternal === 'boolean' ? { isInternal } : {}),
  };
}

function toPositiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}
