import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { readSettings, resolveSkillsDir } from "../src/storage/index.ts";
import { createDefaultSessionDependencies } from "../src/agent/src/session-dependencies.ts";
import { createBuiltinTools } from "../src/tools/registry.ts";
import { createEvaluationFundData, createEvaluationPriceData, RESEARCH_EVALUATION_CASES, runResearchEvaluation, type ResearchEvaluationCase } from "../src/runtime/research-evaluation.ts";
import { createNewsEvaluationData, NEWS_EVALUATION_CASES, runNewsEvaluation, type NewsEvaluationCase } from "../src/runtime/news-evaluation.ts";
import { createEvaluationPortfolioData } from "../src/runtime/research-evaluation-portfolio.ts";
import { ANNUAL_EVALUATION_TOOLS, createAnnualEvaluationFixture, runAnnualEvaluation } from "../src/runtime/annual-evaluation.ts";
import { annualComparisonFixture } from "../src/research/test/annual-fixture.ts";
import { createSkillWorkflowReader, runSkillEvaluation, SKILL_EVALUATION_CASES, stageSkillEvaluation, type SkillEvaluationCase } from "../src/runtime/skill-evaluation.ts";

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args: args[0] === "--" ? args.slice(1) : args, strict: true, allowPositionals: false, options: {
    help: { type: "boolean", short: "h" }, case: { type: "string" }, "timeout-ms": { type: "string" }, "max-requests": { type: "string" }, output: { type: "string" },
  } });
  if (values.help) {
    console.log(`Usage: bun run eval:research -- [options]
  --case stock         stock | index | risk | fund | portfolio | annual | one of the documented news-* or skill-* cases | news-all | skill-all | all
  --timeout-ms 120000  Deadline per case, including recovery (1-600000)
  --max-requests 12    Maximum Agent provider-request events per case (1-50)
  --output FILE       Save evidence and model answers; refuses overwrite

Uses the saved model connection and incurs model usage. Actual WhyJ tools execute
only synthetic observations in an isolated temporary workspace. The skill case
stages reviewed Markdown and replaces shell execution with one read-only workflow
reader. No market, account or network tool is offered. Original settings/sessions stay intact.
Automated arithmetic, task or citation checks do not judge explanation quality.
Ctrl+C cancels. Exit 0: listed automated checks pass; 1: failed; 130: cancelled.`);
    return;
  }
  const selected = values.case ?? "stock";
  if (![...RESEARCH_EVALUATION_CASES, ...NEWS_EVALUATION_CASES, ...SKILL_EVALUATION_CASES, "annual", "news-all", "skill-all", "all"].includes(selected)) throw new Error("Unknown evaluation case");
  const timeoutMs = Number(values["timeout-ms"] ?? 120000), maxRequests = Number(values["max-requests"] ?? 12);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000 || !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 50) throw new Error("Invalid evaluation limits");
  if (values.output && existsSync(values.output)) throw new Error("Output already exists");
  const settings = structuredClone(readSettings()), installedSkillsRoot = resolveSkillsDir(), previous = process.env.OHQUANT_DIR;
  const root = mkdtempSync(join(tmpdir(), "whyj-real-evaluation-")), controller = new AbortController();
  const cancel = () => controller.abort(); process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
  const results: Array<Awaited<ReturnType<typeof runResearchEvaluation>> | Awaited<ReturnType<typeof runNewsEvaluation>>
    | Awaited<ReturnType<typeof runAnnualEvaluation>> | Awaited<ReturnType<typeof runSkillEvaluation>>> = [];
  try {
    process.env.OHQUANT_DIR = root;
    const cases = selected === "all" ? [...RESEARCH_EVALUATION_CASES, ...NEWS_EVALUATION_CASES, ...SKILL_EVALUATION_CASES, "annual" as const]
      : selected === "news-all" ? NEWS_EVALUATION_CASES
        : selected === "skill-all" ? SKILL_EVALUATION_CASES
          : [selected as ResearchEvaluationCase | NewsEvaluationCase | SkillEvaluationCase | "annual"];
    const stagedSkills = new Map<SkillEvaluationCase, ReturnType<typeof stageSkillEvaluation>>();
    for (const id of cases) {
      if ((SKILL_EVALUATION_CASES as readonly string[]).includes(id)) {
        stagedSkills.set(id as SkillEvaluationCase, stageSkillEvaluation(id as SkillEvaluationCase, installedSkillsRoot, root));
      }
    }
    for (const id of cases) {
      if (controller.signal.aborted) break;
      const skill = (SKILL_EVALUATION_CASES as readonly string[]).includes(id);
      const staged = skill ? stagedSkills.get(id as SkillEvaluationCase) : undefined;
      if (skill && !staged) throw new Error(`Skill evaluation was not staged: ${id}`);
      const workflowReader = staged ? createSkillWorkflowReader(staged.workflowFile, staged.fixture.workflow) : null;
      const dependencies = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions"), settings,
        ...(skill ? { skillPaths: [join(root, "skills", "LLMQuant-skills")] } : {}) });
      const news = (NEWS_EVALUATION_CASES as readonly string[]).includes(id);
      dependencies.tools = workflowReader ? [workflowReader.tool]
        : id === "annual" ? createBuiltinTools().filter(tool => (ANNUAL_EVALUATION_TOOLS as readonly string[]).includes(tool.name))
        : news ? createBuiltinTools({ news: createNewsEvaluationData(id as NewsEvaluationCase) }).filter(tool => tool.name === "research_news")
        : id === "fund" ? createBuiltinTools({ fundData: createEvaluationFundData() }).filter(tool => tool.name === "fund_dca_backtest")
        : id === "portfolio" ? createBuiltinTools({ comparison: createEvaluationPortfolioData() }).filter(tool => ["list_portfolios", "compare_portfolios"].includes(tool.name))
        : createBuiltinTools({ analysisData: createEvaluationPriceData(id as "stock" | "index" | "risk") }).filter(tool => ["compute_factor", "check_risk", "run_backtest"].includes(tool.name));
      if (!skill) dependencies.loadSkills = async () => [];
      const system = dependencies.prompts.system;
      dependencies.prompts.system = input => system(input) + "\nThis run uses synthetic observations only. Only the supplied tool schemas are available. Do not infer live market conditions or account holdings from this exercise.";
      const report = workflowReader ? await runSkillEvaluation(id as SkillEvaluationCase, dependencies, workflowReader.trace, { timeoutMs, maxRequests, signal: controller.signal })
        : id === "annual" ? await runAnnualEvaluation(createAnnualEvaluationFixture((await annualComparisonFixture()).save()), dependencies, { timeoutMs, maxRequests, signal: controller.signal })
        : news ? await runNewsEvaluation(id as NewsEvaluationCase, dependencies, { timeoutMs, maxRequests, signal: controller.signal })
        : await runResearchEvaluation(id as ResearchEvaluationCase, dependencies, { timeoutMs, maxRequests, signal: controller.signal });
      results.push(report);
      console.error(`${id}: ${report.outcome}; ${report.checks.filter(check => check.passed).length}/${report.checks.length} checks; ${report.requests} request events`);
    }
    const report = { version: 1, kind: "research-evaluation-suite", completedAt: new Date().toISOString(), results };
    const json = JSON.stringify(report, null, 2) + "\n";
    if (values.output) { mkdirSync(dirname(resolve(values.output)), { recursive: true }); writeFileSync(values.output, json, { flag: "wx" }); }
    else console.log(json.trimEnd());
    process.exitCode = controller.signal.aborted ? 130 : results.length && results.every(result => result.passed) ? 0 : 1;
  } finally {
    process.off("SIGINT", cancel); process.off("SIGTERM", cancel);
    if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected evaluation root");
    rmSync(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try { await main(); }
  catch { console.error("Research evaluation failed. Check arguments, model configuration and output path; see --help."); process.exitCode = 1; }
}
