import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { saveSettings } from "../storage/index.ts";
import { DEFAULT_SETTINGS } from "../types/config.ts";
import { createStorageSourceProviderOptions } from "./source-runtime.ts";

const OHQ = join(process.cwd(), ".ohquant-test-source-runtime");

beforeEach(() => {
  process.env.OHQUANT_DIR = OHQ;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
  mkdirSync(OHQ, { recursive: true });
});

afterEach(() => {
  delete process.env.OHQUANT_DIR;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
});

describe("storage source runtime", () => {
  it("passes settings-backed provider credentials into source adapters", () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      env: {
        WHYJ_QUANT_TUSHARE_TOKEN: "test-tushare-token",
        WHYJ_QUANT_LLMQUANT_API_KEY: "test-llmquant-key",
        WHYJ_QUANT_FINANCIAL_DATASETS_KEY: "test-financial-key",
      },
    });

    const providers = createStorageSourceProviderOptions();
    expect(providers.tushare?.token).toBe("test-tushare-token");
    expect(providers.llmquant?.apiKey).toBe("test-llmquant-key");
    expect(providers.financialDatasets?.apiKey).toBe("test-financial-key");
  });
});
