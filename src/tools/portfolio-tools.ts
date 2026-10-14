import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { loadPanelPortfolio, listPortfolioComparisons } from "../storage/index.ts";
import { editPortfolio } from "../runtime/research/portfolio.ts";
import { runPortfolioComparison, restorePortfolioComparison, formatPortfolioComparison } from "../runtime/research/portfolio-comparison.ts";
import type { PortfolioComparisonDeps } from "../runtime/research/portfolio-comparison.ts";
import { ok } from "./shared/results.ts";

const text = () => Type.String({ minLength: 1 });
const weights = () => Type.Record(Type.String(), Type.Number({ exclusiveMinimum: 0, maximum: 1 }));
const Edit = Type.Object({ expected_revision: text(), edit: Type.Union([
  Type.Object({ type: Type.Literal("create"), name: text() }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("rename"), group: text(), name: text() }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("delete"), group: text() }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("add"), group: text(), code: text(), name: Type.Optional(text()) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("remove"), group: text(), code: text() }, { additionalProperties: false }),
]) }, { additionalProperties: false });
const Compare = Type.Object({ group_a: text(), group_b: text(), start: text(), end: text(), benchmark: text(),
  base_currency: Type.String({ pattern: "^[A-Z]{3}$" }),
  currencies: Type.Record(Type.String(), Type.String({ pattern: "^[A-Z]{3}$" })),
  weighting: Type.Union([Type.Literal("buy-and-hold"), Type.Literal("rebalance")]),
  missing_members: Type.Optional(Type.Union([Type.Literal("fail"), Type.Literal("exclude")])),
  weights_a: Type.Optional(weights()), weights_b: Type.Optional(weights()),
}, { additionalProperties: false });
const History = Type.Object({ id: Type.Optional(text()) }, { additionalProperties: false });
const List = Type.Object({}, { additionalProperties: false });

export const listPortfoliosTool: AgentTool<typeof List> = {
  name: "list_portfolios", label: "Portfolios", parameters: List, executionMode: "sequential",
  description: "Read observation portfolio IDs, names, members and revision. No account quantities or holdings. Call before editing or comparing groups.",
  async execute(_id, _args, signal) {
    signal?.throwIfAborted();
    const data = loadPanelPortfolio();
    return ok([`Portfolio revision: ${data.revision}`, ...data.groups.map(group => `${group.id} · ${group.name}: ${group.symbolCodes.join(", ") || "empty"}`),
      ...(data.groups.length ? [] : ["No observation portfolios. Use edit_portfolio to create one when requested."])].join("\n"), data);
  },
};
export const editPortfolioTool: AgentTool<typeof Edit> = {
  name: "edit_portfolio", label: "Edit portfolio", parameters: Edit, executionMode: "sequential",
  description: "Apply one user-requested observation portfolio edit. Use the exact revision from list_portfolios; conflicts require re-listing and reviewing the edit. Returns before/after. Never change groups merely to perform a comparison. Adding a named existing symbol renames that shared symbol in every group. Does not place orders or store account positions.",
  async execute(_id, args, signal) {
    signal?.throwIfAborted();
    if (!args.expected_revision?.trim()) throw new Error("List portfolios first and supply expected_revision.");
    const before = loadPanelPortfolio();
    if (before.revision !== args.expected_revision) throw new Error("Portfolios changed. List portfolios again before editing.");
    const after = editPortfolio(args.edit, args.expected_revision);
    return ok(`Portfolio edit: ${JSON.stringify(args.edit)}\nBefore: ${JSON.stringify(before.groups)}\nAfter: ${JSON.stringify(after.groups)}\nRevision: ${after.revision}`,
      { edit: args.edit, before, after });
  },
};
export function createComparePortfoliosTool(deps?: PortfolioComparisonDeps): AgentTool<typeof Compare> {
  return {
    name: "compare_portfolios", label: "Compare portfolios", parameters: Compare, executionMode: "sequential",
    description: "Compare two saved observation portfolios over an explicit window and benchmark. Fetches close/NAV and ECB daily FX automatically. Supply explicit quote currencies for every member and benchmark, based on user input or verified instrument evidence; do not guess from exchange. Choose initial buy-and-hold or rebalance at common dates; absent weights means equal allocations. Missing members fail unless exclusion was explicitly requested; exclusions renormalize weights. Saves reproducible hypothetical research with common dates, sources and risk; never edits groups or executes trades.",
    async execute(_id, args, signal) {
      const artifact = await runPortfolioComparison({ groups: [args.group_a, args.group_b], start: args.start, end: args.end,
        benchmark: args.benchmark, baseCurrency: args.base_currency, currencies: args.currencies, weighting: args.weighting,
        missingMembers: args.missing_members ?? "fail", weights: [args.weights_a, args.weights_b] }, signal, deps);
      return ok(`${formatPortfolioComparison(artifact.result)}\nSaved comparison: ${artifact.id}`, artifact);
    },
  };
}
export const comparePortfoliosTool = createComparePortfoliosTool();
export const portfolioComparisonsTool: AgentTool<typeof History> = {
  name: "portfolio_comparisons", label: "Saved comparisons", parameters: History, executionMode: "sequential",
  description: "List saved portfolio research IDs, or load an ID and recompute it from recorded price/FX inputs to check result consistency. Does not refresh data or prove provider accuracy. Corrupt files are reported and preserved.",
  async execute(_id, args, signal) {
    signal?.throwIfAborted();
    if (args.id) {
      const artifact = restorePortfolioComparison(args.id);
      return ok(`${formatPortfolioComparison(artifact.result)}\nSaved comparison: ${artifact.id} · recorded inputs recomputed`, artifact);
    }
    const data = listPortfolioComparisons();
    return ok([...data.items.map(item => `${item.id} · ${item.createdAt} · ${item.names.join(" vs ")}`),
      ...(data.items.length ? [] : ["No saved portfolio comparisons."]), `Unavailable files: ${data.unavailable.length}`].join("\n"), data);
  },
};
export const PORTFOLIO_TOOLS: AgentTool[] = [listPortfoliosTool, editPortfolioTool, comparePortfoliosTool, portfolioComparisonsTool];
