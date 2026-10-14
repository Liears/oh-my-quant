/** Probe reviewed public inputs only; never import or execute an installed skill. */
export const BREADTH_NETWORK_SCRIPT = String.raw`
import csv, io, json, math, sys
from datetime import date

result = {"ok": False, "executable": sys.executable, "reason": "dependency"}
try:
    import requests
    class ProbeFailure(Exception):
        pass
    session = requests.Session()
    session.trust_env = False  # No ambient netrc credentials or proxy credentials.
    def read_csv(url):
        with session.get(url, timeout=(5, 5), stream=True, allow_redirects=False) as response:
            if response.status_code != 200:
                raise ProbeFailure("http-" + str(response.status_code))
            chunks, size = [], 0
            for chunk in response.iter_content(65536):
                size += len(chunk)
                if size > 4 * 1024 * 1024:
                    raise ProbeFailure("response-too-large")
                chunks.append(chunk)
        reader = csv.DictReader(io.StringIO(b"".join(chunks).decode("utf-8-sig")), strict=True)
        fields = reader.fieldnames or []
        if len(fields) != len(set(fields)):
            raise ProbeFailure("invalid-csv")
        rows = list(reader)
        if not rows or any(None in row or None in row.values() for row in rows):
            raise ProbeFailure("invalid-csv")
        return set(fields), rows
    result["reason"] = "network"
    fields, rows = read_csv(sys.argv[1])
    numeric = ["S&P500_Price", "Breadth_Index_Raw", "Breadth_Index_200MA", "Breadth_Index_8MA"]
    boolean = ["Bearish_Signal", "Is_Peak", "Is_Trough", "Is_Trough_8MA_Below_04"]
    if not set(["Date", "Breadth_200MA_Trend"] + numeric + boolean).issubset(fields):
        raise ProbeFailure("invalid-csv")
    dates = []
    for row in rows:
        day = date.fromisoformat(row["Date"])
        if day.isoformat() != row["Date"] or any(not math.isfinite(float(row[key])) for key in numeric):
            raise ProbeFailure("invalid-csv")
        int(row["Breadth_200MA_Trend"])
        if any(row[key].strip().lower() not in ("true", "false", "1", "0", "yes", "no") for key in boolean):
            raise ProbeFailure("invalid-csv")
        dates.append(day)
    if len(dates) != len(set(dates)):
        raise ProbeFailure("invalid-csv")
    latest = max(dates)
    age = (date.fromisoformat(sys.argv[3]) - latest).days
    result.update(detailRows=len(rows), latestDate=latest.isoformat(), ageDays=age)
    if age < 0 or age > 5:
        raise ProbeFailure("future-data" if age < 0 else "stale-data")
    fields, summary = read_csv(sys.argv[2])
    if not {"Metric", "Value"}.issubset(fields) or any(not row["Metric"].strip() or not row["Value"].strip() for row in summary):
        raise ProbeFailure("invalid-summary")
    if len({row["Metric"].strip() for row in summary}) != len(summary):
        raise ProbeFailure("invalid-summary")
    result.update(ok=True, summaryRows=len(summary), reason="observed")
except ImportError:
    result["reason"] = "dependency"
except (ValueError, KeyError, csv.Error, UnicodeError):
    result["reason"] = "invalid-csv"
except Exception as error:
    result["reason"] = str(error) if type(error).__name__ == "ProbeFailure" else "network"
print(json.dumps(result))
`;
