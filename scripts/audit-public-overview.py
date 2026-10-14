"""Independent Decimal audit of retained public Overview inputs and rendered lines."""
import argparse
from collections import Counter
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re

INDICES = ["000001.SH", "399001.SZ", "000300.SH", "000905.SH", "399006.SZ"]
PERCENT = re.compile(r"([+-]?\d+(?:\.\d+)?)%$")


def audit_receipt(receipt):
    if receipt.get("mode") != "actual-public-akshare-app-runtime-overview":
        raise ValueError("Expected an explicit public Overview measurement receipt")
    expected_rows = Counter(INDICES + receipt["portfolio"])
    checks = []
    for observation in receipt["observations"]:
        sample = observation["sample"]
        inputs = {item["symbol"]: item for item in observation.get("publicInputs", [])}
        lines = [item["text"] for item in observation.get("publicPanel", [])]
        rendered = []
        for index, line in enumerate(lines):
            parts = line.split()
            match = PERCENT.search(line)
            if parts and parts[0] in expected_rows and match:
                rendered.append((parts[0], Decimal(match.group(1)), lines[index + 1] if index + 1 < len(lines) else ""))
        checks.append({"sample": sample, "code": "complete-row-identities", "passed":
            Counter(symbol for symbol, _, _ in rendered) == expected_rows
            and set(inputs) == set(expected_rows)
            and receipt["expectedRows"] == sum(expected_rows.values())
            and receipt["expectedUniqueRequests"] == len(expected_rows)})
        checks.append({"sample": sample, "code": "complete-current-refresh", "passed":
            observation.get("outcome") == "success"
            and observation.get("rows") == sum(expected_rows.values())
            and observation.get("availableRows") == sum(expected_rows.values())
            and observation.get("rowIdentitiesMatch") is True
            and len(observation.get("quoteAudit", [])) == sum(expected_rows.values())
            and all(item.get("passed") is True for item in observation.get("quoteAudit", []))})
        for symbol, displayed, attribution in rendered:
            item = inputs.get(symbol, {})
            bars = item.get("bars", [])
            arithmetic = False
            dates = False
            if len(bars) >= 2:
                previous, latest = Decimal(str(bars[-2]["close"])), Decimal(str(bars[-1]["close"]))
                if previous.is_finite() and latest.is_finite() and previous > 0:
                    expected = (latest / previous - 1) * 100
                    # UI uses two decimal places. Keep the independent arithmetic exact.
                    arithmetic = abs(displayed - expected) <= Decimal("0.005000000001")
                dates = item.get("asOfDate") == bars[-1]["date"] and bars[-1]["date"] in attribution
            checks.extend([
                {"sample": sample, "symbol": symbol, "code": "decimal-rendered-change", "passed": arithmetic},
                {"sample": sample, "symbol": symbol, "code": "rendered-source", "passed": item.get("source") == "akshare" and "AKShare" in attribution},
                {"sample": sample, "symbol": symbol, "code": "rendered-price-date", "passed": dates},
            ])
    return {"passed": bool(checks) and len(receipt["observations"]) == receipt["samples"] and all(item["passed"] for item in checks), "checks": checks}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("receipts", nargs="+")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output)
    if output.exists():
        raise ValueError("Output already exists; choose a new artifact")
    results = []
    for name in args.receipts:
        path = Path(name)
        contents = path.read_bytes()
        result = audit_receipt(json.loads(contents))
        results.append({"receipt": name, "sha256": hashlib.sha256(contents).hexdigest(), **result})
    result = {"scope": "public rendered percentage/source/date audit, not provider accuracy or terminal pixels", "passed": all(item["passed"] for item in results), "results": results,
        "auditorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    with output.open("x", encoding="utf8") as handle:
        json.dump(result, handle, indent=2)
    print(json.dumps({"output": str(output), "passed": result["passed"], "checks": sum(len(item["checks"]) for item in results)}))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
