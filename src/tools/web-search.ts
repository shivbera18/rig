// ponytail: single-file search (providers + registry + tool); split if a third provider lands.
export type Recency = "day" | "week" | "month" | "year";

export interface SearchParams {
  query: string;
  limit?: number;
  recency?: Recency;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  results: SearchResult[];
  providerId: string;
}

export interface SearchProvider {
  id: string;
  label: string;
  isAvailable(): boolean;
  search(params: SearchParams): Promise<SearchResponse>;
}

// Keys are env-only (TAVILY_API_KEY / BRAVE_API_KEY); auth-store-backed keys are a follow-up.
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

function normalize(params: SearchParams): Required<Pick<SearchParams, "limit" | "timeoutMs">> & SearchParams {
  return {
    ...params,
    limit: Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT),
    timeoutMs: Math.min(params.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
  };
}

function combinedSignal(params: SearchParams, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return params.signal ? AbortSignal.any([params.signal, timeout]) : timeout;
}

async function throwIfBad(res: Response, providerId: string): Promise<void> {
  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 500);
    throw new Error(`search provider ${providerId} HTTP ${res.status}: ${snippet}`);
  }
}

const RECENCY_TAVILY: Record<Recency, string> = { day: "day", week: "week", month: "month", year: "year" };
const RECENCY_BRAVE: Record<Recency, string> = { day: "pd", week: "pw", month: "pm", year: "py" };

const tavilyProvider: SearchProvider = {
  id: "tavily",
  label: "Tavily",
  isAvailable(): boolean {
    return Boolean(process.env.TAVILY_API_KEY);
  },
  async search(params: SearchParams): Promise<SearchResponse> {
    const p = normalize(params);
    const body: Record<string, unknown> = {
      api_key: process.env.TAVILY_API_KEY,
      query: p.query,
      max_results: p.limit,
    };
    if (p.recency) body.time_range = RECENCY_TAVILY[p.recency];
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: combinedSignal(params, p.timeoutMs),
    });
    await throwIfBad(res, "tavily");
    const doc = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
    return {
      providerId: "tavily",
      results: (doc.results ?? []).slice(0, p.limit).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.content ?? "",
      })),
    };
  },
};

const braveProvider: SearchProvider = {
  id: "brave",
  label: "Brave Search",
  isAvailable(): boolean {
    return Boolean(process.env.BRAVE_API_KEY);
  },
  async search(params: SearchParams): Promise<SearchResponse> {
    const p = normalize(params);
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", p.query);
    url.searchParams.set("count", String(p.limit));
    if (p.recency) url.searchParams.set("freshness", RECENCY_BRAVE[p.recency]);
    const res = await fetch(url, {
      headers: { "X-Subscription-Token": process.env.BRAVE_API_KEY ?? "", Accept: "application/json" },
      signal: combinedSignal(params, p.timeoutMs),
    });
    await throwIfBad(res, "brave");
    const doc = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
    return {
      providerId: "brave",
      results: (doc.web?.results ?? []).slice(0, p.limit).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.description ?? "",
      })),
    };
  },
};

const REGISTRY: Record<string, SearchProvider> = {
  tavily: tavilyProvider,
  brave: braveProvider,
};

export function getSearchProvider(id: string): SearchProvider {
  const provider = REGISTRY[id];
  if (!provider) throw new Error(`unknown search provider: ${id}`);
  return provider;
}

// Sequential fallback, not fan-out: one paid search call at a time, and the
// first success wins deterministically. (Fan-out would double cost/latency
// variance for no quality gain on a single ranked list.)
export async function executeSearchWith(
  providers: SearchProvider[],
  params: SearchParams,
): Promise<SearchResponse> {
  if (!params.query) throw new Error("search query is required");
  let lastError: unknown;
  for (const provider of providers) {
    try {
      return await provider.search(params);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("no search providers available");
}

export function executeSearch(params: SearchParams): Promise<SearchResponse> {
  const order = [getSearchProvider("tavily"), getSearchProvider("brave")].filter((p) => {
    try {
      return p.isAvailable();
    } catch {
      return false;
    }
  });
  if (order.length === 0) throw new Error("no search providers available (set TAVILY_API_KEY or BRAVE_API_KEY)");
  return executeSearchWith(order, params);
}

// Caps per-request concurrency only, never agent lifetime: awaiting the pool
// must not hold a worker slot another task in the pool waits on (cf. #3749).
export async function mapWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface WebSearchToolArgs {
  query: string;
  limit?: number;
  recency?: Recency;
}

export const webSearchTool = {
  name: "web_search",
  description: "Search the web and return ranked results with URLs. Falls back across providers.",
  schema: {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string" },
      limit: { type: "number" },
      recency: { type: "string", enum: ["day", "week", "month", "year"] },
    },
  },
  async execute(args: WebSearchToolArgs): Promise<string> {
    const res = await executeSearch({
      query: args.query,
      ...(args.limit === undefined ? {} : { limit: args.limit }),
      ...(args.recency === undefined ? {} : { recency: args.recency }),
    });
    return res.results.map((r) => `${r.title} — ${r.url}\n${r.snippet}`).join("\n\n");
  },
};
