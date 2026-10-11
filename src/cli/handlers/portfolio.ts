import { editPortfolio, type PortfolioEdit } from "../../runtime/portfolio.ts";
import { listLocalPortfolios, loadPanelPortfolio, syncPanelPortfolioFromLocalPortfolio } from "../../storage/index.ts";
import type { CommandHandler } from "../types.ts";

const usage = [
  "/portfolio create NAME",
  "/portfolio add GROUP CODE [NAME]   (fund: 022364.OF; US: AAPL; HK: 00700.HK)",
  "/portfolio remove GROUP CODE",
  "/portfolio rename GROUP NAME",
  "/portfolio delete GROUP",
  "/portfolio import [legacy name|file|index]",
].join("\n");

export const portfolioHandler: CommandHandler = async (_flags, positional, ctx) => {
  if (!positional.length && ctx.openPortfolio) return { success: true, message: "", effects: [{ type: "openPortfolio" }] };
  const [action, group = "", ...rest] = positional;
  try {
    // Legacy discovery is available only through this explicit migration path.
    if (action === "import") {
      const identifier = positional.slice(1).join(" ");
      if (!identifier) return { success: true, message: listLocalPortfolios().map(item => `${item.fileName}  ${item.name}`).join("\n") || "No legacy portfolios to import." };
      const imported = syncPanelPortfolioFromLocalPortfolio(identifier);
      if (!imported) return { success: false, message: `Legacy portfolio "${identifier}" was not found.` };
      return { success: true, message: `Imported ${imported.portfolio.name}.`, effects: [{ type: "portfolioChanged" }] };
    }
    if (!action || action === "list") {
      const data = loadPanelPortfolio();
      const lines = data.groups.map(item => `${item.id}  ${item.name}  (${item.symbolCodes.length})\n  ${item.symbolCodes.join(", ")}`);
      return { success: true, message: [...(lines.length ? lines : ["No portfolios yet."]), "", usage].join("\n"), data };
    }
    let edit: PortfolioEdit;
    if (action === "create") edit = { type: "create", name: positional.slice(1).join(" ") };
    else if (action === "rename") edit = { type: "rename", group, name: rest.join(" ") };
    else if (action === "delete" && group && !rest.length) edit = { type: "delete", group };
    else if (action === "add" && rest[0]) edit = { type: "add", group, code: rest[0], name: rest.slice(1).join(" ") };
    else if (action === "remove" && rest.length === 1) edit = { type: "remove", group, code: rest[0]! };
    else return { success: false, message: usage };
    const data = editPortfolio(edit);
    return { success: true, message: "Portfolio saved.", data, effects: [{ type: "portfolioChanged" }] };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) };
  }
};
