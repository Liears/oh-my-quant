import { expect, it } from "bun:test";
import { inspectSkillReadiness } from "../readiness.ts";
import type { SkillPythonEvidence } from "../python-probe.ts";

const python: SkillPythonEvidence = { status: "observed", checkedAt: "2026-09-14T00:00:00Z", executable: "fixture-python", python: "3.12.1", packages: { requests: "2.32.0", yfinance: null, "pandas-market-calendars": "5.2.2" },
  imports: { requests: { status: "available" }, "pandas-market-calendars": { status: "available" } } };

it("does not grant package readiness from metadata when the package was not imported or its DLL failed", () => {
  const modes = [{ name: "calendar", requires: ["python:pandas-market-calendars==5.2.2"], optional: [] }];
  expect(inspectSkillReadiness(modes, {}, { ...python, imports: undefined }).status).toBe("unverified");
  const failed = { ...python, imports: { "pandas-market-calendars": { status: "missing" as const, error: "ImportError" } } };
  expect(inspectSkillReadiness(modes, {}, failed).status).toBe("blocked");
});

it("separates installed versions, missing packages, unknown network access and missing task inputs", () => {
  const result = inspectSkillReadiness([
    { name: "local calculation", requires: ["python>=3.9", "python:requests>=2.31.0", "user-supplied-evidence"], optional: ["FMP_API_KEY"] },
    { name: "network research", requires: ["python:yfinance>=0.2.0", "network:etf-history"], optional: [] },
    { name: "calendar", requires: ["python:pandas-market-calendars==5.2.2"], optional: [] },
  ], {}, python);
  expect(result.modes.map(mode => mode.status)).toEqual(["needs-input", "blocked", "requirements-met"]);
  expect(result.modes[1]!.requirements.map(item => item.status)).toEqual(["missing", "unverified"]);
  expect(result.modes[0]!.requirements.at(-1)?.status).toBe("input-required");
  expect(result.status).toBe("requirements-met");
  expect(result.checkedAt).toBe(python.checkedAt);
});

it("does not treat unchecked, old or prerelease package versions as satisfying requirements", () => {
  const modes = [{ name: "analysis", requires: ["python>=3.9", "python:requests>=2.31.0"], optional: [] }];
  expect(inspectSkillReadiness(modes, {}).status).toBe("unverified");
  expect(inspectSkillReadiness(modes, {}, { ...python, status: "missing-python" }).status).toBe("blocked");
  expect(inspectSkillReadiness(modes, {}, { ...python, python: "3.8.9" }).status).toBe("blocked");
  expect(inspectSkillReadiness(modes, {}, { ...python, packages: { requests: "2.30.99" } }).status).toBe("blocked");
  expect(inspectSkillReadiness(modes, {}, { ...python, packages: { requests: "2.31.0rc1" } }).status).toBe("unverified");
  expect(inspectSkillReadiness([{ name: "calendar", requires: ["python:pandas-market-calendars==5.2.1"], optional: [] }], {}, python).status).toBe("blocked");
});

it("keeps a missing host capability separate from another mode whose runtime requirements are met", () => {
  const result = inspectSkillReadiness([
    { name: "research", requires: ["web-search"], optional: [] },
    { name: "calendar", requires: ["python"], optional: [] },
  ], { "web-search": { requirement: "web-search", status: "missing", reason: "No search adapter" } }, python);
  expect(result.modes.map(mode => mode.status)).toEqual(["blocked", "requirements-met"]);
  expect(result.modes[0]!.requirements[0]!.reason).toBe("No search adapter");
});
