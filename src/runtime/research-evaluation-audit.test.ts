import { expect, test } from "bun:test";
import { auditPreparedRequest } from "./research-evaluation-audit.ts";

test("payload audit fingerprints actual schemas and instructions without exporting payload or credentials", () => {
  const payload = { messages: [{ role: "system", content: "Scoped instructions" }, { role: "user", content: "PRIVATE_TEXT" }],
    tools: [{ type: "function", function: { name: "study", description: "Contract", parameters: { type: "object" } } }], metadata: { token: "SECRET" } };
  const before = structuredClone(payload);
  const audit = auditPreparedRequest("openai-completions", payload, "research");
  expect(audit).toMatchObject({ scope: "prepared-payload", extraction: "openai-completions", toolNames: ["study"], phase: "research" });
  expect(audit.payloadHash).toHaveLength(64); expect(audit.instructionMessagesHash).toHaveLength(64);
  const changed = auditPreparedRequest("openai-completions", { ...payload, tools: [] }, "recovery");
  expect(changed.toolSchemasHash).not.toBe(audit.toolSchemasHash);
  expect(changed.instructionMessagesHash).toBe(audit.instructionMessagesHash);
  expect(JSON.stringify(audit)).not.toMatch(/PRIVATE_TEXT|SECRET|Scoped instructions|Contract/);
  expect(payload).toEqual(before);
});

test("unsupported or malformed protocols remain unmapped instead of falsely reporting an empty tool set", () => {
  for (const [api, payload] of [["anthropic-messages", { tools: [{ name: "study" }] }], ["openai-completions", { messages: [], tools: [{}] }],
    ["openai-completions", null]] as const) {
    expect(auditPreparedRequest(api, payload, "research")).toMatchObject({ extraction: "unsupported-or-invalid", toolNames: null, toolSchemasHash: null, instructionMessagesHash: null });
  }
  expect(auditPreparedRequest("openai-completions", { messages: [] }, "research").toolNames).toEqual([]);
});
