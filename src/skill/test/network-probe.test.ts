import { expect, it, spyOn } from "bun:test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkSkillNetwork, readSkillNetwork, skillNetworkRevision } from "../network-probe.ts";
import { BREADTH_NETWORK_SCRIPT } from "../breadth-network-script.ts";
import { runPython } from "../../source/src/akshare-python.ts";

const cwd = () => join(tmpdir(), `whyj-network-probe-${randomUUID()}`);
const response = (ok = true) => ({ stdout: JSON.stringify({ ok, reason: ok ? "observed" : "http-503", executable: "fixture-python",
  latestDate: "2026-09-15", detailRows: 100, summaryRows: 10 }), stderr: "" });

it("scopes network evidence to the interpreter and expires it without changing returned objects", async () => {
  const root = cwd();
  expect(readSkillNetwork(root).status).toBe("unverified");
  const observed = await checkSkillNetwork(root, undefined, async (script, args, options) => {
    expect(script).toContain("trust_env = False");
    expect(script).not.toContain("pip install");
    expect(args?.slice(0, 2)).toEqual(["https://tradermonty.github.io/market-breadth-analysis/market_breadth_data.csv", "https://tradermonty.github.io/market-breadth-analysis/market_breadth_summary.csv"]);
    expect(options?.timeoutMs).toBe(20000);
    return response();
  });
  expect(readSkillNetwork(root, "fixture-python").status).toBe("available");
  expect(readSkillNetwork(root, "different-python").status).toBe("unverified");
  expect(readSkillNetwork(root, "fixture-python", Date.parse(observed.expiresAt)).status).toBe("unverified");
  const revision = skillNetworkRevision(root), clock = spyOn(Date, "now").mockReturnValue(Date.parse(observed.expiresAt));
  try {
    expect(skillNetworkRevision(root)).not.toBe(revision);
    expect(readSkillNetwork(root, "fixture-python").status).toBe("unverified");
  } finally { clock.mockRestore(); }
  observed.available = false;
  expect(readSkillNetwork(root, "fixture-python").status).toBe("available");
  await checkSkillNetwork(root, undefined, async () => response(false));
  expect(readSkillNetwork(root, "fixture-python")).toMatchObject({ status: "missing", reason: expect.stringContaining("http-503") });
});

it("keeps the newest check, preserves prior observations on cancel, and hides raw failures", async () => {
  const root = cwd();
  let release!: (result: ReturnType<typeof response>) => void;
  const old = checkSkillNetwork(root, undefined, async () => new Promise(resolve => { release = resolve; }));
  await checkSkillNetwork(root, undefined, async () => response(false));
  release(response()); await old;
  expect(readSkillNetwork(root, "fixture-python").status).toBe("missing");
  const before = skillNetworkRevision(root), abort = new AbortController();
  await expect(checkSkillNetwork(root, abort.signal, async () => { abort.abort(); return response(); })).rejects.toThrow();
  expect(skillNetworkRevision(root)).toBe(before);
  const failed = await checkSkillNetwork(root, undefined, async () => { throw new Error("PRIVATE_PROXY_SECRET"); });
  expect(failed.available).toBe(false);
  expect(JSON.stringify(failed)).not.toContain("PRIVATE_PROXY_SECRET");
  expect(readSkillNetwork(root, "fixture-python").status).toBe("unverified");
  await checkSkillNetwork(root, undefined, async () => ({ stdout: '{"ok":true,"reason":"observed","executable":"fixture-python"}', stderr: "" }));
  expect(readSkillNetwork(root, "fixture-python").status).not.toBe("available");
});

// Exercise the actual Python CSV parser with an in-memory requests stand-in: no third-party packages or sockets.
const TRANSPORT = String.raw`
import json, sys, types
payload = json.loads(sys.argv[4])
class Response:
    def __init__(self, key):
        self.status_code = payload.get("status", 200)
        self.body = payload[key].encode("utf-8")
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def iter_content(self, size):
        for offset in range(0, len(self.body), size): yield self.body[offset:offset+size]
class Session:
    def get(self, url, **kwargs):
        assert self.trust_env is False and kwargs["allow_redirects"] is False
        return Response(url)
sys.modules["requests"] = types.SimpleNamespace(Session=Session)
`;
const detail = "Date,S&P500_Price,Breadth_Index_Raw,Breadth_Index_200MA,Breadth_Index_8MA,Breadth_200MA_Trend,Bearish_Signal,Is_Peak,Is_Trough,Is_Trough_8MA_Below_04\n2026-09-14,6000,0.5,0.4,0.6,1,false,false,true,0\n";
const summary = 'Metric,Value\n"Average, fixture",0.5\n';
it.skipIf(!Bun.which("py") && !Bun.which("python3") && !Bun.which("python"))("validates real Python CSV parsing, freshness, HTTP errors and response size without network", async () => {
  for (const sample of [
    { detail, summary, reason: "observed" },
    { detail, summary, status: 403, reason: "http-403" },
    { detail: "<html>login</html>", summary, reason: "invalid-csv" },
    { detail: detail.replace("2026-09-14", "2026-09-01"), summary, reason: "stale-data" },
    { detail: detail.replace("2026-09-14", "2026-09-16"), summary, reason: "future-data" },
    { detail: detail.replace("6000", "NaN"), summary, reason: "invalid-csv" },
    { detail: detail.replace("2026-09-14", "2026-02-30"), summary, reason: "invalid-csv" },
    { detail, summary: "Metric,Value\nmissing\n", reason: "invalid-csv" },
    { detail, summary: "Metric,Value\nSame,1\nSame,2\n", reason: "invalid-summary" },
  ]) {
    const { stdout } = await runPython(TRANSPORT + BREADTH_NETWORK_SCRIPT, ["detail", "summary", "2026-09-15", JSON.stringify(sample)], { timeoutMs: 5000 });
    expect(JSON.parse(stdout)).toMatchObject({ ok: sample.reason === "observed", reason: sample.reason });
  }
  const oversized = TRANSPORT.replace('self.body = payload[key].encode("utf-8")', 'self.body = b"x" * (4 * 1024 * 1024 + 1)');
  const result = await runPython(oversized + BREADTH_NETWORK_SCRIPT, ["detail", "summary", "2026-09-15", JSON.stringify({ detail, summary })], { timeoutMs: 5000 });
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, reason: "response-too-large" });
}, 20000);
