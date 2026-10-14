/** Explicit Latest values only; this is not a general financial language judge. */
export interface VerifiedFactorLatest { factor: string; period?: number; latest: number }
interface LatestClaim { value: number; percent: boolean; decimalPlaces: number; factor?: string; period?: number }
const LABEL = /\bLatest\b|最新(?:因子|动量)?值|动量最新值/giu;
const VALUE = /^[\s*`|:：=（）()]*([+\-−]?(?:\d+(?:\.\d+)?|\.\d+))\s*([%％])?/u;
const DATE = /^[\s*`|:：=（）()]*\d{4}[-/]\d{2}[-/]\d{2}(?!\d)/u;
const FACTOR = /\b(momentum|reversal|volatility|volume_ratio|rsi|sma_deviation)(?:\s*[_（(]\s*(\d+)\s*[)）]?)?(?![A-Za-z_])/giu;
const FACTOR_HEADING = new RegExp(String.raw`^\s*(?:\d+[.)、]\s*)?(?:${FACTOR.source})\s*[:：]?\s*$`, "iu");
const PERCENT_FACTORS = new Set(["momentum", "reversal", "volatility", "sma_deviation"]);

function namedFactor(text: string): { factor?: string; period?: number } {
  const matches = [...text.matchAll(FACTOR)];
  if (matches.length !== 1) return {};
  const match = matches[0]!;
  return { factor: match[1]!.toLowerCase(), ...(match[2] ? { period: Number(match[2]) } : {}) };
}

function latestClaims(text: string): LatestClaim[] {
  const claims: LatestClaim[] = [];
  let section: { factor?: string; period?: number } = {};
  let latestColumn = -1, periodColumn = -1;
  let plainTable = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/^\s*已核验数值\s*[（(]([^（）()]+)[)）]\s*$/u, "$1");
    const plainHeader = /^\s*(?:factor|因子)(?:[(（](?:period|周期)[)）])?\s+(?:(?:period|周期)\s+)?(?:latest|最新(?:因子)?值)(?:\s|$)/iu.test(line);
    const cells = line.includes("|") ? line.trim().replace(/^\|/u, "").replace(/\|$/u, "").split("|").map(cell => cell.trim())
      : plainHeader || plainTable ? line.trim().split(/\s+/u) : [line];
    const header = cells.findIndex(cell => /^(?:\*\*)?(?:Latest|最新(?:因子)?值)(?:\*\*)?$/iu.test(cell));
    if (cells.length > 1 && header >= 0 && cells.some(cell => /^(?:(?:factor|因子)(?:[(（](?:period|周期)[)）])?|period|周期)$/iu.test(cell))) {
      latestColumn = header;
      plainTable = plainHeader;
      periodColumn = cells.findIndex(cell => /^(?:period|周期)$/iu.test(cell));
      continue;
    }
    if (cells.length > 1 && latestColumn >= 0) {
      const rest = cells[latestColumn] ?? "";
      const scope = namedFactor(cells.filter((_, index) => index !== latestColumn).join(" "));
      const match = DATE.test(rest) ? null : VALUE.exec(rest);
      if (scope.factor && match) {
        const period = periodColumn >= 0 && /^\d+$/u.test(cells[periodColumn] ?? "") ? Number(cells[periodColumn]) : scope.period;
        claims.push({ ...scope, period, value: Number(match[1]!.replace("−", "-")), percent: !!match[2],
          decimalPlaces: match[1]!.split(".")[1]?.length ?? 0 });
      }
      continue;
    }
    if (cells.length === 1 && !/^\s*[-─]+\s*$/u.test(line)) { latestColumn = periodColumn = -1; plainTable = false; }
    if (/^\s*#{1,6}\s/u.test(line) || FACTOR_HEADING.test(line)) section = namedFactor(line);
    let previousLabelEnd = 0;
    for (const label of line.matchAll(LABEL)) {
      const rest = line.slice(label.index! + label[0].length);
      const match = DATE.test(rest) ? null : VALUE.exec(rest);
      const scopeText = line.slice(previousLabelEnd, label.index);
      previousLabelEnd = label.index! + label[0].length;
      if (!match) continue;
      const local = namedFactor(scopeText.split(/[;；]/u).at(-1)!);
      const beforeLabel = local.factor ? local : namedFactor(scopeText);
      claims.push({ ...(beforeLabel.factor ? beforeLabel : section), value: Number(match[1]!.replace("−", "-")), percent: !!match[2],
        decimalPlaces: match[1]!.split(".")[1]?.length ?? 0 });
    }
  }
  return claims;
}

export function hasExplicitFactorLatestClaim(text: string): boolean {
  return latestClaims(text).length > 0;
}

/** Evaluation coverage requires an explicit factor and period for every requested value. */
export function hasAllFactorLatestClaims(text: string, evidence: readonly VerifiedFactorLatest[]): boolean {
  const claims = latestClaims(text);
  return evidence.every(item => claims.some(claim => claim.factor === item.factor && claim.period === item.period));
}

/** Bind named factors/periods to their own selected observations, then compare stated precision. */
export function factorLatestClaimViolations(text: string, input: VerifiedFactorLatest | readonly VerifiedFactorLatest[]): string[] {
  const evidence: readonly VerifiedFactorLatest[] = "factor" in input ? [input] : input;
  const violations = new Set<string>();
  for (const claim of latestClaims(text)) {
    const candidates = evidence.filter(item => (!claim.factor || item.factor === claim.factor)
      && (claim.period === undefined || item.period === claim.period));
    if (!candidates.length) continue;
    if (candidates.length !== 1) { violations.add("ambiguous-verified-factor-latest"); continue; }
    const selected = candidates[0]!;
    if (claim.percent && !PERCENT_FACTORS.has(selected.factor)) continue;
    const scale = claim.percent ? 100 : 1;
    const tolerance = Math.max(0.0000005, 0.5 * 10 ** -claim.decimalPlaces / scale) + 1e-12;
    if (!Number.isFinite(claim.value) || Math.abs(claim.value / scale - selected.latest) > tolerance)
      violations.add("wrong-verified-factor-latest");
  }
  return [...violations];
}
