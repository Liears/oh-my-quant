import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { cancelOrder, lookupOrder, prepareOrderIntent, submitOrder } from "../../../execution/index.ts";
import type { OrderIntent } from "../../../execution/index.ts";
import { createAlpacaPaperAdapter } from "../adapter.ts";

const now = () => 1000;
const roots: string[] = [];
function root(): string { const path = mkdtempSync(join(tmpdir(), "whyj-alpaca-paper-")); roots.push(path); return path; }
afterEach(() => {
  const temporary = realpathSync(tmpdir());
  for (const path of roots.splice(0)) {
    const selected = realpathSync(path);
    if (!selected.startsWith(temporary + sep)) throw new Error("Refusing to remove a path outside the temporary directory");
    rmSync(selected, { recursive: true, force: true });
  }
});
const intent = (id = "paper-id"): OrderIntent => ({ version: 1,
  target: { adapterId: "alpaca-paper", accountRef: "paper-account", mode: "paper" },
  clientOrderId: id, instrument: { symbol: "AAPL", venue: "ALPACA-US", currency: "USD" },
  side: "buy", type: "limit", quantity: "2", limitPrice: "10", maxOrderNotional: "20", timeInForce: "gtc" });

function mock() {
  let remote: Record<string, unknown> | null = null, accountId = "paper-account", losePost = false, assetTradable = true;
  let posts = 0, deletes = 0;
  let activities: unknown[] = [];
  const requests: Array<{ url: string; method: string; headers: Headers }> = [];
  const response = (data: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status });
  const fetcher = (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = String(input), method = init?.method ?? "GET", headers = new Headers(init?.headers);
    requests.push({ url, method, headers });
    expect(url.startsWith("https://paper-api.alpaca.markets/v2/")).toBe(true);
    expect(headers.get("APCA-API-KEY-ID")).toBe("fixture-paper-key");
    expect(headers.get("APCA-API-SECRET-KEY")).toBe("fixture-paper-secret");
    const path = new URL(url).pathname;
    if (path === "/v2/account") return response({ id: accountId, status: "ACTIVE", trading_blocked: false, cash: "100", buying_power: "100" });
    if (path === "/v2/assets/AAPL") return response({ symbol: "AAPL", class: "us_equity", status: "active", tradable: assetTradable });
    if (path === "/v2/positions") return response([]);
    if (path === "/v2/orders:by_client_order_id") return remote ? response(remote) : response(null, 404);
    if (path === "/v2/account/activities/FILL") {
      const token = new URL(url).searchParams.get("page_token");
      const start = token ? activities.findIndex(item => (item as Record<string, unknown>).id === token) + 1 : 0;
      if (token && start === 0) throw new Error("Unknown fill page token");
      return response(activities.slice(start, start + 100));
    }
    if (path === "/v2/orders" && method === "POST") {
      posts++;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ symbol: "AAPL", qty: "2", side: "buy", type: "limit", time_in_force: "gtc", client_order_id: "paper-id" });
      remote = { id: "broker-order", client_order_id: body.client_order_id, symbol: body.symbol,
        side: body.side, type: body.type, time_in_force: body.time_in_force,
        qty: body.qty, limit_price: body.limit_price, filled_qty: "0", status: "new" };
      if (losePost) { losePost = false; throw new Error("Connection lost after acceptance"); }
      return response(remote);
    }
    if (path === "/v2/orders/broker-order" && method === "DELETE") { deletes++; return response(null, 204); }
    throw new Error(`Unexpected mock request ${method} ${path}`);
  }) as typeof fetch;
  return { fetcher, requests, get posts() { return posts; }, get deletes() { return deletes; },
    set remote(value: Record<string, unknown> | null) { remote = value; },
    get remote() { return remote; }, set accountId(value: string) { accountId = value; },
    set losePost(value: boolean) { losePost = value; }, set activities(value: unknown[]) { activities = value; },
    set assetTradable(value: boolean) { assetTradable = value; } };
}

function adapter(root: string, api: ReturnType<typeof mock>) {
  return createAlpacaPaperAdapter({ root, accountRef: "paper-account", fetch: api.fetcher,
    credentials: async () => ({ keyId: "fixture-paper-key", secretKey: "fixture-paper-secret" }), now });
}

it("submits once, binds the complete intent across restarts, and reconciles a lost POST receipt", async () => {
  const directory = root(), api = mock(), order = intent();
  api.losePost = true;
  expect(await submitOrder(adapter(directory, api), order, { now })).toEqual({ status: "reconcile-required", reason: "submission-unconfirmed" });
  expect(api.posts).toBe(1);
  const restarted = adapter(directory, api);
  expect(await submitOrder(restarted, order, { now })).toMatchObject({ status: "submitted", order: { orderId: "broker-order", status: "open" } });
  expect(api.posts).toBe(1);
  expect(await lookupOrder(restarted, order)).toMatchObject({ status: "found", order: { clientOrderId: "paper-id" } });
  const changed = { ...order, maxOrderNotional: "21" };
  expect(await submitOrder(restarted, changed, { now })).toMatchObject({ status: "not-submitted" });
  expect(api.posts).toBe(1);
  expect(await lookupOrder(restarted, changed)).toEqual({ status: "unknown" });
});

