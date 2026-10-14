import { expect, it } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { prepareRuntimeSkills, scopeRuntimeSkills } from "../skills/skill-readiness.ts";
import { checkSkillPython } from "../../skill/python-probe.ts";
import { formatSkillsForSystemPrompt } from "../../agent/src/session-runtime/index.ts";
import type { QuantSkill } from "../../agent/src/skills.ts";
import { checkSkillFiles } from "../../skill/file-probe.ts";
import { CURATED_SKILL_REPOSITORIES } from "../../skill/catalog.ts";
import { checkEtfNetwork } from "../../skill/etf-network-probe.ts";
import { checkSkillNetwork } from "../../skill/network-probe.ts";

it("projects mode-scoped capabilities into the model index without assigning curated policy to a shadow skill", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-runtime-skill-readiness-")), previous = process.env.OHQUANT_SKILLS_DIR;
  process.env.OHQUANT_SKILLS_DIR = root;
  const fixture = (name: string, repo = "tradermonty-claude-trading-skills"): QuantSkill => ({ name, description: "Research fixture", content: "Fixture", filePath: join(root, repo, "skills", name, "SKILL.md"), sourcePath: root, source: "pi", scope: "project" });
  try {
    const skills = [fixture("market-environment-analysis"), fixture("position-sizer"), fixture("technical-analyst"), fixture("llmquant-risk", "LLMQuant-skills")];
    const unchecked = prepareRuntimeSkills(skills, [{ name: "bash" }], root);
    expect(unchecked.map(skill => skill.readiness?.status)).toEqual(["unverified", "blocked", "unverified", "unverified"]);
    expect(formatSkillsForSystemPrompt(unchecked)).not.toContain("<name>market-environment-analysis</name>");
    expect(formatSkillsForSystemPrompt(unchecked)).not.toContain("<name>llmquant-risk</name>");
    const reviewedLlmquant = prepareRuntimeSkills([skills[3]!], [{ name: "bash" }], root, { readReviewedFiles: () => ({
      requirement: "reviewed-script-files", status: "available", reason: "Fixed fixture content verified." }) })[0]!;
    expect(reviewedLlmquant.readiness?.modes.map(mode => mode.status)).toEqual(["blocked", "needs-input"]);
    expect(reviewedLlmquant.disableModelInvocation).toBe(false);
    expect(formatSkillsForSystemPrompt([reviewedLlmquant])).toContain("limited supplied evidence");
    expect(prepareRuntimeSkills(skills, [], root).every(skill => skill.disableModelInvocation)).toBe(true);
    await checkSkillPython(root, undefined, async () => ({ stdout: JSON.stringify({ python: "3.12.1", executable: "fixture-python", packages: { requests: "2.32.0", yfinance: null, "pandas-market-calendars": "5.2.2" } }), stderr: "" }));
    const checked = prepareRuntimeSkills(skills, [{ name: "bash" }], root);
    expect(checked[0]!.readiness?.modes.map(mode => mode.status)).toEqual(["blocked", "unverified"]);
    expect(checked[0]!.description).not.toContain("permitted modes: exchange calendar helper");
    const environmentManifest = CURATED_SKILL_REPOSITORIES[1]!.skills.find(item => item.name === "market-environment-analysis")!.reviewedFiles!;
    expect(checkSkillFiles(root, skills[0]!.filePath, environmentManifest).status).toBe("missing");
    const checkedEnvironment = prepareRuntimeSkills([skills[0]!], [{ name: "bash" }], root)[0]!;
    expect(checkedEnvironment.readiness?.modes.map(mode => mode.status)).toEqual(["blocked", "blocked"]);
    expect(checkedEnvironment.disableModelInvocation).toBe(true);
    const reviewedEnvironment = prepareRuntimeSkills([skills[0]!], [{ name: "bash" }], root, { readReviewedFiles: () => ({
      requirement: "reviewed-script-files", status: "available", reason: "Fixed fixture content verified." }) })[0]!;
    expect(reviewedEnvironment.readiness?.modes.map(mode => mode.status)).toEqual(["blocked", "unverified"]);
    await checkSkillPython(root, undefined, async () => ({ stdout: JSON.stringify({ python: "3.12.1", executable: "fixture-python",
      packages: { requests: "2.32.0", yfinance: null, "pandas-market-calendars": "5.2.2" },
      imports: { "pandas-market-calendars": { status: "available" } } }), stderr: "" }), ["pandas-market-calendars"]);
    const importedEnvironment = prepareRuntimeSkills([skills[0]!], [{ name: "bash" }], root, { readReviewedFiles: () => ({
      requirement: "reviewed-script-files", status: "available", reason: "Fixed fixture content verified." }) })[0]!;
    expect(importedEnvironment.readiness?.modes.map(mode => mode.status)).toEqual(["blocked", "requirements-met"]);
    expect(importedEnvironment.description).toContain("permitted modes: exchange calendar helper");
    expect(checked[1]!.readiness?.status).toBe("blocked");
    expect(checked[1]!.readiness?.modes[0]?.requirements.find(item => item.requirement === "private-output-authorization")?.status).toBe("missing");
    const positionManifest = CURATED_SKILL_REPOSITORIES[1]!.skills.find(item => item.name === "position-sizer")!.reviewedFiles!;
    expect(checkSkillFiles(root, skills[1]!.filePath, positionManifest).status).toBe("missing");
    const checkedPosition = prepareRuntimeSkills([skills[1]!], [{ name: "bash" }], root)[0]!;
    expect(checkedPosition.readiness?.modes[0]?.requirements.find(item => item.requirement === "reviewed-script-files")?.status).toBe("missing");
    expect(checkedPosition.disableModelInvocation).toBe(true);
    const shadow = { ...skills[1]!, filePath: join(root, ".agents", "skills", "position-sizer", "SKILL.md") };
    expect(prepareRuntimeSkills([shadow], [], root)[0]).toEqual(shadow);
    expect(skills[0]!.description).toBe("Research fixture");
    const prepared = [importedEnvironment, ...checked.slice(1)];
    const scoped = scopeRuntimeSkills(skills, prepared, ["research_task", "run_backtest"]);
    expect(scoped.every(skill => skill.disableModelInvocation)).toBe(true);
    expect(scoped[0]!.readiness?.checkedAt).toBe(importedEnvironment.readiness?.checkedAt);
    expect(scoped[0]!.readiness?.modes[1]?.requirements.find(item => item.requirement.startsWith("python:")))
      .toEqual(importedEnvironment.readiness?.modes[1]?.requirements.find(item => item.requirement.startsWith("python:")));
    expect(scoped[0]!.description).not.toContain("permitted modes: exchange calendar helper");
    expect(scopeRuntimeSkills(skills, prepared, ["bash"])).toEqual(prepared);
    expect(importedEnvironment.readiness?.status).toBe("requirements-met");
    const disabled = { ...shadow, disableModelInvocation: true, readiness: { status: "requirements-met" as const,
      modes: [{ name: "text", status: "requirements-met" as const, requirements: [] }] } };
    expect(scopeRuntimeSkills([shadow], [disabled], ["research_task"])[0]!.disableModelInvocation).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previous;
    const within = relative(realpathSync(tmpdir()), realpathSync(root));
    if (!within.startsWith("whyj-runtime-skill-readiness-") || within.includes(sep)) throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});

