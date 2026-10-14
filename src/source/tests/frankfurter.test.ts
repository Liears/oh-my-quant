import { afterEach, beforeEach, expect, test } from "bun:test";
import { fetchComparisonFx } from "../src/frankfurter.ts";

let server: ReturnType<typeof Bun.serve> | undefined;
let previousNoProxy: string | undefined;
beforeEach(() => { previousNoProxy = process.env.NO_PROXY; process.env.NO_PROXY = "127.0.0.1,localhost"; });
afterEach(() => {
  server?.stop(true); server = undefined;
  if (previousNoProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = previousNoProxy;
});
function serve(body: unknown, status = 200) {
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json(body, { status }) });
  return { baseUrl: server.url.origin };
}
const rows = [{ date: "2025-01-02", base: "CNY", quote: "USD", rate: 0.125 }];
test("requests a fixed provider/window and inverts quote-per-base API rates", async () => {
  let url: URL | undefined;
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) { url = new URL(request.url); return Response.json(rows); } });
  const result = await fetchComparisonFx("CNY", ["USD", "CNY", "USD"], "2025-01-01", "2025-01-03", { baseUrl: server.url.origin });
  expect(url!.pathname).toBe("/v2/rates");
  expect(Object.fromEntries(url!.searchParams)).toEqual({ base: "CNY", quotes: "USD", from: "2025-01-01", to: "2025-01-03", providers: "ecb" });
  expect(result.points).toEqual([{ date: "2025-01-02", currency: "USD", rate: 8 }]);
});
test("identity needs no network and pre-cancelled requests do not start", async () => {
  const options = { baseUrl: "http://127.0.0.1:1" };
  expect((await fetchComparisonFx("USD", ["USD"], "2025-01-01", "2025-01-03", options)).source).toBe("identity");
  await expect(fetchComparisonFx("USD", ["USD"], "2025-01-01", "2025-01-03", { ...options, signal: AbortSignal.abort(new Error("cancel")) })).rejects.toThrow("cancel");
});
test("rejects unsupported pairs, provider failures and empty responses", async () => {
  await expect(fetchComparisonFx("CNY", ["USD", "HKD"], "2025-01-01", "2025-01-03", serve(rows))).rejects.toThrow("No ECB");
  server!.stop(true);
  await expect(fetchComparisonFx("CNY", ["USD"], "2025-01-01", "2025-01-03", serve([], 503))).rejects.toThrow("HTTP 503");
  server!.stop(true);
  await expect(fetchComparisonFx("CNY", ["USD"], "2025-01-01", "2025-01-03", serve([]))).rejects.toThrow("No ECB");
});
test("rejects duplicate, wrong-identity, outside-window and invalid rates", async () => {
  for (const body of [[...rows, ...rows], [{ ...rows[0], base: "USD" }], [{ ...rows[0], date: "2024-12-31" }], [{ ...rows[0], rate: 0 }], {}]) {
    const options = serve(body);
    await expect(fetchComparisonFx("CNY", ["USD"], "2025-01-01", "2025-01-03", options)).rejects.toThrow();
    server!.stop(true);
  }
});
test("in-flight cancellation reaches HTTP and never becomes an FX observation", async () => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch() { started(); return new Promise<Response>(() => {}); } });
  const controller = new AbortController(), pending = fetchComparisonFx("CNY", ["USD"], "2025-01-01", "2025-01-03", { baseUrl: server.url.origin, signal: controller.signal });
  await ready; controller.abort(new Error("FX cancelled"));
  await expect(pending).rejects.toThrow("FX cancelled");
});
