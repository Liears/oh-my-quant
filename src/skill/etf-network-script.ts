/** Explicit probe of the pinned macro detector's public yfinance inputs; installed skill code is never executed. */
export const ETF_NETWORK_SCRIPT = String.raw`
import json, math, sys
from datetime import date, timedelta

SYMBOLS = ["RSP", "SPY", "IWM", "TLT", "SHY", "HYG", "LQD", "XLY", "XLP"]
result = {"ok": False, "executable": sys.executable, "reason": "dependency", "symbols": 0}
class ProbeFailure(Exception):
    def __init__(self, reason, symbol=""):
        self.reason, self.symbol = reason, symbol
try:
    import yfinance as yf
    today = date.fromisoformat(sys.argv[1])
    end = today + timedelta(days=1)
    start = end - timedelta(days=900)  # The pinned client requests ~1.5x 600 calendar days.
    minimum_bars, oldest, latest = None, None, None
    result["reason"] = "network"
    for symbol in SYMBOLS:
        df = yf.download(symbol, start=start.isoformat(), end=end.isoformat(), auto_adjust=True, progress=False)
        if df is None or df.empty:
            raise ProbeFailure("missing-etf", symbol)
        if hasattr(df.columns, "levels") and df.columns.levels is not None:
            df.columns = df.columns.droplevel(1)
        if any(field not in df.columns for field in ("Open", "High", "Low", "Close", "Volume")):
            raise ProbeFailure("invalid-history", symbol)
        dates = []
        for index, row in df.iterrows():
            day = index.date() if hasattr(index, "date") else index
            if not isinstance(day, date):
                raise ProbeFailure("invalid-history", symbol)
            prices = [float(row[field]) for field in ("Open", "High", "Low", "Close")]
            volume = float(row["Volume"])
            if any(not math.isfinite(value) or value <= 0 for value in prices) or not math.isfinite(volume) or volume < 0 or prices[1] < prices[2]:
                raise ProbeFailure("invalid-history", symbol)
            dates.append(day)
        if len(dates) != len(set(dates)):
            raise ProbeFailure("invalid-history", symbol)
        first, last = min(dates), max(dates)
        if len(dates) < 400 or (last - first).days < 500:
            raise ProbeFailure("short-history", symbol)
        if last > today or (today - last).days > 5:
            raise ProbeFailure("future-history" if last > today else "stale-history", symbol)
        minimum_bars = len(dates) if minimum_bars is None else min(minimum_bars, len(dates))
        oldest = first if oldest is None else min(oldest, first)
        latest = last if latest is None else min(latest, last)
        result["symbols"] += 1
    result.update(ok=True, reason="observed", minimumBars=minimum_bars, oldestDate=oldest.isoformat(), latestDate=latest.isoformat())
except ImportError:
    result["reason"] = "dependency"
except ProbeFailure as error:
    result.update(reason=error.reason, failedSymbol=error.symbol)
except (ValueError, TypeError, KeyError, OverflowError):
    result["reason"] = "invalid-history"
except Exception:
    result["reason"] = "network"
print(json.dumps(result))
`;