it("accepts explicit trusted host capabilities while keeping shell and local-file access bound to active tools", () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-runtime-skill-readiness-")), previous = process.env.OHQUANT_SKILLS_DIR;
  process.env.OHQUANT_SKILLS_DIR = root;
  const fixture = (name: string, repo = "tradermonty-claude-trading-skills"): QuantSkill => ({ name, description: "Host fixture", content: "Fixture",
    filePath: join(root, repo, "skills", name, "SKILL.md"), sourcePath: root, source: "pi", scope: "project" });
  const capability = (requirement: string) => ({ requirement: "ignored-host-label", status: "available" as const, reason: `${requirement} supplied by the trusted fixture host.`,
    ...(requirement === "web-search" ? { requiresTools: ["fixture_web_search"] } : {}) });
  const hostCapabilities = Object.fromEntries([
    "web-search", "model-image-input", "private-output-authorization", "llmquant-research-data", "python", "python>=3.9",
    "python:requests", "python:requests>=2.31.0", "python:yfinance>=0.2.0", "python:pandas-market-calendars==5.2.2",
    "network:tradermonty-breadth-csv", "network:etf-history", "FMP_API_KEY", "network:fmp-eod",
    "shell-execution", "local-resource-read",
  ].map(requirement => [requirement, capability(requirement)]));
  const skills = [fixture("market-breadth-analyzer"), fixture("technical-analyst"), fixture("position-sizer"),
    fixture("macro-regime-detector"), fixture("market-environment-analysis"), fixture("llmquant-risk", "LLMQuant-skills")];
  const sources = { readCapabilities: () => hostCapabilities, readReviewedFiles: () => ({
    requirement: "reviewed-script-files", status: "available" as const, reason: "Reviewed fixture closure supplied." }) };
  try {
    const prepared = prepareRuntimeSkills(skills, [{ name: "bash" }, { name: "fixture_web_search" }], root, sources);
    expect(prepared.map(skill => skill.readiness?.status)).toEqual([
      "requirements-met", "needs-input", "needs-input", "requirements-met", "requirements-met", "requirements-met",
    ]);
    expect(prepared[1]!.readiness?.modes.map(mode => mode.status)).toEqual(["needs-input", "needs-input"]);
    expect(prepared[4]!.readiness?.modes.map(mode => mode.status)).toEqual(["requirements-met", "requirements-met"]);
    expect(prepared[5]!.readiness?.modes.map(mode => mode.status)).toEqual(["requirements-met", "needs-input"]);
    expect(prepared.every(skill => !skill.disableModelInvocation)).toBe(true);
    expect(prepared[4]!.readiness?.modes[0]?.requirements.find(item => item.requirement === "web-search")).toMatchObject({
      requirement: "web-search", status: "available", requiresTools: ["fixture_web_search"],
    });
    const taskScoped = scopeRuntimeSkills(skills, prepared, ["bash"]);
    expect(taskScoped[4]!.readiness?.modes[0]?.requirements.find(item => item.requirement === "web-search")).toMatchObject({ status: "missing" });
    expect(taskScoped[4]!.description).not.toContain("permitted modes: market research");
    const withoutBash = prepareRuntimeSkills(skills, [], root, sources);
    expect(withoutBash.every(skill => skill.readiness?.status === "blocked")).toBe(true);
    expect(withoutBash.every(skill => skill.disableModelInvocation)).toBe(true);
    expect(withoutBash[0]!.readiness?.modes[0]?.requirements.find(item => item.requirement === "shell-execution")?.reason).toContain("active bash tool");
    expect(withoutBash[5]!.readiness?.modes[0]?.requirements.find(item => item.requirement === "local-resource-read")?.status).toBe("missing");
  } finally {
    if (previous === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previous;
    const within = relative(realpathSync(tmpdir()), realpathSync(root));
    if (!within.startsWith("whyj-runtime-skill-readiness-") || within.includes(sep)) throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});

it("blocks an old technical install missing the reviewed scripts and never accepts arbitrary prices as FMP access", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-runtime-skill-readiness-")), previous = process.env.OHQUANT_SKILLS_DIR;
  process.env.OHQUANT_SKILLS_DIR = root;
  const filePath = join(root, "tradermonty-claude-trading-skills", "skills", "technical-analyst", "SKILL.md");
  const skill: QuantSkill = { name: "technical-analyst", description: "Technical fixture", content: "Fixture", filePath, sourcePath: root, source: "pi", scope: "project" };
  const catalog = CURATED_SKILL_REPOSITORIES[1]!.skills.find(skill => skill.name === "technical-analyst")!;
  try {
    await checkSkillPython(root, undefined, async () => ({ stdout: JSON.stringify({ python: "3.12.1", executable: "fixture-python", packages: { requests: "2.32.0", yfinance: null, "pandas-market-calendars": null } }), stderr: "" }));
    checkSkillFiles(root, filePath, catalog.reviewedFiles!);
    const prepared = prepareRuntimeSkills([skill], [{ name: "bash" }], root)[0]!;
    expect(prepared.readiness?.status).toBe("blocked");
    expect(prepared.disableModelInvocation).toBe(true);
    const requirements = prepared.readiness!.modes[1]!.requirements;
    expect(requirements.find(item => item.requirement === "reviewed-script-files")?.status).toBe("missing");
    expect(requirements.find(item => item.requirement === "python:requests")?.status).toBe("unverified");
    expect(requirements.find(item => item.requirement === "FMP_API_KEY")?.status).toBe("unverified");
    expect(requirements.find(item => item.requirement === "network:fmp-eod")?.status).toBe("unverified");
    expect(requirements.some(item => item.requirement === "weekly-price-source")).toBe(false);
    expect(prepareRuntimeSkills([{ ...skill, filePath: join(root, "shadow/SKILL.md") }], [], root)[0]?.readiness).toBeUndefined();
  } finally {
    if (previous === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previous;
    const within = relative(realpathSync(tmpdir()), realpathSync(root));
    if (!within.startsWith("whyj-runtime-skill-readiness-") || within.includes(sep)) throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});

it("blocks the curated macro ETF mode when scripts are missing despite a matching network and Python check", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-runtime-skill-readiness-")), previous = process.env.OHQUANT_SKILLS_DIR;
  process.env.OHQUANT_SKILLS_DIR = root;
  const skill: QuantSkill = { name: "macro-regime-detector", description: "Macro fixture", content: "Fixture",
    filePath: join(root, "tradermonty-claude-trading-skills", "skills", "macro-regime-detector", "SKILL.md"),
    sourcePath: root, source: "pi", scope: "project" };
  try {
    const unchecked = prepareRuntimeSkills([skill], [{ name: "bash" }], root)[0]!;
    expect(unchecked.readiness?.status).toBe("unverified");
    await checkSkillPython(root, undefined, async () => ({ stdout: JSON.stringify({ python: "3.12.1", executable: "fixture-python",
      packages: { requests: "2.32.0", yfinance: "1.4.0", "pandas-market-calendars": null } }), stderr: "" }));
    const localOnly = prepareRuntimeSkills([skill], [{ name: "bash" }], root)[0]!;
    expect(localOnly.readiness?.status).toBe("unverified");
    const today = new Date().toISOString().slice(0, 10);
    await checkEtfNetwork(root, undefined, async () => ({ stdout: JSON.stringify({ ok: true, reason: "observed", executable: "fixture-python",
      symbols: 9, minimumBars: 500, latestDate: today, oldestDate: "2024-01-02" }), stderr: "" }));
    const networkOnly = prepareRuntimeSkills([skill], [{ name: "bash" }], root)[0]!;
    expect(networkOnly.readiness?.status).toBe("unverified");
    const modelReady = prepareRuntimeSkills([skill], [{ name: "bash" }], root, { readReviewedFiles: () => ({
      requirement: "reviewed-script-files", status: "available", reason: "Fixed fixture content verified." }) })[0]!;
    expect(modelReady.disableModelInvocation).toBe(true);
    await checkSkillPython(root, undefined, async () => ({ stdout: JSON.stringify({ python: "3.12.1", executable: "fixture-python",
      packages: { requests: "2.32.0", yfinance: "1.4.0", "pandas-market-calendars": null },
      imports: { requests: { status: "available" }, yfinance: { status: "available" } } }), stderr: "" }), ["requests", "yfinance"]);
    const importedReady = prepareRuntimeSkills([skill], [{ name: "bash" }], root, { readReviewedFiles: () => ({
      requirement: "reviewed-script-files", status: "available", reason: "Fixed fixture content verified." }) })[0]!;
    expect(importedReady.disableModelInvocation).toBe(false);
    expect(formatSkillsForSystemPrompt([importedReady])).toContain("Pinned Markdown can mislabel yfinance-only prices as FMP API");
    const manifest = CURATED_SKILL_REPOSITORIES[1]!.skills.find(item => item.name === skill.name)!.reviewedFiles!;
    expect(Object.keys(manifest)).toHaveLength(17);
    expect(checkSkillFiles(root, skill.filePath, manifest).status).toBe("missing");
    const checked = prepareRuntimeSkills([skill], [{ name: "bash" }], root)[0]!;
    expect(checked.readiness?.status).toBe("blocked");
    expect(checked.description).toContain("Pinned Markdown can mislabel yfinance-only prices as FMP API");
    expect(checked.readiness?.modes[0]?.requirements.find(item => item.requirement === "network:etf-history")?.status).toBe("available");
    expect(checked.disableModelInvocation).toBe(true);
    expect(formatSkillsForSystemPrompt([checked])).not.toContain("<name>macro-regime-detector</name>");
    expect(scopeRuntimeSkills([skill], [checked], ["research_task"])[0]?.disableModelInvocation).toBe(true);
    await checkSkillPython(root, undefined, async () => ({ stdout: JSON.stringify({ python: "3.12.1", executable: "different-python",
      packages: { requests: "2.32.0", yfinance: "1.4.0", "pandas-market-calendars": null } }), stderr: "" }));
    const differentPython = prepareRuntimeSkills([skill], [{ name: "bash" }], root)[0]!;
    expect(differentPython.readiness?.status).toBe("blocked");
    expect(differentPython.readiness?.modes[0]?.requirements.find(item => item.requirement === "network:etf-history")?.status).toBe("unverified");
    expect(prepareRuntimeSkills([{ ...skill, filePath: join(root, "shadow/SKILL.md") }], [], root)[0]?.readiness).toBeUndefined();
  } finally {
    if (previous === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previous;
    const within = relative(realpathSync(tmpdir()), realpathSync(root));
    if (!within.startsWith("whyj-runtime-skill-readiness-") || within.includes(sep)) throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});

it("does not expose breadth analysis when public CSV and Python work but the reviewed scripts are absent", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-runtime-skill-readiness-")), previous = process.env.OHQUANT_SKILLS_DIR;
  process.env.OHQUANT_SKILLS_DIR = root;
  const skill: QuantSkill = { name: "market-breadth-analyzer", description: "Breadth fixture", content: "Fixture",
    filePath: join(root, "tradermonty-claude-trading-skills", "skills", "market-breadth-analyzer", "SKILL.md"),
    sourcePath: root, source: "pi", scope: "project" };
  try {
    await checkSkillPython(root, undefined, async () => ({ stdout: JSON.stringify({ python: "3.12.1", executable: "fixture-python",
      packages: { requests: "2.32.0", yfinance: null, "pandas-market-calendars": null } }), stderr: "" }));
    await checkSkillNetwork(root, undefined, async () => ({ stdout: JSON.stringify({ ok: true, reason: "observed", executable: "fixture-python",
      latestDate: new Date().toISOString().slice(0, 10), detailRows: 2500, summaryRows: 12 }), stderr: "" }));
    const unchecked = prepareRuntimeSkills([skill], [{ name: "bash" }], root)[0]!;
    expect(unchecked.readiness?.status).toBe("unverified");
    expect(unchecked.readiness?.modes[0]?.requirements.find(item => item.requirement === "network:tradermonty-breadth-csv")?.status).toBe("available");
    const manifest = CURATED_SKILL_REPOSITORIES[1]!.skills.find(item => item.name === skill.name)!.reviewedFiles!;
    expect(checkSkillFiles(root, skill.filePath, manifest).status).toBe("missing");
    const checked = prepareRuntimeSkills([skill], [{ name: "bash" }], root)[0]!;
    expect(checked.readiness?.status).toBe("blocked");
    expect(checked.disableModelInvocation).toBe(true);
    expect(formatSkillsForSystemPrompt([checked])).not.toContain("<name>market-breadth-analyzer</name>");
  } finally {
    if (previous === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previous;
    const within = relative(realpathSync(tmpdir()), realpathSync(root));
    if (!within.startsWith("whyj-runtime-skill-readiness-") || within.includes(sep)) throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
