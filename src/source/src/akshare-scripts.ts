import {
  AKSHARE_BAR_SOURCE_ENDPOINTS,
  AKSHARE_KNOWN_A_INDEX_SYMBOLS,
  DEFAULT_AKSHARE_BAR_SOURCE_PRIORITY,
} from "./akshare-endpoints.ts";

// AKShare 股票数据 — AKShare 1.18.64 文档 https://akshare.akfamily.xyz/data/stock/stock.html#

export const AKSCRIPT = `
import json, sys
from datetime import datetime
try:
    import akshare as ak
    import pandas as pd

    symbol = sys.argv[1]
    start = sys.argv[2] if len(sys.argv) > 2 else "20200101"
    end = sys.argv[3] if len(sys.argv) > 3 else datetime.today().strftime("%Y%m%d")
    source_priority = json.loads(sys.argv[4]) if len(sys.argv) > 4 else ${JSON.stringify(DEFAULT_AKSHARE_BAR_SOURCE_PRIORITY)}
    instrument = sys.argv[5] if len(sys.argv) > 5 else "ambiguous"
    df = None
    selected_endpoint = None
    attempts = []

    index_map = ${JSON.stringify(AKSHARE_KNOWN_A_INDEX_SYMBOLS)}

    def normalize_date_filter(input_df):
        if input_df is None or input_df.empty:
            return input_df
        local_df = input_df.copy()
        if "日期" in local_df.columns and "date" not in local_df.columns:
            local_df = local_df.rename(columns={"日期": "date"})
        if "date" in local_df.columns:
            local_df["date"] = pd.to_datetime(local_df["date"]).dt.strftime("%Y-%m-%d")
            if start:
                local_df = local_df[local_df["date"] >= pd.to_datetime(start).strftime("%Y-%m-%d")]
            if end:
                local_df = local_df[local_df["date"] <= pd.to_datetime(end).strftime("%Y-%m-%d")]
        return local_df

    def call_endpoint(name, fn):
        try:
            result = normalize_date_filter(fn())
            rows = 0 if result is None else len(result.index)
            attempts.append({"endpoint": name, "status": "ok", "rows": rows})
            return result
        except Exception as e:
            attempts.append({"endpoint": name, "status": "error", "error": str(e)[:240]})
            return None

    def fetch_stock_hist(code, market_symbol):
        endpoint_calls = {
            "eastmoney": ("${AKSHARE_BAR_SOURCE_ENDPOINTS.eastmoney}", lambda: getattr(ak, "${AKSHARE_BAR_SOURCE_ENDPOINTS.eastmoney}")(
                symbol=code, period="daily", start_date=start, end_date=end, adjust="qfq")),
            "sina": ("${AKSHARE_BAR_SOURCE_ENDPOINTS.sina}", lambda: getattr(ak, "${AKSHARE_BAR_SOURCE_ENDPOINTS.sina}")(
                symbol=market_symbol, start_date=start, end_date=end, adjust="qfq")),
            "tencent": ("${AKSHARE_BAR_SOURCE_ENDPOINTS.tencent}", lambda: getattr(ak, "${AKSHARE_BAR_SOURCE_ENDPOINTS.tencent}")(
                symbol=market_symbol, start_date=start, end_date=end, adjust="qfq")),
        }
        for source in source_priority:
            entry = endpoint_calls.get(source)
            if entry is None:
                attempts.append({"endpoint": str(source), "status": "error", "error": "unsupported source"})
                continue
            name, fn = entry
            hist = call_endpoint(name, fn)
            if hist is not None and not hist.empty:
                return hist, name
        return None, None

    def fetch_fund_nav(code):
        fund_df = call_endpoint("fund_open_fund_info_em", lambda: ak.fund_open_fund_info_em(
            symbol=code, indicator="单位净值走势"))
        if fund_df is None or fund_df.empty:
            return None
        fund_df = fund_df.rename(columns={"净值日期": "date", "单位净值": "close"})
        fund_df["open"] = fund_df["close"]
        fund_df["high"] = fund_df["close"]
        fund_df["low"] = fund_df["close"]
        fund_df["volume"] = 0
        fund_df["amount"] = None
        fund_df["date"] = pd.to_datetime(fund_df["date"]).dt.strftime("%Y-%m-%d")
        if start:
            fund_df = fund_df[fund_df["date"] >= pd.to_datetime(start).strftime("%Y-%m-%d")]
        if end:
            fund_df = fund_df[fund_df["date"] <= pd.to_datetime(end).strftime("%Y-%m-%d")]
        return fund_df

    def fetch_index_hist(code, market_symbol=None):
        endpoint_calls = [
            ("index_zh_a_hist", lambda: ak.index_zh_a_hist(symbol=code, period="daily", start_date=start, end_date=end)),
            ("stock_zh_index_daily_em", lambda: ak.stock_zh_index_daily_em(symbol=market_symbol or code, start_date=start, end_date=end)),
            ("stock_zh_index_hist_csindex", lambda: ak.stock_zh_index_hist_csindex(symbol=code, start_date=start, end_date=end)),
            ("index_hist_cni", lambda: ak.index_hist_cni(symbol=code, start_date=start, end_date=end)),
            ("index_hist_sw", lambda: ak.index_hist_sw(symbol=code, period="day")),
            ("stock_zh_index_daily", lambda: ak.stock_zh_index_daily(symbol=market_symbol or code)),
        ]
        for name, fn in endpoint_calls:
            hist = call_endpoint(name, fn)
            if hist is not None and not hist.empty:
                return hist, name
        return None, None

    if instrument == "index":
        code = symbol.split(".")[0]
        df, selected_endpoint = fetch_index_hist(code, index_map.get(symbol.upper()))
    elif instrument == "fund":
        df = fetch_fund_nav(symbol.split(".")[0])
        selected_endpoint = "fund_open_fund_info_em" if df is not None and not df.empty else None
    elif instrument == "stock":
        code = symbol.split(".")[0]
        market_prefix = "sh" if symbol.upper().endswith(".SH") else "sz" if symbol.upper().endswith(".SZ") else "bj" if symbol.upper().endswith(".BJ") else ""
        market_symbol = f"{market_prefix}{code}" if market_prefix else code
        df, selected_endpoint = fetch_stock_hist(code, market_symbol)
    else:
        df = fetch_fund_nav(symbol)
        if df is not None and not df.empty:
            selected_endpoint = "fund_open_fund_info_em"
        if df is None or df.empty:
            df, selected_endpoint = fetch_index_hist(symbol)

    if df is None or df.empty:
        print(json.dumps({"bars": [], "endpoint": None, "attempts": attempts}))
        sys.exit(0)

    # Normalize column names
    col_map = {"日期":"date","开盘":"open","开盘价":"open","今开":"open","最高":"high","最高价":"high","最低":"low","最低价":"low",
               "收盘":"close","收盘价":"close","最新价":"close","latest":"close","成交量":"volume","成交额":"amount","成交金额":"amount"}
    df = df.rename(columns=col_map)
    if selected_endpoint == "${AKSHARE_BAR_SOURCE_ENDPOINTS.tencent}" and "amount" in df.columns:
        df["volume"] = df["amount"]
        df["amount"] = None
    cols = ["date","open","high","low","close","volume","amount"]
    df = df[[c for c in cols if c in df.columns]]
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")

    records = df.to_dict(orient="records")
    for r in records:
        for k in ("open","high","low","close"):
            if k in r and r[k] is not None:
                r[k] = round(float(r[k]), 4)
        for k in ("volume","amount"):
            if k in r and r[k] is not None:
                r[k] = int(float(r[k]))
    print(json.dumps({"bars": records, "endpoint": selected_endpoint, "attempts": attempts}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
`;

