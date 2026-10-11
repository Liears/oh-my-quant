import { expect, test } from "bun:test";
import { nextInputAction } from "../src/input.ts";
import { QuantTui } from "../src/tui.ts";
import { createInitialAppState } from "../../app-runtime.ts";

test("bracketed paste waits across chunks and keeps multiline commands inert", () => {
  const partial = "\x1b[200~中文\r\n/exit\r";
  expect(nextInputAction(partial)).toEqual({ action: null, rest: partial });
  expect(nextInputAction(partial + "\x1b[201~\r")).toEqual({ action: { type: "paste", text: "中文\n/exit\n" }, rest: "\r" });
  expect(nextInputAction("\x1b[200~\x03\x04paste\x1b[201~").action).toEqual({ type: "paste", text: "paste" });
});

test("desktop copy sequence decodes the existing Ctrl+Shift+C shortcut", () => {
  expect(nextInputAction("\x1b[67;6u").action).toMatchObject({ type: "key", name: "c", ctrl: true, shift: true });
});

test("pasted slash commands remain in the composer until explicit Enter", () => {
  const tui = new QuantTui(createInitialAppState("test"));
  const internals = tui as unknown as { running: boolean; pendingInput: string; inputBuf: string; drainInput(): void; paint(): void };
  internals.paint = () => {};
  internals.running = true;
  const submissions: string[] = [];
  tui.onSubmit(text => { submissions.push(text); });
  internals.pendingInput = "\x1b[200~分析中文\r\n/exit\x1b[201~";
  internals.drainInput();
  expect(submissions).toEqual([]);
  expect(internals.inputBuf).toBe("分析中文\n/exit");
  internals.pendingInput = "\r";
  internals.drainInput();
  expect(submissions).toEqual(["分析中文\n/exit"]);
  internals.running = false;
});
