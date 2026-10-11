import { expect, it } from "bun:test";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import { mapPiConnection } from "../src/pi-config-import.ts";
import { modelProviders, providerModels, resolveConfiguredAuth, resolveConfiguredModel } from "../src/model-config.ts";
import { selectModelProvider } from "../../runtime/model-settings.ts";
import { completeSimple, getModels } from "../src/kernel/llm.ts";

const input = {
  models: { providers: {
    desk: { baseUrl: "http://localhost:1234/v1", api: "openai-completions", models: [
      { id: "shared", name: "Desk chat" }, { id: "responses", api: "openai-responses", maxTokens: 300 },
    ] },
    lab: { baseUrl: "http://localhost:2345/v1", api: "anthropic-messages", models: [{ id: "shared" }] },
  } },
  auth: { desk: { type: "api_key", key: "desk-secret" }, lab: { type: "api_key", key: "lab-secret" } },
  settings: { defaultThinkingLevel: "off" },
};

it("retains named providers, their models and protocol overrides without changing the global catalog", async () => {
  const catalog = structuredClone(getModels("openai"));
  const original = structuredClone(DEFAULT_SETTINGS);
  const desk = mapPiConnection(input, original, { provider: "desk", model: "shared" }, {}).draft;
  const responses = mapPiConnection(input, desk, { provider: "desk", model: "responses" }, {}).draft;
  const both = mapPiConnection(input, responses, { provider: "lab", model: "shared" }, {}).draft;
  expect(Object.keys(both.providers!)).toEqual(["desk", "lab"]);
  expect(both.providers!.custom).toBeUndefined();
  expect(modelProviders(both).filter(item => ["desk", "lab"].includes(item.id)).map(item => item.id)).toEqual(["desk", "lab"]);
  expect(modelProviders(original).some(item => item.id === "desk")).toBe(false);
  expect(providerModels("desk", both)).toMatchObject([
    { id: "shared", name: "Desk chat", api: "openai-completions" }, { id: "responses", api: "openai-responses", maxTokens: 300 },
  ]);
  selectModelProvider(both, "desk");
  expect(both.model).toBe("responses");
  expect(resolveConfiguredModel(both)).toMatchObject({ provider: "desk", api: "openai-responses", baseUrl: "http://localhost:1234/v1" });
  expect((await resolveConfiguredAuth(both))!.auth.apiKey).toBe("desk-secret");
  selectModelProvider(both, "lab");
  expect(both.model).toBe("shared");
  expect((await resolveConfiguredAuth(both))!.auth.apiKey).toBe("lab-secret");
  expect(desk.providers!.desk!.models!.responses).toBeUndefined();
  expect(original.providers).toBeUndefined();
  expect(getModels("openai")).toEqual(catalog);
});

it("does not silently accept an unknown provider or bypass a built-in OAuth provider", async () => {
  const draft = { ...structuredClone(DEFAULT_SETTINGS), provider: "typo", model: "shared", providers: { typo: { baseUrl: "http://localhost:1234/v1" } } };
  expect(() => resolveConfiguredModel(draft)).toThrow("Unknown model provider");
  const oauth = { ...draft, provider: "openai-codex", providers: { "openai-codex": { custom: true, apiKey: "must-not-bypass" } } };
  await expect(resolveConfiguredAuth(oauth)).rejects.toThrow("OAuth");
  const named = mapPiConnection(input, draft, { provider: "desk", model: "shared" }, {}).draft;
  delete named.providers!.desk!.baseUrl;
  expect(() => resolveConfiguredModel(named)).toThrow("base URL");
});

it("reimports provider credentials while keeping other models and replacing only selected metadata", () => {
  const first = mapPiConnection(input, structuredClone(DEFAULT_SETTINGS), { provider: "desk", model: "shared" }, {}).draft;
  first.providers!.desk!.models!.shared!.contextWindow = 77777;
  const nextInput = structuredClone(input);
  nextInput.auth.desk.key = "new-secret";
  nextInput.models.providers.desk.api = "anthropic-messages";
  const second = mapPiConnection(nextInput, first, { provider: "desk", model: "responses" }, {}).draft;
  expect(second.providers!.desk!.models!.shared).toMatchObject({ api: "openai-completions", contextWindow: 77777 });
  expect(second.providers!.desk!.apiKey).toBe("new-secret");
  const reimport = mapPiConnection(nextInput, second, { provider: "desk", model: "shared" }, {}).draft;
  expect(reimport.providers!.desk!.models!.shared).toMatchObject({ api: "anthropic-messages", contextWindow: 128000 });
  expect(reimport.providers!.desk!.models!.responses!.api).toBe("openai-responses");
});

it("retains a manually entered model and its previous default protocol during import", () => {
  const current = { ...structuredClone(DEFAULT_SETTINGS), provider: "desk", model: "manual", providers: {
    desk: { custom: true, api: "anthropic-messages" as const, baseUrl: "http://localhost:1234/v1" },
  } };
  const draft = mapPiConnection(input, current, { provider: "desk", model: "shared" }, {}).draft;
  expect(providerModels("desk", draft).map(model => model.id)).toEqual(["manual", "shared"]);
  expect(resolveConfiguredModel({ ...draft, model: "manual" }).api).toBe("anthropic-messages");
});

it.each([" desk", "desk ", "__proto__", "constructor", "bad\nname"])("rejects ambiguous provider identifier %s", provider => {
  expect(() => mapPiConnection(input, structuredClone(DEFAULT_SETTINGS), { provider, model: "shared" }, {})).toThrow("identifier");
});

it.each([
  ["desk", "shared", "messages"], ["desk", "responses", "input"], ["lab", "shared", "messages"],
])("uses Pi's actual protocol payload for %s/%s", async (provider, model, messageField) => {
  const draft = mapPiConnection(input, structuredClone(DEFAULT_SETTINGS), { provider, model }, {}).draft;
  const auth = await resolveConfiguredAuth(draft);
  let payload: unknown;
  const reply = await completeSimple(resolveConfiguredModel(draft), { messages: [{ role: "user", content: "fixture", timestamp: 0 }] }, {
    ...auth!.auth, env: auth!.env,
    onPayload: value => { payload = value; throw new Error("fixture stops before network"); },
  });
  expect(payload).toMatchObject({ model, [messageField]: expect.any(Array) });
  expect(reply.errorMessage).toContain("fixture stops before network");
});
