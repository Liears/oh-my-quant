import { metricTone } from "../../types/metric-semantics.ts";

export function metricValueClass(value: string, label: string): string {
  const tone = metricTone(value, label) ?? "neutral";
  return { up: "up", down: "dn", positive: "pos", negative: "neg", neutral: "nt" }[tone];
}

export function tableValueClass(value: string, label: string): string {
  const tone = metricTone(value, label) ?? "neutral";
  return { up: "u", down: "d", positive: "p", negative: "ng", neutral: "m" }[tone];
}
