/** Synthetic public payload: fixed Shanghai dates, no live provider calls. */
export const FUND_LITERAL = '/* fixture */var fS_code = "270042"; var ignored = ["var fS_code = \\\"999999\\\";"];'
  + 'var Data_netWorthTrend = [{"x":1736179200000,"y":0.5,"equityReturn":-50},{"x":1736092800000,"y":1}];'
  + 'var Data_ACWorthTrend = [[1736092800000,1.1],[1736179200000,0.6]];';

export const BLOCKED_FUND_ATTEMPTS = [{ endpoint: "fund_open_fund_info_em", status: "error", error: "[WinError 4551] fixture native DLL blocked" }] as const;
