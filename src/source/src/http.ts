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
  return request(url, init, options, response => response.json() as Promise<TResponse>);
}

/** Bounded UTF-8 text; the same deadline covers headers and the entire body. */
export async function getText(url: string, maxBytes: number, options: HttpOptions = {}): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Invalid text response limit");
  return request(url, { ...(options.redirect ? { redirect: options.redirect } : {}) }, options, async response => {
    if (!response.body) throw new Error("Provider response invalid");
    const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0, text = "";
    try {
      while (true) {
        options.signal?.throwIfAborted();
        const chunk = await reader.read();
        options.signal?.throwIfAborted();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) { await reader.cancel(); throw new Error("Provider response truncated"); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      return text + decoder.decode();
    } finally { reader.releaseLock(); }
  });
}

async function request<TResponse>(url: string, init: RequestInit, options: HttpOptions, read: (response: Response) => Promise<TResponse>): Promise<TResponse> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  try {
    options.signal?.throwIfAborted();
    const response = await fetch(url, { ...init, signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return await read(response);
  } catch (error) {
    options.signal?.throwIfAborted();
    if (controller.signal.aborted) throw new Error(`Request timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
