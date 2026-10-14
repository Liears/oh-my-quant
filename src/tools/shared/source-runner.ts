export interface SourceCandidate<T> {
  id: string;
  provider: string;
  endpoint: string;
  /** A candidate can resolve a different concrete route during its internal fallback. */
  endpointFor?: (value: T) => string;
  fetch: (symbol: string) => Promise<T>;
  isHit: (value: T) => boolean;
}

export interface SourceAttempt {
  id: string;
  provider: string;
  endpoint: string;
  status: "ok" | "empty" | "error";
  rows?: number;
  error?: string;
}

export interface SourceResult<T> {
  candidate: SourceCandidate<T> | null;
  value: T | null;
  attempts: SourceAttempt[];
}

export async function runFirstSource<T>(
  symbol: string,
  sourcePriority: string | undefined,
  candidates: SourceCandidate<T>[],
  signal?: AbortSignal,
): Promise<SourceResult<T>> {
  signal?.throwIfAborted();
  const attempts: SourceAttempt[] = [];
  for (const candidate of orderCandidates(candidates, sourcePriority)) {
    signal?.throwIfAborted();
    try {
      const value = await candidate.fetch(symbol);
      signal?.throwIfAborted();
      const hit = candidate.isHit(value);
      const resolved = { ...candidate, endpoint: candidate.endpointFor?.(value) ?? candidate.endpoint };
      attempts.push({
        id: candidate.id,
        provider: candidate.provider,
        endpoint: resolved.endpoint,
        status: hit ? "ok" : "empty",
        rows: valueCount(value),
      });
      if (hit) return { candidate: resolved, value, attempts };
    } catch (error) {
      signal?.throwIfAborted();
      attempts.push({
        id: candidate.id,
        provider: candidate.provider,
        endpoint: candidate.endpoint,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { candidate: null, value: null, attempts };
}

export async function runAllSources<T>(
  symbol: string,
  sourcePriority: string | undefined,
  candidates: SourceCandidate<T>[],
  signal?: AbortSignal,
): Promise<{ values: Array<{ candidate: SourceCandidate<T>; value: T }>; attempts: SourceAttempt[] }> {
  signal?.throwIfAborted();
  const values: Array<{ candidate: SourceCandidate<T>; value: T }> = [];
  const attempts: SourceAttempt[] = [];
  for (const candidate of orderCandidates(candidates, sourcePriority)) {
    signal?.throwIfAborted();
    try {
      const value = await candidate.fetch(symbol);
      signal?.throwIfAborted();
      const hit = candidate.isHit(value);
      const resolved = { ...candidate, endpoint: candidate.endpointFor?.(value) ?? candidate.endpoint };
      attempts.push({
        id: candidate.id,
        provider: candidate.provider,
        endpoint: resolved.endpoint,
        status: hit ? "ok" : "empty",
        rows: valueCount(value),
      });
      if (hit) values.push({ candidate: resolved, value });
    } catch (error) {
      signal?.throwIfAborted();
      attempts.push({
        id: candidate.id,
        provider: candidate.provider,
        endpoint: candidate.endpoint,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { values, attempts };
}

export function orderCandidates<T>(candidates: SourceCandidate<T>[], sourcePriority?: string): SourceCandidate<T>[] {
  const tokens = parseSourcePriority(sourcePriority);
  if (tokens.length === 0) return [...candidates];
  const picked: SourceCandidate<T>[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    for (const candidate of candidates) {
      if (seen.has(candidate.id)) continue;
      if (candidateMatches(candidate, token)) {
        picked.push(candidate);
        seen.add(candidate.id);
      }
    }
  }
  for (const candidate of candidates) {
    if (!seen.has(candidate.id)) picked.push(candidate);
  }
  return picked;
}

export function parseSourcePriority(value?: string): string[] {
  return String(value || "")
    .split(/[,，>、\s]+/u)
    .map((item) => normalizeSourceToken(item))
    .filter(Boolean);
}

function normalizeSourceToken(value: string): string {
  const raw = value.trim().toLowerCase();
  const aliases: Record<string, string> = {
    东方财富: "eastmoney",
    天天基金: "eastmoney",
    东财: "eastmoney",
    雪球: "xq",
    蛋卷: "xq",
    同花顺: "ths",
    新浪: "sina",
  };
  return aliases[value.trim()] || raw;
}

function candidateMatches<T>(candidate: SourceCandidate<T>, token: string): boolean {
  return candidate.id.toLowerCase() === token
    || candidate.provider.toLowerCase() === token
    || candidate.endpoint.toLowerCase() === token;
}

function valueCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (isRecord(value)) return Object.keys(value).length > 0 ? 1 : 0;
  return value == null ? 0 : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
