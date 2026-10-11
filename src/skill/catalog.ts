import { MACRO_REVIEWED_FILES } from "./macro-manifest.ts";
import { BREADTH_REVIEWED_FILES } from "./breadth-manifest.ts";
import { MARKET_ENVIRONMENT_REVIEWED_FILES } from "./environment-manifest.ts";
import { POSITION_SIZER_REVIEWED_FILES } from "./position-manifest.ts";
import { TECHNICAL_ANALYST_REVIEWED_FILES } from "./technical-manifest.ts";
import { LLMQUANT_REVIEWED_FILES } from "./llmquant-manifest.ts";

export interface CuratedSkillMode {
  name: string;
  requires: readonly string[];
  optional: readonly string[];
}
export interface CuratedSkill {
  name: string;
  modes: readonly CuratedSkillMode[];
  limitations: string;
  reviewedFiles?: Readonly<Record<string, string>>;
}
export interface CuratedSkillRepository {
  repo: string;
  revision: string;
  skills: readonly CuratedSkill[];
}

const researchMode: CuratedSkillMode[] = [
  { name: "source-backed research", requires: ["local-resource-read", "reviewed-script-files", "llmquant-research-data"], optional: [] },
  { name: "limited supplied evidence", requires: ["local-resource-read", "reviewed-script-files", "user-supplied-evidence"], optional: [] },
];

/** Reviewed entry documents at these commits. Requirements are declarations, not readiness evidence. */
export const CURATED_SKILL_REPOSITORIES: readonly CuratedSkillRepository[] = [
  {
    repo: "LLMQuant/skills", revision: "1918237467c2dff4cc97a18ebc0892dfd46e8129",
    skills: [
      { name: "llmquant-data", modes: researchMode, reviewedFiles: LLMQUANT_REVIEWED_FILES["llmquant-data"], limitations: "SEC filings, 13F ownership and macro primitives. A daily-price API key does not establish these capabilities." },
      { name: "llmquant-macro", modes: researchMode, reviewedFiles: LLMQUANT_REVIEWED_FILES["llmquant-macro"], limitations: "Needs observation/release dates and revisions; missing series or calendars must remain explicit." },
      { name: "llmquant-equities", modes: researchMode, reviewedFiles: LLMQUANT_REVIEWED_FILES["llmquant-equities"], limitations: "Fundamentals, estimates, events and ownership depend on the selected workflow; price-only analysis is incomplete." },
      { name: "llmquant-portfolio", modes: researchMode, reviewedFiles: LLMQUANT_REVIEWED_FILES["llmquant-portfolio"], limitations: "Profiles, thesis records and alerts need separate workspace services; local observation groups are not those services." },
      { name: "llmquant-risk", modes: researchMode, reviewedFiles: LLMQUANT_REVIEWED_FILES["llmquant-risk"], limitations: "Options, VIX and account positions require separate evidence; do not infer private positions from local files." },
    ],
  },
  {
    repo: "tradermonty/claude-trading-skills", revision: "a2506fd1bab662723fb7142734320fef23fc48fa",
    skills: [
      { name: "market-breadth-analyzer", modes: [{ name: "public CSV analysis", requires: ["local-resource-read", "shell-execution", "python>=3.9", "python:requests>=2.31.0", "reviewed-script-files", "network:tradermonty-breadth-csv"], optional: [] }],
        reviewedFiles: BREADTH_REVIEWED_FILES,
        limitations: "Public CSV access, freshness and the installed import closure must be verified. Writes report/history files; no API key requirement is not an offline guarantee." },
      { name: "technical-analyst", modes: [
        { name: "weekly chart analysis", requires: ["local-resource-read", "model-image-input", "user-weekly-chart"], optional: [] },
        { name: "contrarian confirmation script", requires: ["local-resource-read", "shell-execution", "python", "python:requests", "reviewed-script-files", "FMP_API_KEY", "network:fmp-eod", "crowd-direction"], optional: ["cot-detector-report"] },
      ], reviewedFiles: TECHNICAL_ANALYST_REVIEWED_FILES,
      limitations: "Script mode requires an explicit request, requests, the reviewed local closure and authenticated FMP daily OHLC access; arbitrary supplied prices cannot replace this CLI's FMP source. File matching does not prove execution. Chart scenario probabilities are analytical judgments." },
      { name: "position-sizer", modes: [{ name: "supplied trade parameters", requires: ["local-resource-read", "shell-execution", "python>=3.9", "reviewed-script-files", "user-account-and-risk-inputs", "private-output-authorization"], optional: ["price-source"] }],
        reviewedFiles: POSITION_SIZER_REVIEWED_FILES,
        limitations: "Standard-library calculation. Upstream writes account values into reports; private live-state/output authorization is required before using real account inputs." },
      { name: "macro-regime-detector", modes: [{ name: "cross-asset data", requires: ["local-resource-read", "shell-execution", "python", "python:requests>=2.31.0", "python:yfinance>=0.2.0", "network:etf-history", "reviewed-script-files"], optional: ["FMP_API_KEY"] }],
        reviewedFiles: MACRO_REVIEWED_FILES,
        limitations: "FMP is optional; fallback ETF data and SHY/TLT yield proxy have different coverage. The pinned Markdown report hardcodes an FMP API source line even when JSON metadata says yfinance_only; audit the JSON and Markdown together before citing their source. Missing all components cannot yield a valid report. Check all pinned local imports before invocation; matching files does not prove execution." },
      { name: "market-environment-analysis", modes: [
        { name: "market research", requires: ["local-resource-read", "web-search"], optional: ["economic-calendar"] },
        { name: "exchange calendar helper", requires: ["shell-execution", "python", "python:pandas-market-calendars==5.2.2", "reviewed-script-files"], optional: [] },
      ], reviewedFiles: MARKET_ENVIRONMENT_REVIEWED_FILES,
      limitations: "Search access and timestamped evidence are required for market claims; the reviewed calendar helper alone is not market research." },
    ],
  },
];

export function curatedSkillRepository(repo: string): CuratedSkillRepository | undefined {
  return CURATED_SKILL_REPOSITORIES.find(entry => entry.repo.toLowerCase() === repo.toLowerCase());
}