export const AK_GENERIC_INDEX_SCRIPT = `
import json, sys
from datetime import datetime

try:
    import akshare as ak
    import pandas as pd

    endpoint = sys.argv[1]
    params = json.loads(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] else {}
    result = getattr(ak, endpoint)(**params)

    def clean_value(v):
        try:
            if pd.isna(v):
                return None
        except Exception:
            pass
        if hasattr(v, "item"):
            try:
                return clean_value(v.item())
            except Exception:
                pass
        if hasattr(v, "strftime"):
            return v.strftime("%Y-%m-%d")
        return v

    def clean_record(row):
        return {str(k): clean_value(v) for k, v in row.items()}

    def records(value):
        if isinstance(value, pd.DataFrame):
            if value.empty:
                return []
            return [clean_record(row) for row in value.to_dict(orient="records")]
        if isinstance(value, pd.Series):
            return [clean_record(value.to_dict())]
        if isinstance(value, dict):
            return [clean_record(value)]
        if isinstance(value, list):
            rows = []
            for item in value:
                if isinstance(item, dict):
                    rows.append(clean_record(item))
                else:
                    rows.append({"value": clean_value(item)})
            return rows
        if value is None:
            return []
        return [{"value": clean_value(value)}]

    rows = records(result)
    print(json.dumps({
        "endpoint": endpoint,
        "params": params,
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
        "row_count": len(rows),
        "rows": rows,
    }, default=str))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
`;
export const AK_FUND_HISTORY_SCRIPT = `
import json, sys
from datetime import datetime

try:
    import akshare as ak
    import pandas as pd

    symbol = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else "history"
    attempts = []

    def clean_value(v):
        try:
            if pd.isna(v):
                return None
        except Exception:
            pass
        if hasattr(v, "item"):
            try:
                return clean_value(v.item())
            except Exception:
                pass
        if hasattr(v, "strftime"):
            return v.strftime("%Y-%m-%d")
        return v

    def records(df):
        if df is None or df.empty:
            return []
        df = df.copy()
        for col in df.columns:
            name = str(col)
            if "日期" in name or name.lower() in ("date", "nav_date"):
                try:
                    df[col] = pd.to_datetime(df[col]).dt.strftime("%Y-%m-%d")
                except Exception:
                    pass
        return [{str(k): clean_value(v) for k, v in row.items()} for row in df.to_dict(orient="records")]

    def call(endpoint, fn):
        try:
            rows = fn()
            attempts.append({"endpoint": endpoint, "status": "ok", "rows": len(rows) if isinstance(rows, list) else 1})
            return rows
        except Exception as e:
            attempts.append({"endpoint": endpoint, "status": "error", "error": str(e)})
            return []

    def merge_nav(unit_rows, acc_rows):
        by_date = {}
        for r in unit_rows:
            d = r.get("净值日期")
            if d:
                by_date[d] = {
                    "fund_code": symbol,
                    "nav_date": d,
                    "unit_nav": r.get("单位净值"),
                    "daily_return_pct": r.get("日增长率"),
                    "is_open_day": True,
                    "source": "akshare:fund_open_fund_info_em"
                }
        for r in acc_rows:
            d = r.get("净值日期")
            if d:
                by_date.setdefault(d, {
                    "fund_code": symbol,
                    "nav_date": d,
                    "is_open_day": True,
                    "source": "akshare:fund_open_fund_info_em"
                })["accumulated_nav"] = r.get("累计净值")
        return [by_date[d] for d in sorted(by_date)]

    def fetch_nav(symbol):
        unit_rows = call("fund_open_fund_info_em:单位净值走势",
            lambda: records(ak.fund_open_fund_info_em(symbol=symbol, indicator="单位净值走势")))
        acc_rows = call("fund_open_fund_info_em:累计净值走势",
            lambda: records(ak.fund_open_fund_info_em(symbol=symbol, indicator="累计净值走势")))
        return merge_nav(unit_rows, acc_rows)

    def profile_from_rows(rows):
        profile = {}
        for row in rows:
            k = row.get("字段") or row.get("item")
            if k:
                profile[str(k)] = row.get("值") if "值" in row else row.get("value")
        return profile

    def fetch_profile(symbol):
        rows = call("fund_info_ths", lambda: records(ak.fund_info_ths(symbol=symbol)))
        rows = rows + call("fund_individual_basic_info_xq", lambda: records(ak.fund_individual_basic_info_xq(symbol=symbol)))
        return profile_from_rows(rows)

    def fetch_rank(symbol):
        df = ak.fund_open_fund_rank_em(symbol="全部")
        if df is None or df.empty or "基金代码" not in df.columns:
            return []
        df = df[df["基金代码"].astype(str) == symbol]
        return records(df.head(1))

    def fetch_achievement(symbol):
        return call("fund_individual_achievement_xq", lambda: records(ak.fund_individual_achievement_xq(symbol=symbol)))

    def fetch_analysis(symbol):
        return call("fund_individual_analysis_xq", lambda: records(ak.fund_individual_analysis_xq(symbol=symbol)))

    def fetch_purchase_status(symbol):
        def rows():
            df = ak.fund_purchase_em()
            if df is None or df.empty or "基金代码" not in df.columns:
                return []
            df = df[df["基金代码"].astype(str) == symbol]
            return records(df.head(1))
        result = call("fund_purchase_em", rows)
        return result[0] if result else {}

    payload = {
        "symbol": symbol,
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
    }

    if mode == "nav":
        payload["nav"] = fetch_nav(symbol)
    elif mode == "profile":
        payload["profile"] = fetch_profile(symbol)
    elif mode == "purchase":
        payload["purchase"] = fetch_purchase_status(symbol)
    elif mode == "performance":
        rank = call("fund_open_fund_rank_em", lambda: fetch_rank(symbol))
        payload["rank"] = rank[0] if rank else {}
        payload["achievement"] = fetch_achievement(symbol)
        payload["analysis"] = fetch_analysis(symbol)
    else:
        nav = fetch_nav(symbol)
        profile = fetch_profile(symbol)
        rank = call("fund_open_fund_rank_em", lambda: fetch_rank(symbol))
        achievement = fetch_achievement(symbol)
        analysis = fetch_analysis(symbol)
        purchase = fetch_purchase_status(symbol)
        payload.update({
            "nav": nav,
            "profile": profile,
            "rank": rank[0] if rank else {},
            "purchase": purchase,
            "achievement": achievement,
            "analysis": analysis,
        })

    payload["attempts"] = attempts
    print(json.dumps(payload, default=str))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
`;

