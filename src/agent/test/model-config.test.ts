import { expect, it } from "bun:test";
import { getModels } from "../src/kernel/llm.ts";
import { resolveApiKey, resolveModel } from "../src/model-config.ts";

it("reads updated credentials each call and gives explicit settings priority", () => {
  const key = process.env.WHYJ_QUANT_API_KEY;
  const token = process.env.WHYJ_QUANT_AUTH_TOKEN;
  try {
    process.env.WHYJ_QUANT_API_KEY = "environment-key";
    process.env.WHYJ_QUANT_AUTH_TOKEN = "environment-token";
    expect(resolveApiKey({ WHYJ_QUANT_API_KEY: "settings-key", WHYJ_QUANT_AUTH_TOKEN: "settings-token" })).toBe("settings-key");
    expect(resolveApiKey({ WHYJ_QUANT_AUTH_TOKEN: "settings-token" })).toBe("settings-token");
    expect(resolveApiKey({})).toBe("environment-key");
    delete process.env.WHYJ_QUANT_API_KEY;
    expect(resolveApiKey({})).toBe("environment-token");
    process.env.WHYJ_QUANT_API_KEY = "rotated-key";
    expect(resolveApiKey({})).toBe("rotated-key");
  } finally {
    if (key === undefined) delete process.env.WHYJ_QUANT_API_KEY; else process.env.WHYJ_QUANT_API_KEY = key;
    if (token === undefined) delete process.env.WHYJ_QUANT_AUTH_TOKEN; else process.env.WHYJ_QUANT_AUTH_TOKEN = token;
  }
});

it("honors a custom protocol endpoint without mutating the upstream model catalog", () => {
  const before = structuredClone(getModels("minimax"));
  const completions = resolveModel("minimax", "MiniMax-M2.7", { WHYJ_QUANT_BASE_URL: "https://api.minimaxi.com/v1" });
  expect(completions.api).toBe("openai-completions");
  const anthropic = resolveModel("minimax", "MiniMax-M2.7", { WHYJ_QUANT_BASE_URL: "https://api.minimaxi.com/anthropic" });
  expect(anthropic.api).toBe("anthropic-messages");
  expect(getModels("minimax")).toEqual(before);
  expect(getModels("unknown-provider")).toEqual([]);
});
