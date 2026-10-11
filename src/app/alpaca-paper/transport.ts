/** Only the official paper Trading API host can receive these credentials. */
const ORIGIN = "https://paper-api.alpaca.markets";
export interface AlpacaPaperCredentials { keyId: string; secretKey: string }
export interface AlpacaResponse { status: number; data: unknown }

export class AlpacaPaperTransport {
  constructor(private readonly credentials: () => Promise<AlpacaPaperCredentials>, private readonly request: typeof fetch = fetch) {}

  async call(method: "GET" | "POST" | "DELETE", path: string, signal: AbortSignal, body?: unknown): Promise<AlpacaResponse> {
    signal.throwIfAborted();
    if (!path.startsWith("/v2/") || path.includes("//") || path.includes("..")) throw new Error("Invalid Alpaca paper API path");
    const { keyId, secretKey } = await this.credentials();
    if (!keyId?.trim() || !secretKey?.trim()) throw new Error("Alpaca paper credentials are required");
    const headers: Record<string, string> = { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secretKey };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await this.request(`${ORIGIN}${path}`, { method, headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
    if (response.status === 204 || response.status === 404) return { status: response.status, data: null };
    if (!response.ok) throw new Error(`Alpaca paper API returned HTTP ${response.status}`);
    if (Number(response.headers.get("content-length")) > 1_000_000) throw new Error("Alpaca paper response is too large");
    const raw = await response.text();
    if (raw.length > 1_000_000) throw new Error("Alpaca paper response is too large");
    return { status: response.status, data: raw ? JSON.parse(raw) as unknown : null };
  }
}
