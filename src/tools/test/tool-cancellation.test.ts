import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { setImmediate } from "node:timers/promises";
import { listBuiltinToolRegistrations } from "../registry.ts";
import { searchSymbolsTool } from "../data-tools.ts";
import { runAllSources, type SourceCandidate } from "../shared/source-runner.ts";
import { loadSettings, saveSettings } from "../../storage/index.ts";

it("rejects a pre-cancelled invocation for every data tool before input processing or I/O", async () => {
  const controller = new AbortController(), reason = new Error("cancelled-tool-fixture"); controller.abort(reason);
  for (const entry of listBuiltinToolRegistrations("data")) {
    await expect(entry.tool.execute("cancel", {}, controller.signal)).rejects.toBe(reason);
  }
});

it("stops a multi-source merge after cancellation instead of accepting a late result or trying another endpoint", async () => {
  for (const fail of [false, true]) {
    const controller = new AbortController(), reason = new Error("cancelled-merge-fixture"); let next = 0;
    const candidates: SourceCandidate<Record<string, string>>[] = [
      { id: "first", provider: "first", endpoint: "first", isHit: () => true, fetch: async () => {
        controller.abort(reason); if (fail) throw new Error("late endpoint failure"); return { name: "late result" };
      } },
      { id: "second", provider: "second", endpoint: "second", isHit: () => true, fetch: async () => { next++; return {}; } },
    ];
    await expect(runAllSources("270042", undefined, candidates, controller.signal)).rejects.toBe(reason);
    expect(next).toBe(0);
  }
});

it("uses the actual Tushare search credential route and distinguishes permission failure, empty data and cancellation", async () => {
  const previous = { OHQUANT_DIR: process.env.OHQUANT_DIR, NO_PROXY: process.env.NO_PROXY, WHYJ_QUANT_TUSHARE_TOKEN: process.env.WHYJ_QUANT_TUSHARE_TOKEN };
  const root = mkdtempSync(join(tmpdir(), "whyj-search-capability-"));
  process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost"; process.env.WHYJ_QUANT_TUSHARE_TOKEN = "environment-search-key";
  let mode = "success", release: (() => void) | undefined;
  const requests: Array<{ api_name: string; token: string }> = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    requests.push(await request.json() as { api_name: string; token: string });
    if (mode === "wait") await new Promise<void>(resolve => { release = resolve; });
    if (mode === "denied") return Response.json({ code: -1, msg: "stock_basic permission denied" });
    return Response.json({ code: 0, data: { fields: ["ts_code", "name"], items: mode === "empty" ? [] : [["000001.SZ", "平安银行"]] } });
  } });
  try {
    const cfg = loadSettings(); cfg.preferences.source = "financial-datasets";
    cfg.env.TUSHARE_BASE_URL = String(server.url).replace(/\/$/, ""); saveSettings(cfg);
    const result = await searchSymbolsTool.execute("search", { keyword: "平安" });
    expect(result.details).toMatchObject({ count: 1 });
    expect(requests[0]).toMatchObject({ api_name: "stock_basic", token: "environment-search-key" });
    const saved = loadSettings(); saved.env.WHYJ_QUANT_TUSHARE_TOKEN = "saved-search-key"; saveSettings(saved);
    mode = "empty"; expect((await searchSymbolsTool.execute("empty", { keyword: "不存在" })).details).toMatchObject({ count: 0 });
    expect(requests[1]!.token).toBe("saved-search-key");
    mode = "denied"; await expect(searchSymbolsTool.execute("denied", { keyword: "平安" })).rejects.toThrow("permission denied");
    mode = "wait"; const controller = new AbortController();
    const pending = searchSymbolsTool.execute("cancel", { keyword: "平安" }, controller.signal);
    const deadline = Date.now() + 2000;
    while (!release) { if (Date.now() > deadline) throw new Error("Search request not observed"); await setImmediate(); }
    controller.abort(new Error("search-cancelled"));
    await expect(pending).rejects.toThrow("search-cancelled");
    expect(requests).toHaveLength(4);
  } finally {
    release?.(); server.stop(true);
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected search test directory");
    rmSync(root, { recursive: true, force: true });
  }
});
