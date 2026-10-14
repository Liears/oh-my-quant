import { Set as setFormat } from "typebox/format";
import { AKSHARE_INDEX_SIGNATURES } from "./akshare-index-signatures.generated.ts";
import type { AkshareIndexSignatureParameter } from "./akshare-index-parameters.ts";

const DATE8 = "^[0-9]{8}$";
const DATETIME_SECONDS = "^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$";
const YMD8_FORMAT = "whyj-akshare-ymd8";
const DATETIME_SECONDS_FORMAT = "whyj-akshare-datetime-seconds";
const DATE_RULES: Record<string, Partial<Record<string, { pattern: string; format: string }>>> = {
  index_zh_a_hist: { start_date: { pattern: DATE8, format: YMD8_FORMAT }, end_date: { pattern: DATE8, format: YMD8_FORMAT } },
  index_zh_a_hist_min_em: { start_date: { pattern: DATETIME_SECONDS, format: DATETIME_SECONDS_FORMAT },
    end_date: { pattern: DATETIME_SECONDS, format: DATETIME_SECONDS_FORMAT } },
};

function validCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month]!;
}

function validYmd8(value: string): boolean {
  const match = /^([0-9]{4})([0-9]{2})([0-9]{2})$/.exec(value);
  return !!match && validCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function validDateTimeSeconds(value: string): boolean {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2})$/.exec(value);
  return !!match && validCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))
    && Number(match[4]) < 24 && Number(match[5]) < 60 && Number(match[6]) < 60;
}

setFormat(YMD8_FORMAT, validYmd8);
setFormat(DATETIME_SECONDS_FORMAT, validDateTimeSeconds);

/** Accept only complete, quoted choice lists from an AKShare function's docstring. */
export function akshareDocumentedChoices(description: string | undefined, defaultValue: unknown): string[] | undefined {
  const body = description?.match(/\bchoice of\s*\{([^{}]*)\}/)?.[1];
  if (!body) return;
  const token = /\s*(['"])(.*?)\1\s*(,|$)/y;
  const choices: string[] = [];
  let offset = 0;
  while (offset < body.length) {
    token.lastIndex = offset;
    const match = token.exec(body);
    if (!match || !match[2] || match[2].length > 128 || choices.includes(match[2])) return;
    choices.push(match[2]);
    offset = token.lastIndex;
  }
  if (choices.length < 2 || choices.length > 32 || typeof defaultValue === "string" && !choices.includes(defaultValue)) return;
  return choices;
}

/** Local 1.18.63 source and AKShare index docs confirm these two distinct date shapes. */
export function akshareIndexStringConstraints(endpoint: string, name: string, parameter: AkshareIndexSignatureParameter): {
  enum?: string[];
  pattern?: string;
  format?: string;
} {
  const choices = akshareDocumentedChoices(parameter.description, parameter.default);
  const dateRule = DATE_RULES[endpoint]?.[name];
  return { ...(choices ? { enum: choices } : {}), ...(dateRule ?? {}) };
}

/** Cross-field check uses the same packaged defaults that the actual probe forwards to AKShare. */
export function akshareIndexTemporalRangeError(endpoint: string, params: Record<string, unknown>): string | undefined {
  if (endpoint !== "index_zh_a_hist" && endpoint !== "index_zh_a_hist_min_em") return;
  const signature = endpoint === "index_zh_a_hist" ? AKSHARE_INDEX_SIGNATURES.index_zh_a_hist
    : AKSHARE_INDEX_SIGNATURES.index_zh_a_hist_min_em;
  const start = params.start_date ?? signature.parameters.start_date.default;
  const end = params.end_date ?? signature.parameters.end_date.default;
  const valid = endpoint === "index_zh_a_hist" ? validYmd8 : validDateTimeSeconds;
  if (typeof start !== "string" || typeof end !== "string" || !valid(start) || !valid(end))
    return "Use valid calendar dates in this endpoint's declared format.";
  if (start > end) return "Start date must not follow end date, including the endpoint's defaults.";
  return;
}
