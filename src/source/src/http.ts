const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export async function postJson<TResponse>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<TResponse> {
  return requestJson<TResponse>(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

export async function getJson<TResponse>(
  url: string,
  headers: Record<string, string> = {},
): Promise<TResponse> {
  return requestJson<TResponse>(url, { headers });
}

async function requestJson<TResponse>(url: string, init: RequestInit): Promise<TResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return await response.json() as TResponse;
}
