import copy
from pathlib import Path
import runpy
import unittest

auditor = runpy.run_path(str(Path(__file__).with_name("audit-public-overview.py")))
INDICES, audit_receipt = auditor["INDICES"], auditor["audit_receipt"]


def fixture():
    symbols = INDICES + ["AAPL"]
    return {"mode": "actual-public-akshare-app-runtime-overview", "portfolio": ["AAPL"], "expectedRows": 6, "expectedUniqueRequests": 6, "samples": 1,
        "observations": [{"sample": 1, "outcome": "success", "rows": 6, "availableRows": 6, "rowIdentitiesMatch": True,
            "quoteAudit": [{"passed": True} for _ in symbols],
            "publicInputs": [{"symbol": symbol, "source": "akshare", "asOfDate": "2026-10-12", "bars": [
                {"date": "2026-10-09", "close": 100}, {"date": "2026-10-12", "close": 110}]} for symbol in symbols],
            "publicPanel": [{"text": text} for symbol in symbols for text in [f"{symbol} Name +10.00%", "2026-10-12 · AKShare"]]}]}


class PublicOverviewAudit(unittest.TestCase):
    def test_accepts_independently_calculable_price_changes(self):
        self.assertTrue(audit_receipt(fixture())["passed"])

    def test_green_producer_checks_cannot_hide_a_wrong_rendered_percentage(self):
        receipt = fixture()
        receipt["observations"][0]["publicPanel"][0]["text"] = "000001.SH Name +11.00%"
        result = audit_receipt(receipt)
        self.assertFalse(result["passed"])
        self.assertIn("decimal-rendered-change", [item["code"] for item in result["checks"] if not item["passed"]])

    def test_green_producer_checks_cannot_hide_changed_source_prices(self):
        receipt = fixture()
        receipt["observations"][0]["publicInputs"][0]["bars"][-1]["close"] = 120
        self.assertFalse(audit_receipt(receipt)["passed"])

    def test_rejects_missing_rows_wrong_dates_and_wrong_source(self):
        original = fixture()
        for text in ["2026-10-09 · AKShare", "2026-10-12 · WrongSource"]:
            receipt = copy.deepcopy(original)
            receipt["observations"][0]["publicPanel"][1]["text"] = text
            self.assertFalse(audit_receipt(receipt)["passed"])
        original["observations"][0]["publicPanel"] = original["observations"][0]["publicPanel"][2:]
        self.assertFalse(audit_receipt(original)["passed"])

    def test_shared_index_requires_both_display_rows_and_one_input(self):
        receipt = fixture()
        receipt["portfolio"].append("000001.SH")
        receipt["expectedRows"] = 7
        observation = receipt["observations"][0]
        observation["rows"] = observation["availableRows"] = 7
        observation["quoteAudit"].append({"passed": True})
        observation["publicPanel"].extend(copy.deepcopy(observation["publicPanel"][:2]))
        self.assertTrue(audit_receipt(receipt)["passed"])
        observation["publicPanel"] = observation["publicPanel"][:-2]
        self.assertFalse(audit_receipt(receipt)["passed"])


if __name__ == "__main__":
    unittest.main()
