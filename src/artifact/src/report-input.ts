import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadDataset } from "../../storage/index.ts";
import type { Bar, DatasetRef } from "../../types/data.ts";
import type { ReportProvenance } from "../../types/research-evidence.ts";
import type { RawEntry } from "./types.ts";
import { esc } from "./template.ts";
import { renderEchartsKline } from "./renderers.ts";
import { resolveResearchFund } from "../../research/fund.ts";
import { renderFundNavInput } from "./research-renderer.ts";
import { publicFundNavRef } from "../../market/fund-nav.ts";
import type { FundNavDatasetRef, FundNavSnapshot } from "../../types/fund-data.ts";
import type { ResearchFundDataset } from "../../research/types.ts";
import { researchReferences } from "../../research/references.ts";

export interface ReportSessionInput {
  header: Record<string, unknown>;
  lines: RawEntry[];
  provenance: ReportProvenance;
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }

/** Load one complete transcript, then select the requested branch before rendering. */
export function loadReportSession(path: string, leafId?: string | null): ReportSessionInput | null {
  try {
    const text = readFileSync(path, "utf8");
    const values: unknown[] = text.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
    const header = values.shift() as Record<string, unknown> | undefined;
    if (!header || header.type !== "session" || header.version !== 3 || typeof header.id !== "string" || !header.id) return null;
    if (values.some(value => !value || typeof value !== "object" || typeof (value as RawEntry).type !== "string")) return null;
    let lines = values as RawEntry[];
    const byId = new Map<string, RawEntry>();
    for (const entry of lines) {
      if (typeof entry.id !== "string" || !entry.id || byId.has(entry.id)
        || (entry.parentId !== null && (typeof entry.parentId !== "string" || !byId.has(entry.parentId)))) return null;
      byId.set(entry.id, entry);
    }
    if (leafId !== undefined) {
      const branch: RawEntry[] = [];
      let cursor = leafId;
      const seen = new Set<string>();
      while (cursor !== null) {
        const entry = byId.get(cursor);
        if (!entry || seen.has(cursor) || (entry.parentId !== null && typeof entry.parentId !== "string")) return null;
        seen.add(cursor);
        branch.push(entry);
        cursor = entry.parentId as string | null;
      }
      lines = branch.reverse();
    }
    return { header, lines, provenance: {
      version: 1, sessionHash: hash(text), entryHash: hash(JSON.stringify(lines)),
      scope: leafId === undefined ? "transcript" : "branch", leafId: leafId ?? null,
      entryIds: lines.flatMap(entry => typeof entry.id === "string" ? [entry.id] : []), datasets: [],
    } };
  } catch { return null; }
}

/** Appended research is allowed; editing/removing the report's original entries is not. */
export function verifyReportSession(path: string, provenance: ReportProvenance): boolean {
  if (provenance.version !== 1 || !Array.isArray(provenance.entryIds)
    || (provenance.scope !== "branch" && provenance.scope !== "transcript")) return false;
  const input = loadReportSession(path);
  if (!input) return false;
  const byId = new Map(input.lines.map(entry => [entry.id, entry]));
  const selected = provenance.entryIds.map(id => byId.get(id));
  if (provenance.scope === "branch" && (provenance.leafId !== (selected.at(-1)?.id ?? null)
    || selected.some((entry, index) => entry?.parentId !== (selected[index - 1]?.id ?? null)))) return false;
  return selected.every(Boolean) && hash(JSON.stringify(selected)) === provenance.entryHash;
}

