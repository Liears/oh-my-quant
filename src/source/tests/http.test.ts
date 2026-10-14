import { afterEach, describe, expect, it } from "bun:test";
import { getJson, getText, postJson } from "../src/http.ts";

describe("source HTTP transport", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("bounds text bytes, validates UTF-8 across chunks, and retains redirect/cancellation policy", async () => {
    const bytes = new TextEncoder().encode("净值"), requests: RequestInit[] = [];
    globalThis.fetch = (async (_input, init) => {
      requests.push(init!);
      return new Response(new ReadableStream({ start(stream) { stream.enqueue(bytes.slice(0, 2)); stream.enqueue(bytes.slice(2)); stream.close(); } }));
    }) as typeof fetch;
    expect(await getText("https://example.test", 6, { redirect: "error" })).toBe("净值");
    expect(requests[0]?.redirect).toBe("error");
    await expect(getText("https://example.test", 5)).rejects.toThrow("truncated");
    const controller = new AbortController(); controller.abort(new Error("cancel before HTTP"));
    await expect(getText("https://example.test", 6, { signal: controller.signal })).rejects.toThrow("cancel before HTTP");
    expect(requests).toHaveLength(2);
    await expect(getText("https://example.test", 0)).rejects.toThrow("Invalid text response limit");
    globalThis.fetch = (async () => new Response(new Uint8Array([255]))) as unknown as typeof fetch;
    await expect(getText("https://example.test", 6)).rejects.toThrow();
  });

  it("times out stalled text bodies and preserves user cancellation", async () => {
    globalThis.fetch = (async (_input, init) => new Response(new ReadableStream({ start(stream) {
      init!.signal!.addEventListener("abort", () => stream.error(init!.signal!.reason), { once: true });
    } }))) as typeof fetch;
    await expect(getText("https://example.test", 10, { timeoutMs: 10 })).rejects.toThrow("Request timed out after 10ms");
    const controller = new AbortController();
    const pending = getText("https://example.test", 10, { signal: controller.signal });
    await Promise.resolve(); controller.abort(new Error("cancel body"));
    await expect(pending).rejects.toThrow("cancel body");
  });

  it("adds JSON headers and an abort signal to POST requests", async () => {
    let init: RequestInit | undefined;
    globalThis.fetch = (async (_url, request) => {
      init = request;
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof fetch;

    await expect(postJson("https://data.test", { symbol: "000001.SZ" })).resolves.toEqual({ ok: true });
    expect(init?.headers).toMatchObject({ "content-type": "application/json" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("preserves provider HTTP failures", async () => {
    globalThis.fetch = (async () => new Response("bad gateway", { status: 502, statusText: "Bad Gateway" })) as unknown as typeof fetch;
    await expect(getJson("https://data.test")).rejects.toThrow("HTTP 502 Bad Gateway");
  });

it("times out a response whose headers arrive but JSON body stalls", async () => {
  globalThis.fetch = (async (_input, init) => new Response(new ReadableStream({
    start(controller) {
      init!.signal!.addEventListener("abort", () => controller.error(init!.signal!.reason), { once: true });
    },
  }))) as typeof fetch;
  await expect(getJson("https://example.test", {}, { timeoutMs: 10 })).rejects.toThrow("Request timed out after 10ms");
});

it("propagates external cancellation without misreporting timeout", async () => {
  const controller = new AbortController();
  globalThis.fetch = (async (_input, init) => new Promise<Response>((_, reject) => {
    init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
  })) as typeof fetch;
  const pending = getJson("https://example.test", {}, { signal: controller.signal });
  controller.abort(new Error("Closed overview"));
  await expect(pending).rejects.toThrow("Closed overview");
});

});
