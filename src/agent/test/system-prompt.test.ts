import { expect, test } from "bun:test";
import { formatSystemPrompt } from "../src/system-prompt.ts";

test("empty, custom and shell request snapshots do not advertise absent capabilities", () => {
  const empty = formatSystemPrompt({ tools: [], cached: [{ symbol: "AAPL", source: "fixture", bars: 40 }] });
  expect(empty).toContain("Current active tools: none.");
  expect(empty).toContain("availability is not a tool capability");
  expect(empty).not.toMatch(/fetch_bars|run_backtest|## Shell execution/);
  const custom = formatSystemPrompt({ tools: [{ name: "custom_study" }] });
  expect(custom).toContain("Current active tools: custom_study.");
  expect(custom).not.toMatch(/compute_factor|check_risk|fund_dca_backtest/);
  const shell = formatSystemPrompt({ tools: [{ name: "bash" }] });
  expect(shell).toContain("## Shell execution"); expect(shell).toContain("Get-Content path -Encoding utf8");
  expect(shell).toContain("system temp directory");
  expect(() => formatSystemPrompt({ tools: [{ name: "same" }, { name: "same" }] })).toThrow("Duplicate tools");
});

test("assembly preserves source metadata and honors disabled skill invocation without mutating snapshots", () => {
  const skills = [{ name: "usable", description: "Use supplied research", content: "Full body must not be indexed", filePath: "memory://usable" },
    { name: "blocked", description: "Missing runtime", content: "Unavailable body", filePath: "memory://blocked", disableModelInvocation: true }];
  const original = structuredClone(skills);
  const prompt = formatSystemPrompt({ tools: [], skills, extra: "Host policy" });
  expect(prompt).toContain("<name>usable</name>"); expect(prompt).not.toContain("<name>blocked</name>");
  expect(prompt).not.toContain("Full body must not be indexed"); expect(prompt).toContain("Host policy");
  expect(skills).toEqual(original);
});
