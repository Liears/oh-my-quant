/**
 * Overview Portfolio panel symbol list — durable user preference, not holdings cache.
 * Prices are fetched live by AppRuntime; this file stores code/name only.
 */

import { existsSync, readFileSync } from "node:fs";
import { emitFileEvent } from "./fs-events.ts";
import { ensureDirs, resolveLegacyHoldingsPath, resolvePanelPortfolioPath } from "./dirs.ts";
import { isMarketSymbol } from "../../market/symbols.ts";
import type { HoldingsFile } from "../../types/data.ts";
import { withFileLock } from "./atomic-file.ts";
import { assertStorageRevision, invalidStorageFile, readDurableJson, writeDurableJson } from "./durable-json.ts";

export interface PanelPortfolioEntry {
  code: string;
  name: string;
  added: string;
  instrument?: "fund" | "security";
}

export interface PortfolioGroup {
  id: string;
  name: string;
  symbolCodes: string[];
}

export interface PanelPortfolioFile {
  /** Disk version carried by an editing draft; never part of the stored metadata. */
  revision?: string;
  updated: string;
  symbols: PanelPortfolioEntry[];
  groups: PortfolioGroup[];
}

export const panelPortfolioPath = resolvePanelPortfolioPath;
export const legacyHoldingsPath = resolveLegacyHoldingsPath;

function readPanelFile(path: string): PanelPortfolioFile {
  const { value, revision } = readDurableJson(path);
  if (value === null) return { updated: "", symbols: [], groups: [], revision };
  if (!Array.isArray(value.symbols) || (value.groups !== undefined && !Array.isArray(value.groups))) throw invalidStorageFile(path);
  const raw = value as Partial<PanelPortfolioFile>;
  const symbols: PanelPortfolioEntry[] = [];
  for (const entry of Array.isArray(raw?.symbols) ? raw.symbols : []) {
    if (!entry || typeof entry.code !== "string" || !isValidPanelSymbol(entry.code.trim())) continue;
    const code = entry.code.trim().toUpperCase();
    if (symbols.some(item => item.code === code)) continue;
    symbols.push({ code, name: typeof entry.name === "string" ? entry.name.trim() || code : code,
      added: typeof entry.added === "string" ? entry.added : "",
      ...(entry.instrument === "fund" || entry.instrument === "security" ? { instrument: entry.instrument } : {}),
    });
  }
  const groups: PortfolioGroup[] = [];
  for (const group of Array.isArray(raw?.groups) ? raw.groups : []) {
    if (!group || typeof group.id !== "string" || !group.id.trim() || groups.some(item => item.id === group.id)) continue;
    groups.push({ id: group.id, name: typeof group.name === "string" ? group.name.trim() || group.id : group.id,
      symbolCodes: [...new Set((Array.isArray(group.symbolCodes) ? group.symbolCodes : [])
        .filter((code): code is string => typeof code === "string" && isValidPanelSymbol(code.trim()))
        .map(code => code.trim().toUpperCase()))],
    });
  }
  return {
    revision,
    updated: typeof raw?.updated === "string" ? raw.updated : "", symbols,
    groups: !Array.isArray(raw?.groups) && symbols.length > 0
      ? [{ id: "default", name: "Default", symbolCodes: symbols.map(s => s.code) }] : groups,
  };
}

/** One-time bootstrap from legacy `.ohquant/portfolio/holdings.json` into panel-portfolio.json. */
export function importLegacyHoldings(): PanelPortfolioFile {
  const path = legacyHoldingsPath();
  if (!existsSync(path)) return { updated: "", symbols: [], groups: [] };
  try {
    const text = readFileSync(path, "utf-8");
    emitFileEvent({ operation: "READ", path, bytes: text.length, detail: "legacy holdings import" });
    const raw = JSON.parse(text) as HoldingsFile;
    const today = new Date().toISOString().slice(0, 10);
    const symbols = (raw.funds ?? [])
      .filter((fund) => fund.code)
      .map((fund) => ({
        code: fund.code,
        name: fund.name || fund.code,
        added: today,
        instrument: "fund" as const,
      }));
    const groups = symbols.length > 0 ? [{ id: "default", name: "Default", symbolCodes: symbols.map(s => s.code) }] : [];
    return { updated: today, symbols, groups };
  } catch {
    return { updated: "", symbols: [], groups: [] };
  }
}