it("allows only one dispatch reservation across independent Bun processes", async () => {
  const directory = root();
  const worker = resolve(import.meta.dir, "./fixtures/journal-worker.ts");
  const children = [Bun.spawn([process.execPath, "run", worker, directory, "cross-process-id"], { stdout: "pipe", stderr: "pipe" }),
    Bun.spawn([process.execPath, "run", worker, directory, "cross-process-id"], { stdout: "pipe", stderr: "pipe" })];
  const results = await Promise.all(children.map(async child => {
    const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code).toBe(0); expect(error).toBe("");
    return JSON.parse(output) as { reserved: boolean; hash: string };
  }));
  expect(results.map(item => item.reserved).sort()).toEqual([false, true]);
  expect(results[0]!.hash).toBe(results[1]!.hash);
});

it("never retries a reserved order when the broker cannot yet find it", async () => {
  const directory = root(), api = mock();
  api.losePost = true;
  await submitOrder(adapter(directory, api), intent(), { now });
  api.remote = null;
  expect(await submitOrder(adapter(directory, api), intent(), { now })).toMatchObject({ status: "reconcile-required" });
  expect(api.posts).toBe(1);
  expect(await lookupOrder(adapter(directory, api), intent())).toEqual({ status: "unknown" });
});

it("keeps broker fill fees unknown and requires complete per-order fill activities", async () => {
  const directory = root(), api = mock(), selected = adapter(directory, api);
  expect(await submitOrder(selected, intent(), { now })).toMatchObject({ status: "submitted" });
  api.remote = { ...api.remote!, status: "filled", filled_qty: "2" };
  api.activities = [{ activity_type: "FILL", id: "activity::one", order_id: "broker-order", symbol: "AAPL",
    side: "buy", qty: "2", price: "9", transaction_time: "1970-01-01T00:00:00.900Z" }];
  expect(await lookupOrder(selected, intent())).toMatchObject({ status: "found", order: {
    status: "filled", filledQuantity: "2", fills: [{ id: "activity::one", fee: null, price: "9" }] } });
  api.activities = [];
  expect(await lookupOrder(selected, intent())).toEqual({ status: "unknown" });
  api.activities = [{ activity_type: "FILL", id: "activity::foreign", order_id: "another-order", symbol: "AAPL",
    side: "buy", qty: "2", price: "9", transaction_time: "1970-01-01T00:00:00.900Z" }];
  expect(await lookupOrder(selected, intent())).toEqual({ status: "unknown" });
});

it("fetches every page before certifying a filled order", async () => {
  const directory = root(), api = mock(), selected = adapter(directory, api);
  await submitOrder(selected, intent(), { now });
  api.remote = { ...api.remote!, status: "filled", filled_qty: "2" };
  api.activities = Array.from({ length: 101 }, (_, index) => ({ activity_type: "FILL",
    id: `activity::${String(index).padStart(3, "0")}`, order_id: "broker-order", symbol: "AAPL", side: "buy",
    qty: index === 100 ? "1" : "0.01", price: "9", transaction_time: "1970-01-01T00:00:00.900Z" }));
  expect(await lookupOrder(selected, intent())).toMatchObject({ status: "found", order: { status: "filled", filledQuantity: "2" } });
  expect(api.requests.filter(request => request.url.includes("/activities/FILL"))).toHaveLength(2);
});

it("treats a broker cancel acknowledgement as requested until a later status confirms cancellation", async () => {
  const directory = root(), api = mock(), selected = adapter(directory, api);
  await submitOrder(selected, intent(), { now });
  expect(await cancelOrder(selected, intent(), { now })).toEqual({ status: "requested" });
  expect(api.deletes).toBe(1);
  api.remote = { ...api.remote!, status: "canceled" };
  expect(await lookupOrder(selected, intent())).toMatchObject({ status: "found", order: { status: "cancelled" } });
  expect(await cancelOrder(selected, intent(), { now })).toMatchObject({ status: "resolved", order: { status: "cancelled" } });
  expect(api.deletes).toBe(1);
});

it("fails closed on an account switch and on an externally occupied client order ID", async () => {
  const directory = root(), api = mock(), selected = adapter(directory, api);
  api.accountId = "different-account";
  expect(await submitOrder(selected, intent(), { now })).toMatchObject({ status: "not-submitted" });
  expect(api.posts).toBe(0);
  api.accountId = "paper-account";
  api.remote = { id: "foreign-order", client_order_id: "paper-id", symbol: "AAPL", side: "buy",
    type: "limit", time_in_force: "gtc", qty: "2", limit_price: "10", filled_qty: "0", status: "new" };
  expect(await submitOrder(selected, intent(), { now })).toMatchObject({ status: "reconcile-required" });
  expect(api.posts).toBe(0);
});

it("rejects an active but non-tradable asset before reserving a client ID or posting", async () => {
  const directory = root(), api = mock(), selected = adapter(directory, api);
  const prepared = prepareOrderIntent(intent(), selected.target);
  expect((await selected.preflight(prepared, new AbortController().signal)).status).toBe("ready");
  api.assetTradable = false;
  await expect(selected.submit(prepared, { signal: new AbortController().signal })).rejects.toThrow("no longer active and tradable");
  expect(await submitOrder(selected, intent(), { now })).toMatchObject({ status: "not-submitted", reason: "preflight-failed" });
  expect(api.posts).toBe(0);
  api.assetTradable = true;
  expect(await submitOrder(selected, intent(), { now })).toMatchObject({ status: "submitted" });
  expect(api.posts).toBe(1);
});
