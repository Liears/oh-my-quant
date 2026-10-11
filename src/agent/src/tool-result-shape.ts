const RESULT_SHAPES: Record<string, string> = {
  fetch_bars: 'bars_summary', search_symbols: 'symbol_list', fetch_snapshot: 'snapshot_kv',
  akshare_fund_nav: 'fund_nav', akshare_fund_profile: 'fund_profile',
  akshare_fund_purchase: 'fund_purchase', akshare_fund_fee: 'fund_fee',
  akshare_fund_performance: 'fund_performance', fund_dca_backtest: 'fund_dca_backtest',
  compute_factor: 'factor_metrics', run_backtest: 'backtest_metrics', check_risk: 'risk_metrics',
  score_benchmark: 'benchmark_score', show_dashboard: 'dashboard_ranking',
};

/** Stable rendering hints for built-in tools; recognize text from external tools. */
export function inferResultShape(toolName: string, result?: unknown): string | null {
  if (Object.hasOwn(RESULT_SHAPES, toolName)) return RESULT_SHAPES[toolName]!;
  const content = result && typeof result === 'object' && 'content' in result ? result.content : undefined;
  const text = Array.isArray(content) ? content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text).join('\n').toLowerCase() : '';
  if (text.includes('total return') && text.includes('sharpe')) return 'backtest_metrics';
  if (text.includes('var 95') && text.includes('cvar 95')) return 'risk_metrics';
  if (text.includes('percentile') && text.includes('latest')) return 'factor_metrics';
  if (text.includes('dashboard') && text.includes('evaluations')) return 'dashboard_ranking';
  if (text.includes('score') && text.includes('grade')) return 'benchmark_score';
  if (text.includes('snapshot')) return 'snapshot_kv';
  if (toolName.startsWith('akshare_fund_')) return 'fund_akshare_endpoint';
  return null;
}
