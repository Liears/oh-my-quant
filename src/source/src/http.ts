const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export interface HttpOptions { timeoutMs?: number; signal?: AbortSignal; redirect?: RequestInit["redirect"] }

export async function postJson<TResponse>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  options: HttpOptions = {},
): Promise<TResponse> {
  return requestJson<TResponse>(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  }, options);
}

export async function getJson<TResponse>(
  url: string,
  headers: Record<string, string> = {},
  options: HttpOptions = {},
): Promise<TResponse> {
  return requestJson<TResponse>(url, { headers, ...(options.redirect ? { redirect: options.redirect } : {}) }, options);
}

async function requestJson<TResponse>(url: string, init: RequestInit, options: HttpOptions): Promise<TResponse> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  try {
    const response = await fetch(url, { ...init, signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return await response.json() as TResponse;
  } catch (error) {
    options.signal?.throwIfAborted();
    if (controller.signal.aborted) throw new Error(`Request timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
