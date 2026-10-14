"""Independently validate committed floating-point goldens with Decimal central moments."""
import json
import math
from decimal import Decimal, localcontext
from pathlib import Path

reference_path = Path(__file__).resolve().parents[1] / "src/quant/test/fixtures/numeric-decimal-goldens.json"
reference = json.loads(reference_path.read_text(encoding="utf-8"))
with localcontext() as context:
    context.prec = reference["precision"]
    for fixture in reference["cases"]:
        values = [Decimal.from_float(float(value)) for value in fixture["values"]]
        count = Decimal(len(values))
        average = sum(values) / count
        centered = [value - average for value in values]
        squares = sum(value ** 2 for value in centered)
        deviation = (squares / (count - 1)).sqrt()
        population = (squares / count).sqrt()
        skewness = sum(value ** 3 for value in centered) / count / population ** 3 if population else Decimal(0)
        kurtosis = sum(value ** 4 for value in centered) / count / population ** 4 - 3 if population else Decimal(0)
        expected = {"mean": float(average), "sampleDeviation": float(deviation),
                    "skewness": float(skewness), "kurtosis": float(kurtosis)}
        actual = {"mean": fixture["mean"], "sampleDeviation": fixture["sampleDeviation"], **fixture["shape"]}
        for field, value in expected.items():
            saved = actual[field]
            valid = saved is None if not math.isfinite(value) else saved is not None and math.isclose(saved, value, rel_tol=1e-12, abs_tol=0)
            if not valid:
                raise AssertionError(f"case {fixture['case']} {field}: saved={saved}, Decimal={value}")
print(f"Validated {len(reference['cases'])} numerical references at {reference['precision']}-digit precision.")
