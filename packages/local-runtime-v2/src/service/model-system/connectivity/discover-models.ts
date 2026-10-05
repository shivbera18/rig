import { buildModelDiscoveryHeaders, providerModelsUrls } from './provider-request.js';
import type {
  DiscoveredModel,
  ModelDiscoveryClientLike,
  ModelDiscoveryResult,
  ModelDiscoveryTarget,
} from '../contracts.js';

export type {
  DiscoveredModel,
  ModelDiscoveryClientLike,
  ModelDiscoveryResult,
  ModelDiscoveryTarget,
} from '../contracts.js';

// If all candidates are missing, report only that the provider has no model-list endpoint; status codes do not help users decide.
// Product copy therefore suggests adding models manually.
const MISSING_MODELS_ENDPOINT: ModelDiscoveryResult = {
  ok: false,
  errorCode: 'models_endpoint_missing',
  errorMessage: 'Model list endpoint not found',
};

export class ModelDiscoveryClient implements ModelDiscoveryClientLike {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  // A native endpoint's 404/405 means the gateway lacks that list endpoint; continue with OpenAI-style candidates.
  // Return authentication, rate-limit, and server errors immediately so real failures are not disguised as missing endpoints.
  async discover(target: ModelDiscoveryTarget): Promise<ModelDiscoveryResult> {
    const [primaryUrl, ...fallbackUrls] = providerModelsUrls(target.api, target.baseUrl);
    const primary = await this.discoverAt(primaryUrl, target);
    if (primary.ok || !isMissingModelsEndpoint(primary)) return primary;
    for (const url of fallbackUrls) {
      const result = await this.discoverAt(url, target);
      if (result.ok || !isMissingModelsEndpoint(result)) return result;
    }
    return MISSING_MODELS_ENDPOINT;
  }

  private async discoverAt(
    url: string,
    target: ModelDiscoveryTarget,
  ): Promise<ModelDiscoveryResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: buildModelDiscoveryHeaders(target),
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          errorCode: 'unauthorized',
          errorMessage: `Authentication failed (HTTP ${response.status})`,
        };
      }
      if (!response.ok) {
        return {
          ok: false,
          errorCode: `http_${response.status}`,
          errorMessage: `HTTP ${response.status}`,
        };
      }
      const payload = await readJson(response);
      const models = readModels(payload);
      if (!models) {
        return {
          ok: false,
          errorCode: 'invalid_response',
          errorMessage: 'Invalid model discovery response',
        };
      }
      return { ok: true, models };
    } catch (error) {
      if (isAbortError(error)) {
        return {
          ok: false,
          errorCode: 'timeout',
          errorMessage: `Request timed out after ${this.timeoutMs}ms`,
        };
      }
      return { ok: false, errorCode: 'network', errorMessage: 'Network error' };
    } finally {
      clearTimeout(timer);
    }
  }
}

function isMissingModelsEndpoint(result: ModelDiscoveryResult): boolean {
  return !result.ok && (result.errorCode === 'http_404' || result.errorCode === 'http_405');
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
    return undefined;
  }
}

function readModels(payload: unknown): DiscoveredModel[] | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of ['data', 'models', 'result', 'items'] as const) {
    const list: unknown = record[key];
    if (Array.isArray(list)) return normalizeModelItems(list);
  }
  return undefined;
}

function normalizeModelItems(items: unknown[]): DiscoveredModel[] {
  return items.flatMap((item): DiscoveredModel[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    if (!('id' in item)) return [];
    const id: unknown = item.id;
    if (typeof id !== 'string' || !id.trim()) return [];
    const displayName = readDisplayName(item);
    return [
      {
        modelId: id,
        ...(displayName ? { displayName } : {}),
      },
    ];
  });
}

function readDisplayName(record: object): string | undefined {
  const displayName: unknown = 'display_name' in record ? record.display_name : undefined;
  if (typeof displayName === 'string') return displayName;
  const name: unknown = 'name' in record ? record.name : undefined;
  return typeof name === 'string' ? name : undefined;
}

function isAbortError(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'name' in error && error.name === 'AbortError',
  );
}