/** Each chart resolves one exact DatasetRef. Different symbols/windows/revisions stay separate. */
export function renderReportEvidence(input: ReportSessionInput, resolve: (ref: DatasetRef) => Bar[] = loadDataset, resolveFund?: (ref: FundNavDatasetRef) => FundNavSnapshot): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const entry of input.lines) {
    const message = entry.type === "message" ? entry.message as Record<string, unknown> | undefined : undefined;
    if (message?.role !== "toolResult" || message.isError) continue;
    const details = message.details as Record<string, unknown> | undefined;
    if (!details || typeof details !== "object") continue;
    const candidates = researchReferences(String(message.toolName ?? ""), details);
    for (const [role, candidate] of candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      if ((candidate as { kind?: unknown }).kind === "fund-nav") {
        let ref: FundNavDatasetRef;
        try { ref = publicFundNavRef(candidate); } catch { parts.push("<p>Invalid fund NAV reference; observations unavailable.</p>"); continue; }
        let data: ResearchFundDataset | undefined;
        try { data = resolveResearchFund(ref, resolveFund); } catch { /* Missing revisions never use current NAV. */ }
        input.provenance.datasets.push({ toolCallId: String(message.toolCallId ?? entry.id ?? ""), toolName: String(message.toolName ?? "tool"), role, ref, verified: data !== undefined });
        const identity = JSON.stringify(ref);
        if (seen.has(identity)) continue;
        seen.add(identity);
        parts.push(data ? `<div class="research-bound">${renderFundNavInput(data)}</div>` : `<p>${esc(ref.symbol)} · Fund NAV revision unavailable: ${esc(ref.revision)}. Not rebuilt from newer data.</p>`);
        continue;
      }
      const raw = candidate as DatasetRef;
      const ref: DatasetRef = {
        version: raw.version, kind: raw.kind, symbol: raw.symbol, source: raw.source, market: raw.market,
        revision: raw.revision, contentHash: raw.contentHash, dates: raw.dates,
        requested: { start: raw.requested?.start, end: raw.requested?.end },
        snapshotAt: raw.snapshotAt, adjustment: raw.adjustment, availability: raw.availability,
      };
      const toolName = String(message.toolName ?? "tool");
      const toolCallId = String(message.toolCallId ?? entry.id ?? "");
      let bars: Bar[] = [];
      try { bars = resolve(ref); } catch { /* Show unavailable evidence; never use current data. */ }
      const verified = bars.length > 0;
      input.provenance.datasets.push({ toolCallId, toolName, role, ref, verified });
      const identity = `${ref.symbol}/${ref.source}/${ref.revision}/${ref.contentHash}/${role}/${JSON.stringify(ref.requested)}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const label = `${ref.symbol} · ${ref.source} · ${role}`;
      const status = verified ? `${bars[0]!.date} — ${bars.at(-1)!.date} · ${bars.length} observations` : "Referenced data unavailable. This chart was not rebuilt from newer prices.";
      const chart = verified ? renderEchartsKline([{ header: ["Date", "Open", "High", "Low", "Close", "Volume"], timeframe: `${ref.symbol} · ${String(ref.revision).slice(0, 8)}`, rows: bars.map(bar => ({ ...bar, vol: bar.volume })) }]) : "";
      parts.push(`<section class="report-input" data-dataset-hash="${esc(String(ref.contentHash))}"><h3>${esc(label)}</h3><p>${esc(status)}</p><details class="report-provenance"><summary>Source &amp; revision · ${esc(String(ref.revision).slice(0, 8))}</summary><dl><dt>Revision</dt><dd>${esc(String(ref.revision))}</dd><dt>Requested window</dt><dd>${esc(String(ref.requested.start ?? "unbounded"))} — ${esc(String(ref.requested.end ?? "unbounded"))}</dd><dt>Observed at</dt><dd>${esc(String(ref.snapshotAt))}</dd><dt>Adjustment</dt><dd>${esc(String(ref.adjustment))}</dd><dt>Availability</dt><dd>${esc(String(ref.availability))}</dd></dl></details>${chart}</section>`);
    }
  }
  return parts.length ? `<section class="report-evidence" data-report-evidence="true"><div class="board-head"><div><span class="board-kicker">ARCHIVED OBSERVATIONS</span><h2>Research inputs</h2><p>Charts use the referenced observations; missing versions are marked unavailable. These are price charts, not strategy returns.</p></div></div>${parts.join("\n")}</section>` : "";
}
