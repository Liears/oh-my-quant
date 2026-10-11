import { expect, it } from "bun:test";
import { collectDoctor, formatDoctorText } from "./doctor.ts";
import { DEFAULT_SETTINGS } from "../types/config.ts";
import type { DoctorResult } from "../types/doctor.ts";

it("checks AKShare tool dependencies even when the configured price source is Financial Datasets", async () => {
  const cfg = structuredClone(DEFAULT_SETTINGS); cfg.preferences.source = "financial-datasets";
  cfg.env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY = "fixture-key";
  let calls = 0;
  const result = await collectDoctor(cfg, {}, { phases: ["tools"], writeLog: false,
    checkDependency: async () => { calls++; return { status: "missing-python" }; } });
  expect(calls).toBe(1); expect(result.phases[1]).toMatchObject({ status: "fail", dependency: { status: "missing-python" } });
  expect(result.phases[2].status).toBe("pending");
  expect(result.capabilities!.find(tool => tool.name === "fetch_bars")!.status).toBe("unverified");
  expect(formatDoctorText(result)).toContain("Tool capabilities");
  expect(formatDoctorText(result)).toContain("akshare_fund_fund_fee_em");
  expect(JSON.stringify(result.capabilities)).not.toContain("fixture-key");
});

it("does not equate dependency success or a skipped network check with endpoint readiness", async () => {
  const cfg = structuredClone(DEFAULT_SETTINGS); cfg.preferences.source = "akshare";
  const ready = await collectDoctor(cfg, {}, { phases: ["tools", "data"], skipNetwork: true, writeLog: false,
    checkDependency: async () => ({ status: "ready", python: "fixture", akshare: "fixture" }) });
  expect(ready.phases[1].status).toBe("pass"); expect(ready.phases[1].warnings!.join(" ")).toContain("permissions remain unverified");
  expect(ready.capabilities!.some(tool => tool.status === "sample-verified")).toBe(false);
  const updates: DoctorResult[] = [];
  const retried = await collectDoctor(cfg, {}, { phases: ["tools"], seedState: ready, skipNetwork: true, writeLog: false,
    onState: state => updates.push(state), checkDependency: async () => ({ status: "missing-package" }) });
  expect(updates[0]!.phases[1].dependency).toBeUndefined();
  expect(retried.phases[1].dependency?.status).toBe("missing-package");
  expect(ready.phases[1].dependency?.status).toBe("ready");
});

it("cancels and times out even a dependency checker that ignores its signal", async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController(); let signal: AbortSignal | undefined;
    const result = await collectDoctor(DEFAULT_SETTINGS, {}, { phases: ["tools", "data"], writeLog: false, probeTimeoutMs: 5, signal: controller.signal,
      checkDependency: async options => { signal = options.signal; if (cancel) controller.abort(); return new Promise(() => {}); } });
    expect(signal?.aborted).toBe(true); expect(result.phases[1].status).toBe("fail");
    expect(result.phases[1].dependency).toBeUndefined();
    if (cancel) expect(result.phases[2].status).toBe("pending");
  }
});