export const AK_GENERIC_FUND_SCRIPT = `
import json, sys
from datetime import datetime

try:
    import akshare as ak
    import pandas as pd

    endpoint = sys.argv[1]
    params = json.loads(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] else {}
    def fund_fee_em_fallback(symbol, indicator):
        import re
        import requests
        from bs4 import BeautifulSoup
        from io import StringIO

        title_map = {
            "认购费率（前端）": "认购费率",
            "认购费率（后端）": "认购费率",
            "申购费率（前端）": "申购费率",
            "赎回费率（前端）": "赎回费率",
            "赎回费率（后端）": "赎回费率",
        }
        target = title_map.get(indicator, indicator or "申购费率")
        url = f"https://fundf10.eastmoney.com/jjfl_{symbol}.html"
        soup = BeautifulSoup(requests.get(url).text, features="html.parser")
        for title_elem in soup.find_all(name="h4", class_="t"):
            title_text = re.sub(r"\\s+", " ", title_elem.get_text(strip=True)).strip()
            if title_text != target:
                continue
            tables = title_elem.find_all_next("table")
            if target == "申购与赎回金额" and len(tables) >= 2:
                df_1 = pd.read_html(StringIO(str(tables[0])))[0]
                df_2 = pd.read_html(StringIO(str(tables[1])))[0]
                return pd.concat(objs=[df_1, df_2], ignore_index=True)
            if tables:
                return pd.read_html(StringIO(str(tables[0])))[0]
        return pd.DataFrame([])

    def call_endpoint(endpoint, params):
        if endpoint == "fund_fee_em":
            try:
                result = ak.fund_fee_em(**params)
                indicator = params.get("indicator")
                if not isinstance(result, pd.DataFrame) or not result.empty or indicator not in ("认购费率", "认购费率（前端）", "认购费率（后端）", "申购费率", "申购费率（前端）"):
                    return result
            except Exception:
                pass
            return fund_fee_em_fallback(params.get("symbol", ""), params.get("indicator", "申购费率"))
        fn = getattr(ak, endpoint)
        return fn(**params)

    result = call_endpoint(endpoint, params)

    def clean_value(v):
        try:
            if pd.isna(v):
                return None
        except Exception:
            pass
        if hasattr(v, "item"):
            try:
                return clean_value(v.item())
            except Exception:
                pass
        if hasattr(v, "strftime"):
            return v.strftime("%Y-%m-%d")
        return v

    def clean_record(row):
        return {str(k): clean_value(v) for k, v in row.items()}

    def records(value):
        if isinstance(value, pd.DataFrame):
            if value.empty:
                return []
            return [clean_record(row) for row in value.to_dict(orient="records")]
        if isinstance(value, pd.Series):
            return [clean_record(value.to_dict())]
        if isinstance(value, dict):
            return [clean_record(value)]
        if isinstance(value, list):
            rows = []
            for item in value:
                if isinstance(item, dict):
                    rows.append(clean_record(item))
                else:
                    rows.append({"value": clean_value(item)})
            return rows
        if value is None:
            return []
        return [{"value": clean_value(value)}]

    rows = records(result)
    payload = {
        "endpoint": endpoint,
        "params": params,
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
        "row_count": len(rows),
        "rows": rows,
    }
    print(json.dumps(payload, default=str))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
`;
