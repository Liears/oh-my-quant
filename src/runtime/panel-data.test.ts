import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createStoragePanelDataService } from "./panel-data.ts";
import { loadArtifact, saveArtifact } from "../storage/index.ts";

const OHQ = join(process.cwd(), ".ohquant-test-panel-data");

beforeEach(() => {
  process.env.OHQUANT_DIR = OHQ;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
  mkdirSync(OHQ, { recursive: true });
});

afterEach(() => {
  delete process.env.OHQUANT_DIR;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
});

describe("runtime panel data service", () => {
  it("wraps storage-backed settings and display helpers for TUI panels", () => {
    const service = createStoragePanelDataService();
    const settings = service.loadSettings();
    settings.env.WHYJ_QUANT_API_KEY = "secret";
    settings.env.WHYJ_QUANT_BASE_URL = "https://api.example.com\u001b[1m";
    settings.preferences.currentPortfolioFile = "alpha.json";
    service.saveSettings(settings);

    const reloaded = service.loadSettings();
    expect(reloaded.preferences.currentPortfolioFile).toBe("alpha.json");
    expect(service.hasWhyjEnvValue(reloaded.env, "apiKey")).toBe(true);
    expect(service.stripTerminalControlCodes(reloaded.env.WHYJ_QUANT_BASE_URL!)).toBe("https://api.example.com");
  });

  it("removes orphaned reports before showing the Artifact panel", () => {
    const sessionId = "kept-session";
    const sessionDir = join(OHQ, "sessions", "--test--");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, `${sessionId}.jsonl`), JSON.stringify({
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: "2026-07-13T00:00:00.000Z",
      cwd: process.cwd(),
    }), "utf-8");
    saveArtifact("kept-report", "<html>kept</html>", { sourceSessionId: sessionId });
    saveArtifact("orphan-report", "<html>orphan</html>", { sourceSessionId: "missing-session" });

    const reports = createStoragePanelDataService().listArtifacts();

    expect(reports.map((report) => report.sessionId)).toEqual(["kept-report"]);
    expect(loadArtifact("orphan-report")).toBeNull();
  });
});
