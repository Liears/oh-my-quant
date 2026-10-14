import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createAgent } from "../src/agent/src/session.ts";
import { createDefaultSessionDependencies } from "../src/runtime/session-dependencies.ts";
import { NodeExecutionEnv } from "../src/agent/src/session-runtime/node.ts";
import { JsonlSessionRepo } from "../src/agent/src/session-runtime/index.ts";
import { discoverSkills } from "../src/agent/src/skills.ts";
import { readChartImage } from "../src/runtime/models/chart-image-input.ts";
import { prepareRuntimeSkills } from "../src/runtime/skills/skill-readiness.ts";
import { checkSkillFiles } from "../src/skill/file-probe.ts";
import { TECHNICAL_ANALYST_REVIEWED_FILES } from "../src/skill/technical-manifest.ts";
import { createChartReferenceReader, type ChartReferenceRead } from "./chart-reference-reader.ts";

// Explicit manual validation: uses the saved model, synthetic/public pixels and pinned local guidance.
const { values } = parseArgs({ strict: true, options: { image: { type: "string" }, "skills-root": { type: "string" }, output: { type: "string" } } });
if (!values.image || !values["skills-root"] || !values.output) throw new Error("Use --image PATH --skills-root PINNED_FIXTURE_ROOT --output NEW.json");
if (process.platform !== "win32" || process.env.WHYJ_SHELL) throw new Error("This validation requires the default Windows PowerShell tool");
const output = resolve(values.output), root = dirname(output);
const image = await readChartImage(values.image);
await mkdir(root, { recursive: true });
// Reserve the receipt before making a paid model call; never overwrite an earlier run.
await writeFile(output, JSON.stringify({ status: "running", scope: "synthetic-public-chart" }), { flag: "wx" });
const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 180000);
const base = createDefaultSessionDependencies({ cwd: process.cwd() }), connection = base.readConnection();
const skillsRoot = resolve(values["skills-root"]), env = new NodeExecutionEnv({ cwd: root });
process.env.OHQUANT_SKILLS_DIR = skillsRoot;
const discovered = await discoverSkills({ cwd: root, env, extraPaths: [join(skillsRoot, "tradermonty-claude-trading-skills", "skills", "technical-analyst")],
  integrations: { external: false } });
const skill = discovered.skills.find(item => item.name === "technical-analyst");
if (!skill) throw new Error("Pinned technical-analyst fixture not found");
const files = checkSkillFiles(root, skill.filePath, TECHNICAL_ANALYST_REVIEWED_FILES);
if (files.status !== "available") throw new Error("Pinned fixture file closure does not match");
const references = ["references/technical_analysis_framework.md", "references/contrarian-confirmation-checklist.md", "assets/analysis_template.md"];
const referencePaths = references.map(name => resolve(dirname(skill.filePath), name));
const toolCalls: ChartReferenceRead[] = [], requests: Array<{ imageAttached: boolean }> = [];
const reader = createChartReferenceReader(referencePaths, root, toolCalls);
const agent = createAgent({ dependencies: { ...base, env, sessions: new JsonlSessionRepo({ fs: env, sessionsRoot: join(root, "sessions") }),
  readConnection: () => connection, readTools: undefined, readSkillRevision: undefined, loadSkills: async () => [skill],
  prepareSkills: (skills, tools, capabilities) => prepareRuntimeSkills(skills, tools, root, { readCapabilities: () => capabilities ?? {} }),
  tools: [reader],
} });
agent.subscribe(event => { if (event.type === "before_provider_payload") requests.push({ imageAttached: JSON.stringify(event.payload).includes(image.data) }); });
let failure: string | undefined;
try {
  const instructions = "请先完整读取以下三份固定参考，再依据附图按框架做周线视觉分析（中文）。读图中标的标签、周期、最后日期和最后收盘值；解释趋势、量价、支撑阻力及失效条件，并根据模板整理情景。只有收盘线和成交量，缺少 OHLC 和均线，请明确不可评估项，不推断完整 candle、ATR 或具体止损。未提供价格序列，情景概率没有校准依据。这是合成公开教学图，无账户、实时行情或交易授权。不运行逆向脚本、不联网、不写报告文件。不要编造看不到的值。逐项使用以下完整读取命令：\n"
    + referencePaths.map(path => `Get-Content -LiteralPath '${path}' -Raw -Encoding utf8`).join("\n");
  await agent.skill("technical-analyst", instructions, { images: [image], signal: controller.signal });
} catch (error) { failure = error instanceof Error ? error.name : "UnknownError"; }
finally { clearTimeout(timer); agent.abort(); await agent.waitForIdle(); }
const metadata = (await agent.getSessionMetadata())!, journal = await readFile(metadata.path, "utf8");
const answers = agent.state.messages.flatMap(message => message.role === "assistant" ? message.content.flatMap(part => part.type === "text" ? [part.text] : []) : []);
await writeFile(output, JSON.stringify({ status: failure || agent.state.errorMessage ? "failed" : "responded", scope: "synthetic-public-chart",
  observedAt: new Date().toISOString(), model: { provider: connection.model.provider, id: connection.model.id, input: connection.model.input },
  image: { mimeType: image.mimeType, bytes: Buffer.from(image.data, "base64").length, sha256: createHash("sha256").update(Buffer.from(image.data, "base64")).digest("hex") },
  pin: "a2506fd1bab662723fb7142734320fef23fc48fa", reviewedFiles: Object.keys(TECHNICAL_ANALYST_REVIEWED_FILES).length,
  requests, toolCalls, inputPixelsAbsentFromJournal: !journal.includes(image.data), inputPixelsAbsentFromState: !JSON.stringify(agent.state.messages).includes(image.data),
  completeReferenceReads: references.every(name => toolCalls.some(call => call.resource === name.split("/").at(-1) && call.fullRead && call.succeeded)),
  failure: failure ?? (agent.state.errorMessage ? "ProviderOrHarnessError" : null), answers,
  limitation: "Transport and retained-input checks only. Review visual readings manually; no financial, network or account validation." }, null, 2));
console.log(JSON.stringify({ output, requests: requests.length, failure: failure ?? (agent.state.errorMessage ? "ProviderOrHarnessError" : null) }));
