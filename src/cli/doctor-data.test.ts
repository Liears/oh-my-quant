import { expect, it } from "bun:test";
import { collectDoctor, formatDoctorText } from "./doctor.ts";
import { DEFAULT_SETTINGS } from "../types/config.ts";
import type { DataProbeRequest } from "../types/data-readiness.ts";

it("does not declare a data source usable when HTTP 200 contains no market observations", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ prices: [] }) });
  const previous = process.env.NO_PROXY;
  process.env.NO_PROXY = "127.0.0.1,localhost";
  try {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.preferences.source = "financial-datasets";
    settings.env.WHYJ_QUANT_FINANCIAL_DATASETS_KEY = "synthetic-data-key";
    const result = await collectDoctor(settings, { FINANCIAL_DATASETS_BASE_URL: String(server.url).replace(/\/$/, "") },
      { phases: ["data"], writeLog: false, skipNetwork: false });
    expect(result.phases[2].status).toBe("fail");
    expect(result.phases[2].detail).toContain("empty");
  } finally {
    server.stop(true);
    if (previous === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = previous;
  }
});

it("reports the exact sample and saved credential source through Doctor and invalidates results when the sample changes", async () => {
  const captured: Array<{ key: string | null; ticker: string | null }> = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
    captured.push({ key: req.headers.get("x-api-key"), ticker: new URL(req.url).searchParams.get("ticker") });
    return Response.json({ prices: [{ date: "2025-01-06", open: 10, high: 10, low: 10, close: 10, volume: 1 }] });
  } });
  const previous = process.env.NO_PROXY; process.env.NO_PROXY = "127.0.0.1,localhost";
  try {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.preferences.source = "financial-datasets";
    settings.env = { WHYJ_QUANT_FINANCIAL_DATASETS_KEY: "synthetic-saved-key", FINANCIAL_DATASETS_BASE_URL: String(server.url).replace(/\/$/, "") };
    const dataRequest: DataProbeRequest = { source: "financial-datasets", market: "US", symbol: "AAPL", start: "2025-01-06", end: "2025-01-17" };
    const result = await collectDoctor(settings, { WHYJ_QUANT_FINANCIAL_DATASETS_KEY: "synthetic-env-key", FINANCIAL_DATASETS_BASE_URL: "http://127.0.0.1:1" },
      { phases: ["data"], writeLog: false, skipNetwork: false, dataRequest });
    expect(result.phases[2]).toMatchObject({ status: "pass", data: { ...dataRequest, status: "ready", rowCount: 1, credentialSource: "config" } });
    expect(result.auth.WHYJ_QUANT_FINANCIAL_DATASETS_KEY?.source).toBe("config");
    expect(captured).toEqual([{ key: "synthetic-saved-key", ticker: "AAPL" }]);
    expect(formatDoctorText(result)).toContain("AAPL · 2025-01-06 → 2025-01-17");
    expect(JSON.stringify(result)).not.toContain("synthetic-saved-key");
    const rerun = await collectDoctor(settings, { WHYJ_QUANT_FINANCIAL_DATASETS_KEY: "synthetic-env-key" },
      { phases: ["tools"], writeLog: false, skipNetwork: false, dataRequest: { ...dataRequest, symbol: "MSFT" }, seedState: result });
    expect(rerun.phases[2].status).toBe("pending"); expect(captured).toHaveLength(1);
  } finally {
    server.stop(true);
    if (previous === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = previous;
  }
});

it("cancels an injected probe, stops later phases, and keeps the configuration snapshot", async () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.env.WHYJ_QUANT_LLMQUANT_API_KEY = "synthetic-original-key";
  const controller = new AbortController(); let signal: AbortSignal | undefined;
  const pending = collectDoctor(settings, {}, { phases: ["data", "tools"], signal: controller.signal, writeLog: false,
    dataProbe: async ctx => {
      signal = ctx.signal;
      expect(ctx.settings.env.WHYJ_QUANT_LLMQUANT_API_KEY).toBe("synthetic-original-key");
      controller.abort(new Error("PRIVATE_CANCEL"));
      return new Promise(() => {});
    },
  });
  settings.env.WHYJ_QUANT_LLMQUANT_API_KEY = "synthetic-changed-key";
  const result = await pending;
  expect(signal?.aborted).toBe(true);
  expect(result.phases[2].status).toBe("fail"); expect(result.phases[2].detail).toContain("cancelled");
  expect(result.phases[1].status).toBe("pending"); expect(JSON.stringify(result)).not.toContain("PRIVATE_CANCEL");
});