/** Valid Overview symbol: 6-digit A-share/fund code or provider-suffixed ticker. */
export function isValidPanelSymbol(code: string): boolean {
  return typeof code === "string" && isMarketSymbol(code);
}

/** Reading preferences never deletes empty user groups or rewrites the file. */
export function loadPanelPortfolio(): PanelPortfolioFile {
  return readPanelFile(panelPortfolioPath());
}

export function savePanelPortfolio(data: PanelPortfolioFile): void {
  ensureDirs();
  const path = panelPortfolioPath();
  withFileLock(path, () => {
    const current = readPanelFile(path);
    assertStorageRevision(path, data.revision, current.revision!);
    data.revision = writePanelFile(path, data);
  });
}

/** Internal synchronous edits operate on the latest state under one lock. */
export function updatePanelPortfolio(edit: (data: PanelPortfolioFile) => PanelPortfolioFile): PanelPortfolioFile {
  ensureDirs();
  const path = panelPortfolioPath();
  return withFileLock(path, () => {
    const next = edit(readPanelFile(path));
    writePanelFile(path, next);
    return readPanelFile(path);
  });
}

function writePanelFile(path: string, data: PanelPortfolioFile): string {
  const payload: PanelPortfolioFile = {
    updated: new Date().toISOString().slice(0, 10),
    symbols: data.symbols.map(({ code, name, added, instrument }) => ({ code, name, added, instrument })),
    groups: (data.groups ?? []).map(({ id, name, symbolCodes }) => ({ id, name, symbolCodes })),
  };
  return writeDurableJson(path, payload);
}

// ── Group CRUD ──

export function createGroup(data: PanelPortfolioFile, name: string, symbolCodes: string[] = []): { data: PanelPortfolioFile; id: string } {
  name = name.trim();
  if (!name) throw new Error("Group name cannot be empty.");
  const id = generateGroupId(data);
  const groups = [...(data.groups ?? []), { id, name, symbolCodes }];
  return { data: { ...data, groups }, id };
}

export function renameGroup(data: PanelPortfolioFile, id: string, name: string): PanelPortfolioFile {
  name = name.trim();
  if (!name) throw new Error("Group name cannot be empty.");
  return { ...data, groups: (data.groups ?? []).map(g => g.id === id ? { ...g, name } : g) };
}

export function deleteGroup(data: PanelPortfolioFile, id: string): PanelPortfolioFile {
  return { ...data, groups: (data.groups ?? []).filter(g => g.id !== id) };
}

export function addSymbolToGroup(data: PanelPortfolioFile, groupId: string, code: string): PanelPortfolioFile {
  code = code.trim().toUpperCase();
  if (!isValidPanelSymbol(code)) throw new Error(`Invalid market symbol: ${code}`);
  return {
    ...data,
    groups: (data.groups ?? []).map(g => {
      if (g.id !== groupId) return g;
      if (g.symbolCodes.includes(code)) return g;
      return { ...g, symbolCodes: [...g.symbolCodes, code] };
    }),
  };
}

export function removeSymbolFromGroup(data: PanelPortfolioFile, groupId: string, code: string): PanelPortfolioFile {
  return {
    ...data,
    groups: (data.groups ?? []).map(g =>
      g.id !== groupId ? g : { ...g, symbolCodes: g.symbolCodes.filter(c => c !== code) },
    ),
  };
}

export function addSymbol(data: PanelPortfolioFile, code: string, name: string): PanelPortfolioFile {
  code = code.trim().toUpperCase();
  if (!isValidPanelSymbol(code)) throw new Error(`Invalid market symbol: ${code}`);
  if (data.symbols.some(s => s.code === code)) return data;
  const today = new Date().toISOString().slice(0, 10);
  return {
    ...data,
    symbols: [...data.symbols, { code, name, added: today }],
  };
}

export function removeSymbol(data: PanelPortfolioFile, code: string): PanelPortfolioFile {
  return {
    ...data,
    symbols: data.symbols.filter(s => s.code !== code),
    groups: (data.groups ?? []).map(g => ({ ...g, symbolCodes: g.symbolCodes.filter(c => c !== code) })),
  };
}

function generateGroupId(data: PanelPortfolioFile): string {
  const existing = new Set((data.groups ?? []).map(g => g.id));
  for (let i = 1; i <= 1000; i++) {
    const id = `group-${i}`;
    if (!existing.has(id)) return id;
  }
  return `group-${Date.now()}`;
}
