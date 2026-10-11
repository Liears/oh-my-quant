import { expect, it, spyOn } from "bun:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPython } from "../source/src/akshare-python.ts";
import { ETF_NETWORK_SCRIPT } from "./etf-network-script.ts";
import { checkEtfNetwork, readEtfNetwork, skillEtfRevision } from "./etf-network-probe.ts";

const cwd = () => join(tmpdir(), `whyj-etf-probe-${randomUUID()}`);
const utcDayOffset = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const response = (ok = true) => ({ stdout: JSON.stringify({ ok, reason: ok ? "observed" : "missing-etf", executable: "fixture-python",
  symbols: ok ? 9 : 8, minimumBars: 500, latestDate: utcDayOffset(0), oldestDate: utcDayOffset(600),
  ...(ok ? {} : { failedSymbol: "XLP" }) }), stderr: "" });

it("checks only the pinned ETF universe and binds a short-lived observation to its Python interpreter", async () => {
  const root = cwd();
  expect(readEtfNetwork(root).status).toBe("unverified");
  const observed = await checkEtfNetwork(root, undefined, async (script, args, options) => {
    expect(script).toContain('"RSP", "SPY", "IWM", "TLT", "SHY", "HYG", "LQD", "XLY", "XLP"');
    expect(script).toContain("auto_adjust=True");
    expect(script).not.toContain("FMP_API_KEY");
    expect(args).toHaveLength(1);
    expect(options?.timeoutMs).toBe(60_000);
    return response();
  });
  expect(readEtfNetwork(root, "fixture-python").status).toBe("available");
  expect(readEtfNetwork(root, "different-python").status).toBe("unverified");
  expect(readEtfNetwork(root, "fixture-python", Date.parse(observed.expiresAt)).status).toBe("unverified");
  const revision = skillEtfRevision(root), clock = spyOn(Date, "now").mockReturnValue(Date.parse(observed.expiresAt));
  try { expect(skillEtfRevision(root)).not.toBe(revision); } finally { clock.mockRestore(); }
  observed.available = false;
  expect(readEtfNetwork(root, "fixture-python").status).toBe("available");
});

it("keeps the newest check, preserves a prior result on cancellation, and hides raw failures", async () => {
  const root = cwd();
  let release!: (result: ReturnType<typeof response>) => void;
  const old = checkEtfNetwork(root, undefined, async () => new Promise(resolve => { release = resolve; }));
  await checkEtfNetwork(root, undefined, async () => response(false));
  release(response()); await old;
  expect(readEtfNetwork(root, "fixture-python")).toMatchObject({ status: "missing", reason: expect.stringContaining("XLP") });
  const before = skillEtfRevision(root), abort = new AbortController();
  await expect(checkEtfNetwork(root, abort.signal, async () => { abort.abort(); return response(); })).rejects.toThrow();
  expect(skillEtfRevision(root)).toBe(before);
  const failed = await checkEtfNetwork(root, undefined, async () => { throw new Error("PRIVATE_PROXY_SECRET"); });
  expect(failed.available).toBe(false);
  expect(JSON.stringify(failed)).not.toContain("PRIVATE_PROXY_SECRET");
  expect(readEtfNetwork(root, "fixture-python").status).toBe("unverified");
  await checkEtfNetwork(root, undefined, async () => ({ stdout: '{"ok":true,"reason":"observed","executable":"fixture-python"}', stderr: "" }));
  expect(readEtfNetwork(root, "fixture-python").status).not.toBe("available");
});

const FAKE_YFINANCE = String.raw`
import sys, types
from datetime import date, timedelta
class Columns:
    levels = None
    def __contains__(self, key): return key in ("Open", "High", "Low", "Close", "Volume")
class Frame:
    empty = False
    columns = Columns()
    def __init__(self, symbol): self.symbol = symbol
    def iterrows(self):
        today = date.fromisoformat(sys.argv[1])
        for count in range(540):
            day = today - timedelta(days=540-count)
            yield day, {"Open": 100, "High": 101, "Low": 99, "Close": 100, "Volume": 1000}
def download(symbol, **kwargs):
    assert kwargs["auto_adjust"] is True and kwargs["progress"] is False
    if symbol == "XLP" and len(sys.argv) > 2: return None
    return Frame(symbol)
sys.modules["yfinance"] = types.SimpleNamespace(download=download)
`;

it.skipIf(!Bun.which("py") && !Bun.which("python3") && !Bun.which("python"))("validates pinned nine-symbol history using real Python without sockets or installed skill scripts", async () => {
  const success = await runPython(FAKE_YFINANCE + ETF_NETWORK_SCRIPT, ["2026-09-15"], { timeoutMs: 5000 });
  expect(JSON.parse(success.stdout)).toMatchObject({ ok: true, reason: "observed", symbols: 9, minimumBars: 540 });
  const missing = await runPython(FAKE_YFINANCE + ETF_NETWORK_SCRIPT, ["2026-09-15", "missing"], { timeoutMs: 5000 });
  expect(JSON.parse(missing.stdout)).toMatchObject({ ok: false, reason: "missing-etf", failedSymbol: "XLP" });
}, 15_000);
