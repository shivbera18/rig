export const MAX_OUTPUT_BYTES = 500_000;
export const MAX_OUTPUT_LINES = 5000;

export class SchemaMismatchError extends Error {}

export function truncateOutput(text: string): string {
  const lines = text.split("\n");
  const kept = lines.length > MAX_OUTPUT_LINES ? lines.slice(0, MAX_OUTPUT_LINES).join("\n") : text;
  return kept.length > MAX_OUTPUT_BYTES
    ? kept.slice(0, MAX_OUTPUT_BYTES) + `\n…[truncated at ${MAX_OUTPUT_BYTES} bytes]`
    : kept;
}

export type TaskHandler = (text: string, index: number) => Promise<string>;

export interface Workpool {
  setHandler(h: TaskHandler): void;
  push(texts: string[]): Promise<string>[];
  pushStructured<T>(schema: Record<string, unknown>, texts: string[]): Promise<T>[];
  close(): Promise<void>;
}

export function createWorkpool({ maxConcurrency = 4 }: { maxConcurrency?: number } = {}): Workpool {
  const cap = Math.max(1, maxConcurrency);
  let handler: TaskHandler = async (text) => text;
  let live = 0;
  const waiting: Array<() => void> = [];
  let closed = false;

  function acquire(): Promise<void> {
    if (live < cap) {
      live++;
      return Promise.resolve();
    }
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = () => {
        live++;
        resolve();
      };
    });
    waiting.push(release);
    return promise;
  }

  function release(): void {
    live--;
    const next = waiting.shift();
    if (next) next();
  }

  async function runOne(text: string, index: number): Promise<string> {
    await acquire();
    if (closed) {
      release();
      throw new Error("workpool is closed");
    }
    try {
      return truncateOutput(await handler(text, index));
    } finally {
      release();
    }
  }

  return {
    setHandler(h: TaskHandler): void {
      handler = h;
    },
    push(texts: string[]): Promise<string>[] {
      return texts.map((t, i) => runOne(t, i));
    },
    pushStructured<T>(schema: Record<string, unknown>, texts: string[]): Promise<T>[] {
      const required =
        schema.required && Array.isArray(schema.required) ? (schema.required as string[]) : [];
      return texts.map((t, i) =>
        runOne(t, i).then((out) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(out);
          } catch {
            throw new SchemaMismatchError(`worker ${i} output is not valid JSON`);
          }
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new SchemaMismatchError(`worker ${i} output must be a JSON object`);
          }
          for (const key of required) {
            if (!(key in (parsed as Record<string, unknown>))) {
              throw new SchemaMismatchError(`worker ${i} output missing required key "${key}"`);
            }
          }
          return parsed as T;
        }),
      );
    },
    async close(): Promise<void> {
      closed = true;
      while (live > 0) await new Promise((r) => setTimeout(r, 10));
      waiting.length = 0;
    },
  };
}
