/**
 * Gemini CLI quota discovery (`POST {endpoint}/v1internal:retrieveUserQuota`).
 *
 * Port of `oh-my-pi/packages/catalog/src/discovery/gemini-cli.ts` minus the
 * bundled-catalog enrichment (rig has no bundled Gemini catalog) and variant
 * collapsing: unknown ids synthesize `{ context 1_048_576, output 65_536 }`
 * with reasoning for revision >= 2.5. Same `null` (failed) vs `[]` contract.
 */

import type { LocalModelConfig } from '../contracts.js';
import { getGeminiCliHeaders } from './gemini-headers.js';

export const GEMINI_CLI_DEFAULT_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
const LOAD_CODE_ASSIST_PATH = '/v1internal:loadCodeAssist';
const RETRIEVE_USER_QUOTA_PATH = '/v1internal:retrieveUserQuota';

// Quota buckets carry ids only; every current Gemini CLI model ships a 1M
// context and 65,536-token output ceiling.
const DEFAULT_CONTEXT_WINDOW = 1_048_576;
const DEFAULT_MAX_TOKENS = 65_536;
const REASONING_MIN_MAJOR = 2;
const REASONING_MIN_MINOR = 5;

export interface GeminiCliQuotaDiscoveryOptions {
  readonly token: string;
  readonly endpoint?: string;
  readonly projectId?: string;
  readonly signal?: AbortSignal;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface GeminiCliQuotaDiscoveryResult {
  readonly models: Record<string, LocalModelConfig>;
  readonly endpoint: string;
}

export async function fetchGeminiCliQuotaModels(
  options: GeminiCliQuotaDiscoveryOptions,
): Promise<GeminiCliQuotaDiscoveryResult | null> {
  const token = options.token.trim();
  if (!token) return null;
  const fetcher = options.fetcher ?? globalThis.fetch;
  const endpoint = (options.endpoint?.trim() || GEMINI_CLI_DEFAULT_ENDPOINT).replace(
    /\/+$/,
    '',
  );
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...getGeminiCliHeaders(),
  };
  const projectId = options.projectId ?? (await loadProjectId(fetcher, endpoint, headers, options));
  const models = await fetchQuotaModels(fetcher, endpoint, headers, projectId, options);
  return models ? { models, endpoint } : null;
}

async function fetchQuotaModels(
  fetcher: typeof fetch,
  endpoint: string,
  headers: Record<string, string>,
  projectId: string | undefined,
  options: GeminiCliQuotaDiscoveryOptions,
): Promise<Record<string, LocalModelConfig> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const response = await fetcher(`${endpoint}${RETRIEVE_USER_QUOTA_PATH}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(projectId ? { project: projectId } : {}),
      signal: options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal,
    });
    if (!response.ok) return null;
    return normalizeQuota(await readJson(response));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function loadProjectId(
  fetcher: typeof fetch,
  endpoint: string,
  headers: Record<string, string>,
  options: GeminiCliQuotaDiscoveryOptions,
): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const response = await fetcher(`${endpoint}${LOAD_CODE_ASSIST_PATH}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' },
      }),
      signal: options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal,
    });
    if (!response.ok) return undefined;
    const payload = await readJson(response);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
    if (!('cloudaicompanionProject' in payload)) return undefined;
    const project = payload.cloudaicompanionProject;
    if (typeof project === 'string' && project.trim()) return project.trim();
    if (
      project &&
      typeof project === 'object' &&
      !Array.isArray(project) &&
      'id' in project &&
      typeof project.id === 'string' &&
      project.id.trim()
    ) {
      return project.id.trim();
    }
    return undefined;
  } catch {
    return undefined;
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

function normalizeQuota(payload: unknown): Record<string, LocalModelConfig> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (!('buckets' in payload) || !Array.isArray(payload.buckets)) return null;
  const models: Record<string, LocalModelConfig> = {};
  for (const bucket of payload.buckets) {
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
    if (!('modelId' in bucket) || typeof bucket.modelId !== 'string') continue;
    const modelId = bucket.modelId.trim();
    if (!modelId || models[modelId] || !isGeminiModelId(modelId)) continue;
    models[modelId] = {
      name: modelId,
      reasoning: supportsReasoning(modelId),
      attachment: true,
      tool_call: true,
      modalities: { input: ['text', 'image'], output: ['text'] },
      limit: { context: DEFAULT_CONTEXT_WINDOW, output: DEFAULT_MAX_TOKENS },
    };
  }
  return models;
}

function isGeminiModelId(modelId: string): boolean {
  return modelId.toLowerCase().includes('gemini');
}

function supportsReasoning(modelId: string): boolean {
  const match = /(\d+)\.(\d+)/.exec(modelId);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return (
    major > REASONING_MIN_MAJOR ||
    (major === REASONING_MIN_MAJOR && minor >= REASONING_MIN_MINOR)
  );
}
