export type RetryOptions = {
  /** Nombre total d'essais (défaut 3). */
  tries?: number;
  baseMs?: number;
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  shouldRetry?: (error: unknown) => boolean;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function field(error: unknown, name: string): unknown {
  return typeof error === "object" && error !== null && name in error
    ? (error as Record<string, unknown>)[name]
    : undefined;
}

export function httpStatus(error: unknown): number | undefined {
  for (const name of ["status", "statusCode", "code"]) {
    const value = field(error, name);
    if (typeof value === "number") return value;
  }
  return undefined;
}

/** Délai demandé par le serveur (en-tête Retry-After, en secondes ou date HTTP). */
export function retryAfterMs(error: unknown, now = Date.now()): number | undefined {
  const headers = field(error, "headers") ?? field(field(error, "response"), "headers");
  let raw: unknown;
  if (headers instanceof Headers) raw = headers.get("retry-after");
  else if (typeof headers === "object" && headers !== null) {
    raw = (headers as Record<string, unknown>)["retry-after"];
  }
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** Erreurs passagères : limites de débit, surcharge, coupures réseau. */
export function isTransient(error: unknown): boolean {
  const status = httpStatus(error);
  if (status !== undefined) return status === 408 || status === 429 || status >= 500;
  const code = field(error, "code");
  return typeof code === "string" && /ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR/.test(code);
}

/** 3 essais, backoff exponentiel avec jitter ; sur 429, Retry-After est respecté. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}) {
  const { tries = 3, baseMs = 1000, maxMs = 60_000 } = opts;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const shouldRetry = opts.shouldRetry ?? isTransient;

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= tries || !shouldRetry(error)) throw error;
      const backoff = Math.min(maxMs, baseMs * 2 ** (attempt - 1)) * (0.5 + random() / 2);
      await sleep(Math.min(maxMs, Math.max(backoff, retryAfterMs(error) ?? 0)));
    }
  }
}

/** Exécute `worker` sur chaque élément, avec au plus `limit` appels simultanés. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index] as T, index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run));
  return results;
}
