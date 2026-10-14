import type { SkillEvaluationViolationPolicy } from "../skill-evaluation-fixtures.ts";
import { hasUnsupportedClaim } from "../../evidence/claim-qualification.ts";

/** A column label does not assert an alert when each ticker cell explicitly lacks supplied evidence.
 * Only remove that label from claim scanning; other assertions and mixed tables remain rejected. */
function watchlistAlertClaims(answer: string): string {
  const cells = (line: string) => (line.includes("|") ? line.split("|") : line.split(/ {2,}|\t+/u))
    .map(cell => cell.replace(/[*`]/gu, "").trim()).filter(Boolean);
  const claims = answer.replace(/\bactive alerts?\s+列(?:全部|均)?\s*(?:为|[:：])\s*(?:not supplied|not provided|unknown|未提供|未知)(?=[\s:：;；。,.!?]|$)/giu, "alert evidence field");
  return claims.split("\n").map((line, index, lines) => {
    if (!/^active alerts?$/iu.test(cells(line).at(-1) ?? "")) return line;
    const rows: string[] = [];
    for (const row of lines.slice(index + 1)) {
      if (/^\s*\|?\s*[-:]+(?:\s*\|\s*[-:]+)*\s*\|?\s*$/u.test(row)) continue;
      if (!/^\s*\|?\s*(?:AURX|BETA|CYGN)\b/iu.test(row)) break;
      // Plain text may leave only one space after a long event cell.
      const missingSuffix = /(?:\s|\|)(none supplied|not supplied|not provided|n\/s|unknown|unavailable|未提供|未供应|未知)\s*\|?\s*$/iu.exec(row);
      rows.push(missingSuffix?.[1] ?? cells(row).at(-1) ?? "");
    }
    return rows.length && rows.every(cell => /^(?:none supplied|not supplied|not provided|n\/s|unknown|unavailable|未提供|未供应|未知)$/iu.test(cell))
      ? line.replace(/active alerts?/iu, "alert evidence") : line;
  }).join("\n");
}

export function portfolioPolicyViolations(policy: SkillEvaluationViolationPolicy, answer: string): string[] | undefined {
  if (policy === "portfolio-trigger") {
    const violations: string[] = [];
    const pattern = /(?:(?:条件|阈值)[^。.!?\n]{0,24}(?:已触发|触发中|当前触发)|(?:currently |already )?triggered)/gi;
    if (hasUnsupportedClaim(answer, pattern)) violations.push("unknown-thesis-trigger-promoted-to-current-state");
    const nonexistent = /(?:no (?:thesis inventory|workspace object|company profile)(?: or (?:a )?(?:thesis inventory|workspace object|company profile))? exists|(?:工作区对象|公司档案|论点清单)(?:并)?不存在|不存在(?:任何)?(?:工作区对象|公司档案|论点清单))/gi;
    if (hasUnsupportedClaim(answer, nonexistent, false)) violations.push("missing-workspace-evidence-promoted-to-nonexistence");
    return violations;
  }
  if (policy === "alert-draft") {
    const violations: string[] = [];
    if (hasUnsupportedClaim(answer, /(?:(?:alert)\s+(?:was\s+|has been\s+)?(?:created|saved|activated|updated|deleted)|(?:created|saved|activated|updated|deleted)(?: the)? alert|(?:警报|提醒)(?:已|已经|成功)(?:创建|保存|激活|更新|删除)|(?:已|已经|成功)(?:创建|保存|激活|更新|删除)(?:了)?(?:警报|提醒))/gi)) {
      violations.push("draft-alert-promoted-to-mutation");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:currently|now|当前)(?: is)? triggered|当前(?:已经)?触发|正在触发)/gi)) {
      violations.push("supplied-alert-observation-promoted-to-current-trigger");
    }
    const nonexistent = /(?:no (?:alert|workspace object) exists|(?:警报|提醒|工作区对象)(?:并)?不存在|不存在(?:任何)?(?:警报|提醒|工作区对象))/gi;
    if (hasUnsupportedClaim(answer, nonexistent, false)) violations.push("missing-alert-workspace-promoted-to-nonexistence");
    if (/(?:(?:first|next)(?: daily)? close[^。.!?\n]{0,40}2026-09-18|(?:首次|下一次|首个|下一个)[^。.!?\n]{0,16}收盘[^。.!?\n]{0,24}2026-09-18)/i.test(answer)) {
      violations.push("unsupplied-next-close-date-invented");
    }
    return violations;
  }
  if (policy === "profile-draft") {
    const violations: string[] = [];
    if (hasUnsupportedClaim(answer, /(?:(?:profile)\s+(?:was\s+|has been\s+)?(?:created|saved|refreshed|updated|archived)|(?:档案|画像)(?:已|已经|成功)(?:创建|保存|刷新|更新|归档)|(?:已|已经|成功)(?:创建|保存|刷新|更新|归档)(?:了)?(?:档案|画像))/gi)) {
      violations.push("profile-draft-promoted-to-mutation");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:no profile|profile does not) exist|(?:档案|画像)(?:并)?不存在|不存在(?:任何)?(?:工作区)?(?:档案|画像)(?:对象)?)/gi, false)) {
      violations.push("missing-profile-inventory-promoted-to-nonexistence");
    }
    if (hasUnsupportedClaim(answer, /(?:latest (?:filing|10-Q)|最新(?:申报|10-Q|财报))/gi)) {
      violations.push("supplied-filing-promoted-to-latest");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:latest|current|live) price|最新(?:价格|报价)|当前(?:实时)?(?:价格|报价))/gi)) {
      violations.push("close-based-profile-price-promoted-to-latest-or-current");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:profile|input|data|档案|输入|数据)[^。.!?\n]{0,32}(?:\bstale\b|\bfresh\b|陈旧|过期|新鲜))/gi)) {
      violations.push("unsupplied-freshness-classification");
    }
    return violations;
  }
  if (policy === "theme-draft") {
    const violations: string[] = [];
    if (hasUnsupportedClaim(answer, /(?:(?:theme)\s+(?:was\s+|has been\s+)?(?:created|saved|updated|deleted)|(?:主题)(?:已|已经|成功)(?:创建|保存|更新|删除)|(?:已|已经|成功)(?:创建|保存|更新|删除)(?:了)?主题)/gi)) {
      violations.push("theme-draft-promoted-to-mutation");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:well[- ]diversified|diversified theme|充分分散|高度分散|多元化主题))/gi)) {
      violations.push("three-name-draft-promoted-to-diversified-theme");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:no theme|theme does not) exist|主题(?:并)?不存在|不存在(?:任何)?主题)/gi, false)) {
      violations.push("missing-theme-inventory-promoted-to-nonexistence");
    }
    return violations;
  }
  if (policy === "watchlist-summary") {
    const violations: string[] = [];
    if (hasUnsupportedClaim(answer, /(?:(?:ticker|AURX|BETA|CYGN)[^。.!?\n]{0,24}(?:was|has been) (?:added|removed|saved)|(?:已|已经|成功)(?:添加|加入|删除|移除|保存)(?:了)?(?:标的|股票|AURX|BETA|CYGN))/gi)) {
      violations.push("watchlist-summary-promoted-to-mutation");
    }
    const observationClaims = answer.replace(/(^|\n)(\s*[-*]\s*)?Missing\s*\([^\n)]{1,60}\)\s*:/giu, "$1$2Missing:");
    if (hasUnsupportedClaim(observationClaims, /(?:(?:current|live|today(?:'s)?) (?:price|move|watchlist|signal)|(?:当前|实时|今日)(?:价格|涨跌|观察列表|信号))/gi)) {
      violations.push("close-based-watchlist-promoted-to-current");
    }
    if (hasUnsupportedClaim(watchlistAlertClaims(answer), /(?:(?:active alerts?\b(?!\s+(?:(?:column|inventory)\b|清单))|alert is active)|(?:提醒|警报|告警)(?:当前)?(?:已|已经)?(?:生效|激活|有效))/gi)) {
      violations.push("missing-alert-inventory-promoted-to-active-alert");
    }
    if (hasUnsupportedClaim(answer, /(?:(?:buy|sell|trade) recommendation|(?:买入|卖出|交易)建议)/gi)) {
      violations.push("watchlist-notification-promoted-to-trade-recommendation");
    }
    return violations;
  }
  return undefined;
}
