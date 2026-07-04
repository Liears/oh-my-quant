import { describe, expect, it } from "bun:test";
import { collectDoctor, describeEndpointMode, formatDoctorText, runDoctor } from "./doctor.ts";
import { DEFAULT_SETTINGS } from "../types/config.ts";
import { existsSync, readFileSync } from "node:fs";

describe("doctor", () => {
  it("classifies /v1 endpoints as OpenAI-compatible before vendor labels", () => {
    expect(describeEndpointMode("https://api.deepseek.com/v1")).toBe("OpenAI Compatible");
    expect(describeEndpointMode("https://api.deepseek.com/anthropic")).toBe("Anthropic Messages");
  });

  it("reports missing credentials with actionable hints", async () => {
    const doctor = await collectDoctor(DEFAULT_SETTINGS, {}, { writeLog: false });
    expect(doctor.ready).toBe(true);
    expect(doctor.mode).toBe("first_setup");
    expect(doctor.overall).toBe("unconfigured");
    expect(doctor.phases.map((phase) => phase.status)).toEqual(["fail", "pass", "fail"]);
    expect(doctor.auth.WHYJ_QUANT_API_KEY).toEqual({ available: false, source: "missing", value: "-" });
    expect(doctor.hints).toEqual([
      expect.stringContaining("WHYJ_QUANT_API_KEY"),
      expect.stringContaining("WHYJ_QUANT_LLMQUANT_API_KEY"),
    ]);

    const text = formatDoctorText(doctor);
    expect(text).toContain("WhyJ Doctor");
    expect(text).toContain("command        whyj doctor");
    expect(text).toContain("Phases");
    expect(text).toContain("Credentials");
    expect(text).toContain("WHYJ_QUANT_API_KEY");
    expect(text).toContain("base url");
    expect(text).toContain("Hints");
    expect(text).not.toContain("secret");
  });

  it("renders phase warnings in the text report", async () => {
    const doctor = await collectDoctor({
      ...DEFAULT_SETTINGS,
      env: {
        WHYJ_QUANT_API_KEY: "provider-secret-1234",
        WHYJ_QUANT_BASE_URL: "https://api.deepseek.com/anthropic",
        WHYJ_QUANT_LLMQUANT_API_KEY: "llmq-secret-5678",
      },
    }, {
      WHYJ_DOCTOR_SKIP_NETWORK: "1",
    }, { writeLog: false });

    const text = formatDoctorText(doctor);
    expect(text).toContain("Network probe skipped by WHY");
  });

  it("keeps first-setup mode when only the base URL is configured", async () => {
    const doctor = await collectDoctor({
      ...DEFAULT_SETTINGS,
      env: {
        WHYJ_QUANT_BASE_URL: "https://api.deepseek.com/anthropic",
      },
    }, {}, { writeLog: false });

    expect(doctor.mode).toBe("first_setup");
    expect(doctor.overall).toBe("unconfigured");
  });

  it("prefers env source over config source and suppresses resolved hints", async () => {
    const doctor = await collectDoctor({
      ...DEFAULT_SETTINGS,
      env: {
        WHYJ_QUANT_API_KEY: "from-config",
        WHYJ_QUANT_BASE_URL: "https://api.deepseek.com/anthropic",
        WHYJ_QUANT_LLMQUANT_API_KEY: "from-config",
      },
    }, {
      WHYJ_QUANT_API_KEY: "from-env",
    }, {
      writeLog: false,
      modelProbe: async () => ({ ok: true, detail: "model probe ok" }),
      dataProbe: async () => ({ ok: true, detail: "data probe ok" }),
    });

    expect(doctor.auth.WHYJ_QUANT_API_KEY).toEqual(expect.objectContaining({
      available: true,
      source: "env",
      value: expect.stringContaining("from...-env"),
    }));
    expect(doctor.auth.WHYJ_QUANT_LLMQUANT_API_KEY).toEqual(expect.objectContaining({
      available: true,
      source: "config",
      value: expect.stringContaining("from...nfig"),
    }));
    expect(doctor.config.baseUrl).toBe("https://api.deepseek.com/anthropic");
    expect(doctor.config.endpointMode).toBe("Anthropic Messages");
    expect(doctor.overall).toBe("all_pass");
    expect(doctor.phases.map((phase) => phase.status)).toEqual(["pass", "pass", "pass"]);
    expect(doctor.hints).toEqual([]);
  });

  it("accepts legacy auth token as the model credential fallback", async () => {
    const doctor = await collectDoctor({
      ...DEFAULT_SETTINGS,
      env: {
        WHYJ_QUANT_AUTH_TOKEN: "legacy-provider-token",
        WHYJ_QUANT_BASE_URL: "https://api.deepseek.com/anthropic",
        WHYJ_QUANT_LLMQUANT_API_KEY: "llmq-secret-5678",
      },
    }, {}, {
      writeLog: false,
      modelProbe: async () => ({ ok: true, detail: "model probe ok" }),
      dataProbe: async () => ({ ok: true, detail: "data probe ok" }),
    });

    expect(doctor.auth.WHYJ_QUANT_API_KEY).toEqual({ available: false, source: "missing", value: "-" });
    expect(doctor.auth.WHYJ_QUANT_AUTH_TOKEN).toEqual(expect.objectContaining({
      available: true,
      source: "config",
      value: expect.stringContaining("lega...oken"),
    }));
    expect(doctor.mode).toBe("diagnostic");
    expect(doctor.overall).toBe("all_pass");
    expect(doctor.phases[0].status).toBe("pass");
    expect(doctor.phases[0].detail).toContain("model probe ok");
  });

  it("shows redacted concrete values and sanitizes broken ANSI fragments", async () => {
    const doctor = await collectDoctor({
      ...DEFAULT_SETTINGS,
      model: "deepseek-v4-pro\x1b[1m[1m]",
      thinkingLevel: "high",
      env: {
        WHYJ_QUANT_AUTH_TOKEN: "sk-test-secret-1234",
        WHYJ_QUANT_API_KEY: "provider-secret-1234",
        WHYJ_QUANT_BASE_URL: "https://api.deepseek.com/anthropic",
        WHYJ_QUANT_LLMQUANT_API_KEY: "llmq-secret-5678",
      },
    }, {}, {
      writeLog: false,
      modelProbe: async () => ({ ok: true, detail: "model probe ok" }),
      dataProbe: async () => ({ ok: true, detail: "data probe ok" }),
    });

    expect(doctor.config.model).toBe("deepseek-v4-pro");
    expect(doctor.config.baseUrl).toBe("https://api.deepseek.com/anthropic");
    expect(doctor.config.endpointMode).toBe("Anthropic Messages");
    expect(doctor.auth.WHYJ_QUANT_AUTH_TOKEN.value).toMatch(/^sk-t\.\.\.1234 · fp:[0-9a-f]{8}$/);
    expect(formatDoctorText(doctor)).toContain("value");
    expect(formatDoctorText(doctor)).not.toContain("[1m");
    expect(formatDoctorText(doctor)).not.toContain("sk-test-secret-1234");
  });

  it("marks partial failures without skipping later phases", async () => {
    const doctor = await collectDoctor({
      ...DEFAULT_SETTINGS,
      env: {
        WHYJ_QUANT_API_KEY: "provider-secret-1234",
        WHYJ_QUANT_BASE_URL: "https://api.deepseek.com/anthropic",
      },
    }, {}, {
      writeLog: false,
      modelProbe: async () => ({ ok: true, detail: "model probe ok" }),
    });

    expect(doctor.mode).toBe("diagnostic");
    expect(doctor.overall).toBe("partial_fail");
    expect(doctor.phases.map((phase) => phase.status)).toEqual(["pass", "pass", "fail"]);
    expect(doctor.phases[2].error).toContain("WHYJ_QUANT_LLMQUANT_API_KEY");
  });

  it("uses injected live probes and records successful probe details", async () => {
    const doctor = await collectDoctor({
      ...DEFAULT_SETTINGS,
      env: {
        WHYJ_QUANT_API_KEY: "provider-secret-1234",
        WHYJ_QUANT_BASE_URL: "https://api.deepseek.com/anthropic",
        WHYJ_QUANT_LLMQUANT_API_KEY: "llmq-secret-5678",
      },
    }, {}, {
      writeLog: false,
      modelProbe: async () => ({ ok: true, detail: "Anthropic Messages HTTP 200" }),
      dataProbe: async () => ({ ok: true, detail: "llmquant-data HTTP 200" }),
    });

    expect(doctor.overall).toBe("all_pass");
    expect(doctor.phases[0].detail).toContain("HTTP 200");
    expect(doctor.phases[1].detail).toContain("adapters ok");
    expect(doctor.phases[2].detail).toContain("llmquant-data HTTP 200");
  });

  it("resolves configured short model names before probing providers", async () => {
    let seenModel = "";
    const doctor = await collectDoctor({
      ...DEFAULT_SETTINGS,
      model: "sonnet",
      env: {
        WHYJ_DEFAULT_SONNET_MODEL: "glm-5.2",
        WHYJ_QUANT_API_KEY: "provider-secret-1234",
        WHYJ_QUANT_BASE_URL: "https://open.bigmodel.cn/api/anthropic",
        WHYJ_QUANT_LLMQUANT_API_KEY: "llmq-secret-5678",
      },
    }, {}, {
      writeLog: false,
      modelProbe: async (ctx) => {
        seenModel = ctx.state.config.model;
        return { ok: true, detail: "model probe ok" };
      },
      dataProbe: async () => ({ ok: true, detail: "data probe ok" }),
    });

    expect(seenModel).toBe("glm-5.2");
    expect(doctor.config.model).toBe("glm-5.2");
    expect(doctor.overall).toBe("all_pass");
  });

  it("writes redacted diagnostic logs for probe failures", async () => {
    const doctor = await collectDoctor({
      ...DEFAULT_SETTINGS,
      env: {
        WHYJ_QUANT_API_KEY: "sk-test-secret-1234",
        WHYJ_QUANT_BASE_URL: "https://api.deepseek.com/anthropic",
        WHYJ_QUANT_LLMQUANT_API_KEY: "llmq-secret-5678",
      },
    }, {}, {
      modelProbe: async () => ({ ok: false, detail: "HTTP 401 Authorization: Bearer sk-test-secret-1234" }),
      dataProbe: async () => ({ ok: true, detail: "llmquant-data HTTP 200" }),
    });

    expect(doctor.overall).toBe("partial_fail");
    expect(doctor.logPath).toBeTruthy();
    expect(existsSync(doctor.logPath!)).toBe(true);
    const log = readFileSync(doctor.logPath!, "utf8");
    expect(log).not.toContain("sk-test-secret-1234");
    expect(log).not.toContain("Authorization: Bearer sk-test-secret-1234");
    expect(log).toContain("sk-[redacted]");
  });

  it("supports partial phase reruns with a seeded previous doctor state", async () => {
    const base = await collectDoctor({
      ...DEFAULT_SETTINGS,
      env: {
        WHYJ_QUANT_API_KEY: "provider-secret-1234",
        WHYJ_QUANT_BASE_URL: "https://api.deepseek.com/anthropic",
      },
    }, {}, {
      writeLog: false,
      modelProbe: async () => ({ ok: true, detail: "model probe ok" }),
    });

    const retried = await collectDoctor({
      ...DEFAULT_SETTINGS,
      env: {
        WHYJ_QUANT_API_KEY: "provider-secret-1234",
        WHYJ_QUANT_BASE_URL: "https://api.deepseek.com/anthropic",
      },
    }, {}, {
      writeLog: false,
      phases: ["tools"],
      seedState: base,
      modelProbe: async () => ({ ok: true, detail: "should not run" }),
      dataProbe: async () => ({ ok: true, detail: "should not run" }),
    });

    expect(retried.phases[0]).toEqual(base.phases[0]);
    expect(retried.phases[1].status).toBe("pass");
    expect(retried.phases[2]).toEqual(base.phases[2]);
    expect(retried.overall).toBe("partial_fail");
  });

  it("streams only requested phases for partial reruns", async () => {
    const base = await collectDoctor({
      ...DEFAULT_SETTINGS,
      env: {
        WHYJ_QUANT_API_KEY: "provider-secret-1234",
        WHYJ_QUANT_BASE_URL: "https://api.deepseek.com/anthropic",
        WHYJ_QUANT_LLMQUANT_API_KEY: "llmq-secret-5678",
      },
    }, {}, {
      writeLog: false,
      modelProbe: async () => ({ ok: true, detail: "model ok" }),
      dataProbe: async () => ({ ok: true, detail: "data ok" }),
    });

    const states: string[][] = [];
    for await (const state of runDoctor({
      ...DEFAULT_SETTINGS,
      env: {
        WHYJ_QUANT_API_KEY: "provider-secret-1234",
        WHYJ_QUANT_BASE_URL: "https://api.deepseek.com/anthropic",
        WHYJ_QUANT_LLMQUANT_API_KEY: "llmq-secret-5678",
      },
    }, {}, {
      writeLog: false,
      phases: ["tools"],
      seedState: base,
      modelProbe: async () => ({ ok: true, detail: "should not run" }),
      dataProbe: async () => ({ ok: true, detail: "should not run" }),
    })) {
      states.push(state.phases.map((phase) => phase.status));
    }

    expect(states).toEqual([
      ["pass", "checking", "pass"],
      ["pass", "pass", "pass"],
    ]);
  });

  it("falls back to a full rerun when the seeded doctor snapshot no longer matches current config", async () => {
    const states: string[][] = [];
    for await (const state of runDoctor({
      ...DEFAULT_SETTINGS,
      env: {
        WHYJ_QUANT_API_KEY: "provider-secret-9999",
        WHYJ_QUANT_BASE_URL: "https://open.bigmodel.cn/api/anthropic",
        WHYJ_QUANT_LLMQUANT_API_KEY: "llmq-secret-5678",
      },
    }, {}, {
      writeLog: false,
      phases: ["tools"],
      seedState: {
        ready: true,
        mode: "diagnostic",
        overall: "all_pass",
        phases: [
          { phase: "model", status: "pass", label: "Model", detail: "old model ok" },
          { phase: "tools", status: "pass", label: "Tools", detail: "old tools ok" },
          { phase: "data", status: "pass", label: "Data", detail: "old data ok" },
        ],
        auth: {
          WHYJ_QUANT_API_KEY: { available: true, source: "config", value: "prov...1234" },
          WHYJ_QUANT_AUTH_TOKEN: { available: false, source: "missing", value: "-" },
          WHYJ_QUANT_BASE_URL: { available: true, source: "config", value: "https://api.deepseek.com/anthropic" },
          WHYJ_QUANT_TUSHARE_TOKEN: { available: false, source: "missing", value: "-" },
          WHYJ_QUANT_LLMQUANT_API_KEY: { available: true, source: "config", value: "llmq...5678" },
          WHYJ_QUANT_FINANCIAL_DATASETS_KEY: { available: false, source: "missing", value: "-" },
        },
        config: {
          settingsPath: ".ohquant/settings.json",
          model: "deepseek-v4-pro",
          baseUrl: "https://api.deepseek.com/anthropic",
          endpointMode: "Anthropic Messages",
          dataSource: "llmquant-data",
        },
        hints: [],
      },
      modelProbe: async () => ({ ok: true, detail: "model probe ok" }),
      dataProbe: async () => ({ ok: true, detail: "data probe ok" }),
    })) {
      states.push(state.phases.map((phase) => phase.status));
    }

    expect(states).toEqual([
      ["checking", "pending", "pending"],
      ["pass", "pending", "pending"],
      ["pass", "checking", "pending"],
      ["pass", "pass", "pending"],
      ["pass", "pass", "checking"],
      ["pass", "pass", "pass"],
    ]);
  });
});
