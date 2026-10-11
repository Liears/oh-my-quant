import {
  addSymbol, addSymbolToGroup, createGroup, deleteGroup,
  removeSymbol, removeSymbolFromGroup, renameGroup, updatePanelPortfolio,
  type PanelPortfolioFile, type PortfolioGroup,
} from "../storage/index.ts";
import { normalizeSymbol } from "../market/symbols.ts";

export type PortfolioEdit =
  | { type: "create"; name: string }
  | { type: "rename"; group: string; name: string }
  | { type: "delete"; group: string }
  | { type: "add"; group: string; code: string; name?: string }
  | { type: "remove"; group: string; code: string };

export function editPortfolio(edit: PortfolioEdit, expectedRevision?: string): PanelPortfolioFile {
  return updatePanelPortfolio(data => {
    if (expectedRevision !== undefined && expectedRevision !== data.revision) throw Object.assign(
      new Error("Portfolios changed. List portfolios again and review the intended edit before retrying."), { code: "ESTORAGECONFLICT" });
    return applyPortfolioEdit(data, edit);
  });
}

/** Stable IDs take precedence over display names; duplicate names require an ID. */
export function findPortfolioGroup(data: PanelPortfolioFile, key: string): PortfolioGroup {
  const byId = data.groups.find(group => group.id === key);
  if (byId) return byId;
  const matches = data.groups.filter(group => group.name === key);
  if (matches.length !== 1) throw new Error(`Portfolio "${key}" was not found or is ambiguous. Use a listed ID.`);
  return matches[0]!;
}

function applyPortfolioEdit(data: PanelPortfolioFile, edit: PortfolioEdit): PanelPortfolioFile {
  const target = edit.type === "create" ? undefined : findPortfolioGroup(data, edit.group);
  if (edit.type === "create" || edit.type === "rename") {
    const name = edit.name.trim();
    if (!name) throw new Error("Enter a portfolio name.");
    if (data.groups.some(group => group.name.toLowerCase() === name.toLowerCase() && group.id !== target?.id)) throw new Error(`Portfolio "${name}" already exists.`);
  }
  if (edit.type === "create") {
    data = createGroup(data, edit.name).data;
  } else {
    const group = target!;
    if (edit.type === "rename") data = renameGroup(data, group.id, edit.name);
    if (edit.type === "delete") data = deleteGroup(data, group.id);
    if (edit.type === "add") {
      const code = normalizeSymbol(edit.code);
      data = addSymbol(data, code, edit.name?.trim() || code);
      // An explicit name can also update an existing symbol shared by groups.
      if (edit.name?.trim()) data.symbols = data.symbols.map(item => item.code === code ? { ...item, name: edit.name!.trim() } : item);
      data = addSymbolToGroup(data, group.id, code);
    }
    if (edit.type === "remove") {
      const code = group.symbolCodes.find(code => code === edit.code || normalizeSymbol(code) === normalizeSymbol(edit.code));
      if (!code) throw new Error(`${edit.code} is not in ${group.name}.`);
      data = removeSymbolFromGroup(data, group.id, code);
    }
    if (edit.type === "remove" || edit.type === "delete") {
      const remaining = new Set(data.groups.flatMap(item => item.symbolCodes));
      for (const code of group.symbolCodes) if (!remaining.has(code)) data = removeSymbol(data, code);
    }
  }
  return data;
}
