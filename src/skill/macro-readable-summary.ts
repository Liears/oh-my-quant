/** A bounded extract of audited JSON numbers; never copies upstream investment guidance. */
import { auditMacroReport } from "./macro-report-audit.ts";

const COMPONENTS = [
  ["concentration", 25], ["yield_curve", 20], ["credit_conditions", 15],
  ["size_factor", 15], ["equity_bond", 15], ["sector_rotation", 10],
] as const;

export interface MacroReadableSummary {
  reportedSource: string;
  dataMode: string;
  compositeScore: number;
  zone: string;
  signalingComponents: number;
  availableComponents: number;
  totalComponents: number;
  components: Array<{ name: string; score: number; weightPercent: number }>;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function macroReadableSummary(raw: unknown): MacroReadableSummary | null {
  if (auditMacroReport(raw).length) return null;
  const report = object(raw)!, metadata = object(report.metadata)!;
  const composite = object(report.composite)!, quality = object(composite.data_quality)!;
  const components = object(report.components)!;
  return {
    reportedSource: String(metadata.data_source), dataMode: String(metadata.data_mode),
    compositeScore: composite.composite_score as number, zone: composite.zone as string,
    signalingComponents: composite.signaling_components as number,
    availableComponents: quality.available_count as number,
    totalComponents: quality.total_components as number,
    components: COMPONENTS.map(([name, weightPercent]) => ({
      name, score: object(components[name])!.score as number, weightPercent,
    })),
  };
}

export function formatMacroReadableSummary(summary: MacroReadableSummary): string[] {
  return [
    "Audited JSON figures (reported source; narrative guidance unreviewed):",
    `Source claim: ${summary.reportedSource} · mode: ${summary.dataMode}`,
    `Composite: ${summary.compositeScore}/100 · ${summary.zone}`,
    `Signals: ${summary.signalingComponents}/${summary.totalComponents} · available components: ${summary.availableComponents}/${summary.totalComponents}`,
    ...summary.components.map(component => `  ${component.name}: ${component.score}/100 (weight ${component.weightPercent}%)`),
  ];
}
