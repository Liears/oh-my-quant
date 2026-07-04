import type { RiskMetrics } from "./risk.ts";

export interface NavPoint {
  date: string;
  nav: number;
}

export interface GroupNav {
  groupId: string;
  groupName: string;
  navSeries: NavPoint[];
}

export interface GroupComparisonResult {
  groupId: string;
  groupName: string;
  symbolCount: number;
  risk: RiskMetrics;
  totalReturn: number;
  navSeries: NavPoint[];
}

export interface ComparisonArtifact {
  id: string;
  createdAt: string;
  groups: GroupComparisonResult[];
}
