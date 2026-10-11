import { expect, it } from "bun:test";
import { runSkillGit } from "./git.ts";

it("runs actual Git without blocking the event loop", async () => {
  const result = await runSkillGit(["--version"], 5_000);
  expect(result).toStartWith("git version");
});

it("times out a Git process waiting for stdin", async () => {
  await expect(runSkillGit(["hash-object", "--stdin"], 100)).rejects.toThrow("timed out");
}, 15_000);

it("cancels a running Git process and keeps the event loop responsive", async () => {
  const abort = new AbortController();
  const operation = runSkillGit(["hash-object", "--stdin"], 10_000, abort.signal);
  let timerRan = false;
  const timer = setTimeout(() => { timerRan = true; abort.abort(); }, 50);
  try {
    await expect(operation).rejects.toThrow("cancelled");
    expect(timerRan).toBe(true);
  } finally { clearTimeout(timer); abort.abort(); }
}, 15_000);
