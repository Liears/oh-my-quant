import { afterEach, describe, expect, it } from "bun:test";
import { getJson, postJson } from "../src/http.ts";

describe("source HTTP transport", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
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
