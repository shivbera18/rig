import { describe, expect, it, vi } from 'vitest';

import {
  ANTIGRAVITY_DISCOVERY_DENYLIST,
  fetchAntigravityDiscoveryModels,
} from './antigravity-discovery.js';
import { fetchGeminiCliQuotaModels } from './gemini-cli-quota-discovery.js';
import { getAntigravityUserAgent, getGeminiCliHeaders } from './gemini-headers.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

describe('antigravity discovery', () => {
  it('normalizes models with defaults and skips denylisted/internal ids', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        models: {
          'gemini-3-pro': {
            displayName: 'Gemini 3 Pro',
            maxTokens: 500_000,
            maxOutputTokens: 100_000,
            supportsThinking: true,
            supportsImages: true,
          },
          'bare-model': {},
          chat_20706: { displayName: 'Denied' },
          'internal-model': { displayName: 'Internal', isInternal: true },
        },
      }),
    );
    const result = await fetchAntigravityDiscoveryModels({
      token: 'tok',
      fetcher: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/v1internal:fetchAvailableModels');
    expect(result?.models['gemini-3-pro']).toMatchObject({
      name: 'Gemini 3 Pro',
      reasoning: true,
      limit: { context: 500_000, output: 100_000 },
    });
    expect(result?.models['bare-model']).toMatchObject({
      limit: { context: 200_000, output: 64_000 },
    });
    for (const denied of Object.keys(ANTIGRAVITY_DISCOVERY_DENYLIST)) {
      expect(result?.models[denied]).toBeUndefined();
    }
    expect(result?.models['internal-model']).toBeUndefined();
  });

  it('tries the sandbox endpoint after the primary fails', async () => {
    const fetchImpl = vi.fn(async (url: unknown) =>
      String(url).includes('sandbox') ? jsonResponse({ models: {} }) : new Response(null, { status: 403 }),
    );
    const result = await fetchAntigravityDiscoveryModels({
      token: 'tok',
      fetcher: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ models: {}, endpoint: expect.stringContaining('sandbox') });
  });

  it('returns null on network/auth/payload failure, never empty-on-error', async () => {
    const failing = vi.fn(async () => {
      throw new Error('down');
    });
    await expect(
      fetchAntigravityDiscoveryModels({ token: 'tok', fetcher: failing as unknown as typeof fetch }),
    ).resolves.toBeNull();
    const forbidden = vi.fn(async () => new Response(null, { status: 403 }));
    await expect(
      fetchAntigravityDiscoveryModels({
        token: 'tok',
        fetcher: forbidden as unknown as typeof fetch,
      }),
    ).resolves.toBeNull();
    const garbage = vi.fn(async () => jsonResponse({ nope: true }));
    await expect(
      fetchAntigravityDiscoveryModels({ token: 'tok', fetcher: garbage as unknown as typeof fetch }),
    ).resolves.toBeNull();
    await expect(fetchAntigravityDiscoveryModels({ token: '  ' })).resolves.toBeNull();
  });
});

describe('gemini-cli quota discovery', () => {
  it('lists quota buckets with synthesized limits and reasoning floor', async () => {
    const fetchImpl = vi.fn(async (url: unknown) => {
      if (String(url).includes('loadCodeAssist')) return jsonResponse({ cloudaicompanionProject: 'p-1' });
      return jsonResponse({ buckets: [{ modelId: 'gemini-2.5-pro' }, { modelId: 'gemini-2.0-flash' }] });
    });
    const result = await fetchGeminiCliQuotaModels({
      token: 'tok',
      fetcher: fetchImpl as unknown as typeof fetch,
    });

    expect(result?.models['gemini-2.5-pro']).toMatchObject({
      reasoning: true,
      limit: { context: 1_048_576, output: 65_536 },
    });
    expect(result?.models['gemini-2.0-flash']).toMatchObject({ reasoning: false });
  });

  it('resolves object-shaped project ids and skips non-gemini buckets', async () => {
    const fetchImpl = vi.fn(async (url: unknown) => {
      if (String(url).includes('loadCodeAssist')) return jsonResponse({ cloudaicompanionProject: { id: 'p-2' } });
      return jsonResponse({ buckets: [{ modelId: 'claude-opus' }, { modelId: 'gemini-1.5-pro' }] });
    });
    const result = await fetchGeminiCliQuotaModels({
      token: 'tok',
      fetcher: fetchImpl as unknown as typeof fetch,
    });

    expect(Object.keys(result?.models ?? {})).toEqual(['gemini-1.5-pro']);
  });

  it('returns null when quota is unreachable', async () => {
    const fetchImpl = vi.fn(async (url: unknown) =>
      String(url).includes('loadCodeAssist')
        ? jsonResponse({})
        : new Response(null, { status: 403 }),
    );
    await expect(
      fetchGeminiCliQuotaModels({ token: 'tok', fetcher: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBeNull();
  });
});

describe('gemini headers', () => {
  it('advertises pinned Antigravity and Gemini CLI clients', () => {
    expect(getAntigravityUserAgent()).toContain('antigravity/hub/2.8.0');
    expect(getGeminiCliHeaders()['User-Agent']).toContain('GeminiCLI/');
  });
});
