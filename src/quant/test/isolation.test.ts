import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

test.each(["bun", "node"])("quant public calculations run under %s without the application, installed packages or data files", runtime => {
  const root = mkdtempSync(join(tmpdir(), "whyj-isolated-quant-"));
  try {
    for (const module of ["quant", "market", "types"]) {
      cpSync(resolve(import.meta.dir, "../..", module), join(root, module), {
        recursive: true,
        filter: source => !["test", "tests", "fixtures"].includes(basename(source)) && !source.endsWith(".test.ts"),
      });
    }
    writeFileSync(join(root, "package.json"), '{"type":"module"}');
    writeFileSync(join(root, "host.ts"), `
import { strict as assert } from "node:assert";
import * as quant from "./quant/index.ts";
const prices = [100, 100, 110];
const ledger = quant.vectorizedBacktest([1, 1, 1], prices, 100000, 0);
assert.deepEqual(ledger.equity, [100000, 100000, 110000]);
assert.deepEqual(prices, [100, 100, 110]);
assert.ok(Math.abs(quant.momentum(prices, 1)[2] - 0.1) < 1e-12);
assert.ok(Math.abs(quant.metrics([0.1, -0.1]).maxDrawdown + 0.1) < 1e-12);
assert.equal(quant.calculateWeightedScore([{ name: "a", score: 80, weight: 0.25 }, { name: "b", score: 40, weight: 0.75 }]).score, 50);
assert.equal(quant.calculatePositionScenarios({ shares: 10, costPerShare: 100, observedClose: 120 }, [-0.5])[0].profitLoss, -400);
assert.equal(quant.compareTotalReturns(0.2, 0.1).direction, "outperformed");
assert.throws(() => quant.calculateWeightedScore([{ name: "a", score: 80, weight: 0.5 }]));
assert.equal("runComparison" in quant, false);
assert.equal("getQuotes" in quant, false);
console.log("isolated calculations passed");
`);
    const before = readdirSync(root).sort();
    const child = Bun.spawnSync([runtime === "bun" ? process.execPath : "node", join(root, "host.ts")], {
      cwd: root, env: { ...process.env, OHQUANT_DIR: join(root, "must-not-exist") },
      stdout: "pipe", stderr: "pipe", timeout: 10_000,
    });
    expect(new TextDecoder().decode(child.stderr)).toBe("");
    expect(child.exitCode).toBe(0);
    expect(new TextDecoder().decode(child.stdout).trim()).toBe("isolated calculations passed");
    expect(readdirSync(root).sort()).toEqual(before);
  } finally {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected isolated quant fixture root.");
    rmSync(root, { recursive: true, force: true });
  }
});
