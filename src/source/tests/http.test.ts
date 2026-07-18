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
});
