import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent } from "../src/session.ts";

let root = "";
let previousDir: string | undefined;
beforeEach(() => {
  previousDir = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "whyj-session-lifecycle-"));
  process.env.OHQUANT_DIR = root;
});
afterEach(() => {
  if (previousDir === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previousDir;
  rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const agent = createAgent({ cwd: root, sessionsRoot: join(root, "sessions"), settings: {
    model: "fixture", thinkingLevel: "off",
    env: { WHYJ_QUANT_BASE_URL: "https://unused.invalid/anthropic", WHYJ_QUANT_API_KEY: "fixture-key" },
    skillIntegrations: { external: false },
  } });
  const payloads: string[] = [];
  agent.subscribe((event) => {
    if (event.type === "before_provider_payload") {
      const payload = event.payload as { messages: unknown };
      payloads.push(JSON.stringify(payload.messages));
      throw new Error("fixture stops before network");
    }
  });
  return { agent, payloads };
}

it("isolates analysis context between Agent instances and resets only the selected instance", async () => {
  const first = fixture(), second = fixture();
  await Promise.all([first.agent.waitForIdle(), second.agent.waitForIdle()]);
  first.agent.updateContext({ lastSymbol: "AAPL", lastMarket: "US" });
  second.agent.updateContext({ lastSymbol: "000001.SZ", lastMarket: "A" });
  await first.agent.prompt("Continue");
  await second.agent.prompt("Continue");
  expect(first.payloads[0]).toContain("AAPL");
  expect(first.payloads[0]).not.toContain("000001.SZ");
  expect(second.payloads[0]).toContain("000001.SZ");
  expect(second.payloads[0]).not.toContain("AAPL");
  first.agent.reset();
  await first.agent.waitForIdle();
  await first.agent.prompt("Continue");
  expect(first.payloads.at(-1)).not.toContain("AAPL");
  await second.agent.prompt("Continue");
  expect(second.payloads.at(-1)).toContain("000001.SZ");
});

it("preserves a usable current session after a failed resume", async () => {
  const { agent, payloads } = fixture();
  await agent.appendContextNote("fixture", "Preserved research note");
  const previous = await agent.getSessionMetadata();
  const messages = structuredClone(agent.state.messages);
  agent.updateContext({ lastSymbol: "AAPL", lastMarket: "US" });
  await expect(agent.resumeSession("missing-session-id")).rejects.toThrow("Session not found");
  expect(await agent.getSessionMetadata()).toEqual(previous);
  expect(agent.state.messages).toEqual(messages);
  await agent.appendContextNote("fixture", "Further research note");
  await agent.prompt("Continue");
  expect(payloads.at(-1)).toContain("AAPL");
  expect(payloads.at(-1)).toContain("Preserved research note");
  expect(payloads.at(-1)).toContain("Further research note");
});

it("serializes repeated resets into clean independent session trees", async () => {
  const { agent } = fixture();
  await agent.appendContextNote("fixture", "Previous session content");
  const previous = await agent.getSessionMetadata();
  agent.reset();
  agent.reset();
  await agent.waitForIdle();
  expect((await agent.getSessionMetadata())?.id).not.toBe(previous?.id);
  expect(agent.state.messages).toEqual([]);
  await agent.appendContextNote("fixture", "New session content");
  expect(agent.state.messages).toHaveLength(1);
  await agent.resumeSession(previous!.id);
  expect(JSON.stringify(agent.state.messages)).toContain("Previous session content");
  expect(JSON.stringify(agent.state.messages)).not.toContain("New session content");
});
