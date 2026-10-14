import { describe, expect, it } from "bun:test";
import { runComparison, type ComparisonContext } from "../research/comparison.ts";
import { volatilityRule, sectorRule } from "../../quant/auto-classify.ts";
import type { SymbolProfile } from "../../quant/auto-classify.ts";
import type { ComparisonArtifact } from "../../types/comparison.ts";

function rm(overrides: Partial<{
  annualVol: number; maxDrawdown: number;
  downsideVol: number; var95: number; var99: number; var95Parametric: number;
  cvar95: number; cvar99: number; maxDdDays: number; skewness: number; kurtosis: number;
}> = {}) {
  return {
    annualVol: 0.25, maxDrawdown: -0.15, downsideVol: 0.18,
    var95: -0.02, var99: -0.03, var95Parametric: -0.025,
    cvar95: -0.025, cvar99: -0.035, maxDdDays: 30,
    skewness: -0.5, kurtosis: 3.2,
    ...overrides,
  };
}

function makeReturns(returns: number[]): Map<string, number> {
  const m = new Map<string, number>();
  const start = new Date("2024-01-02");
  for (let i = 0; i < returns.length; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    m.set(d.toISOString().slice(0, 10), returns[i]);
  }
  return m;
}

describe("comparison", () => {
  it("assembles a calculated artifact with host metadata and persists it exactly once", async () => {
    const saved: ComparisonArtifact[] = [];
    const calls: string[] = [];
    const id = await runComparison(["A"], { name: "tech", rules: [sectorRule("tech")] }, {
      fetchSymbolProfile: async code => { calls.push(`profile:${code}`); return { code, name: code, sector: "tech" }; },
      fetchSymbolReturns: async code => { calls.push(`returns:${code}`); return makeReturns([0, 0.1, -0.1]); },
      generateComparisonId: () => "host-owned-id",
      now: () => new Date("2026-10-01T00:00:00Z"),
      saveComparison: artifact => { calls.push("save"); saved.push(artifact); },
    });
    expect(id).toBe("host-owned-id");
    expect(calls).toEqual(["profile:A", "returns:A", "save"]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id, createdAt: "2026-10-01T00:00:00.000Z",
      groups: [{ groupId: "auto-tech", symbolCount: 1 }] });
    expect(saved[0]!.groups[0]!.totalReturn).toBeCloseTo(-0.01, 12);
  });

  it.each(["fetch", "insufficient", "save"])("propagates %s failures without claiming a saved result", async failure => {
    let saves = 0;
    await expect(runComparison(["A"], { name: "tech", rules: [sectorRule("tech")] }, {
      fetchSymbolProfile: async code => ({ code, name: code, sector: "tech" }),
      fetchSymbolReturns: async () => {
        if (failure === "fetch") throw new Error("fetch failed");
        return makeReturns(failure === "insufficient" ? [0] : [0, 0.1, -0.1]);
      },
      saveComparison: () => { saves++; throw new Error("save failed"); },
    })).rejects.toThrow(failure === "insufficient" ? "No groups had sufficient data" : `${failure} failed`);
    expect(saves).toBe(failure === "save" ? 1 : 0);
  });

  it("runs full pipeline with volatility classification", async () => {
    const symbols = ["000001", "000002", "000003"];
    let profileCalls: string[] = [];
    let returnCalls: string[] = [];

    const ctx: ComparisonContext = {
      fetchSymbolProfile: async (code) => {
        profileCalls.push(code);
        const vol = code === "000001" ? 0.35 : code === "000002" ? 0.15 : 0.40;
        return { code, name: `Fund-${code}`, riskMetrics: rm({ annualVol: vol }) };
      },
      fetchSymbolReturns: async (code) => {
        returnCalls.push(code);
        return makeReturns([0.01, -0.005, 0.02, -0.01, 0.015, 0.008, -0.003, 0.012, -0.008, 0.005]);
      },
    };

    const sample: SymbolProfile = { code: "sample", name: "sample", riskMetrics: rm({ annualVol: 0.35 }) };
    const id = await runComparison(symbols, {
      name: "test",
      rules: [volatilityRule(sample, 0.25)],
    }, ctx);

    expect(id).toMatch(/^cmp-/);
    expect(profileCalls).toEqual(symbols);
    expect(returnCalls.length).toBeGreaterThan(0);
  });

  it("runs pipeline with multiple rules", async () => {
    const symbols = ["000001", "000002"];
    const ctx: ComparisonContext = {
      fetchSymbolProfile: async (code) => ({
        code,
        name: `Fund-${code}`,
        sector: "科技",
        riskMetrics: rm({ annualVol: code === "000001" ? 0.35 : 0.15 }),
      }),
      fetchSymbolReturns: async (_code) => {
        return makeReturns([0.01, -0.005, 0.02, -0.01, 0.015]);
      },
    };

    const sample: SymbolProfile = { code: "sample", name: "sample", riskMetrics: rm({ annualVol: 0.35 }) };
    const id = await runComparison(symbols, {
      name: "multi-rule",
      rules: [volatilityRule(sample, 0.25), sectorRule("科技")],
    }, ctx);

    expect(id).toMatch(/^cmp-/);
  });

  it("throws when no symbols match rules", async () => {
    const ctx: ComparisonContext = {
      fetchSymbolProfile: async (code) => ({ code, name: `F-${code}`, riskMetrics: rm({ annualVol: 0.1 }) }),
      fetchSymbolReturns: async (_code) => makeReturns([0.01, 0.02]),
    };

    const sample: SymbolProfile = { code: "sample", name: "sample", riskMetrics: rm({ annualVol: 0.35 }) };
    await expect(
      runComparison(["000001"], { name: "empty", rules: [volatilityRule(sample, 0.25)] }, ctx),
    ).rejects.toThrow("No groups matched");
  });

  it("throws when no valid symbols to compare", async () => {
    const ctx: ComparisonContext = {
      fetchSymbolProfile: async (_code) => null,
      fetchSymbolReturns: async (_code) => new Map(),
    };
    await expect(
      runComparison(["000001"], { name: "empty", rules: [] }, ctx),
    ).rejects.toThrow("No valid symbols");
  });
});
