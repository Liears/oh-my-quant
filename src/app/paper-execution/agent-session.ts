/** Compose an opt-in Agent around one private paper ledger and private session repo. */
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { createAgent } from "../../agent/src/session.ts";
import type { QuantAgentDependencies } from "../../agent/src/session-contracts.ts";
import { createDefaultSessionDependencies } from "../../runtime/session-dependencies.ts";
import { JsonlSessionRepo } from "../../agent/src/session-runtime/index.ts";
import { resolveOhquantDir } from "../../storage/src/dirs.ts";
import { createLocalPaperService } from "./adapter.ts";
import { createReviewedPaperTools, type ReviewPaperOrder } from "./agent-tools.ts";

export interface PrivatePaperAgentOptions {
  root: string;
  accountRef: string;
  review: ReviewPaperOrder;
  /** An explicit host may provide its own model connection; its public tools/skills are discarded. */
  baseDependencies?: QuantAgentDependencies;
  cwd?: string;
}

function inside(path: string, root: string): boolean {
  const candidate = process.platform === "win32" ? path.toLowerCase() : path;
  const base = process.platform === "win32" ? root.toLowerCase() : root;
  return candidate === base || candidate.startsWith(base + sep);
}

function selectedPrivateRoot(value: string): string {
  if (!isAbsolute(value)) throw new Error("Paper Agent root must be an explicit absolute path.");
  let root: string;
  try { root = existsSync(value) ? realpathSync(value) : join(realpathSync(dirname(value)), basename(value)); }
  catch { throw new Error("Paper Agent root parent directory must already exist."); }
  const statePath = resolve(resolveOhquantDir());
  const state = existsSync(statePath) ? realpathSync(statePath) : statePath;
  if (inside(root, state)) throw new Error("Private paper Agent sessions cannot be placed in app state.");
  if (!existsSync(join(root, "orders.json"))) throw new Error("Initialize the private paper account explicitly before opening an Agent session.");
  return root;
}

/** No shell, research tools, extension refresh, skills or automatic public artifact in this session. */
export function createPrivatePaperAgent(options: PrivatePaperAgentOptions) {
  const root = selectedPrivateRoot(options.root);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(options.accountRef)) throw new Error("Invalid private paper account ID.");
  const paper = createLocalPaperService({ root, target: { adapterId: "local-paper", accountRef: options.accountRef, mode: "paper" } });
  const base = options.baseDependencies ?? createDefaultSessionDependencies({ cwd: options.cwd });
  const sessionsRoot = join(root, "agent-sessions");
  const tools = createReviewedPaperTools(paper.adapter, options.review);
  const dependencies: QuantAgentDependencies = {
    env: base.env, sessions: new JsonlSessionRepo({ fs: base.env, sessionsRoot }), tools,
    readConnection: base.readConnection,
    async loadSkills() { return []; }, readSkillRevision: () => "private-paper-only",
    prompts: {
      system: () => `Private paper-only Agent session for ${paper.adapter.target.accountRef}. The account, balances, orders and fills are simulated. Use paper_account to inspect the selected account; paper_order submit and cancel require a trusted host review of the exact intent. Lookup uncertain outcomes with the same clientOrderId and full intent. Never claim a submission is a fill. No live route, shell, public research artifact, account switching or automatic retry is available.`,
      turn: input => input,
      skill: () => "Skills are unavailable in this private paper session.",
    },
    verifyResearch: base.verifyResearch,
  };
  return { agent: createAgent({ cwd: options.cwd, dependencies }), paper, sessionsRoot };
}
