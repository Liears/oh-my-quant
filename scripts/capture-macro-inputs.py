"""Run the pinned macro entry unchanged and capture exactly what its price client returns."""

import json
import runpy
import sys
from pathlib import Path

SYMBOLS = {"RSP", "SPY", "IWM", "TLT", "SHY", "HYG", "LQD", "XLY", "XLP"}


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("usage: capture-macro-inputs.py PINNED_ENTRY INPUT_DIR OUTPUT_DIR")
    pinned = Path(sys.argv[1]).resolve(strict=True)
    inputs = Path(sys.argv[2]).resolve(strict=True)
    output = Path(sys.argv[3]).resolve(strict=True)
    if not pinned.is_file() or not inputs.is_dir() or not output.is_dir() or any(inputs.iterdir()):
        raise SystemExit("macro input capture requires an existing pinned entry and empty isolated directories")

    sys.path.insert(0, str(pinned.parent))
    namespace = runpy.run_path(str(pinned), run_name="__ohq_capture__")
    client = namespace.get("FMPClient")
    entry = namespace.get("main")
    if client is None or not callable(entry) or not callable(getattr(client, "get_historical_prices", None)):
        raise SystemExit("pinned macro entry has no expected price-client boundary")
    original = client.get_historical_prices

    def capture(self, symbol: str, days: int = 600):
        response = original(self, symbol, days=days)
        if response is None:
            return None
        if symbol not in SYMBOLS or not isinstance(response, dict) or response.get("symbol") != symbol:
            raise RuntimeError("unexpected pinned macro price-client response")
        data = json.dumps(response, allow_nan=False, separators=(",", ":")).encode("utf-8")
        if len(data) > 1024 * 1024:
            raise RuntimeError("pinned macro price-client response exceeds input limit")
        with (inputs / f"{symbol}.json").open("xb") as target:
            target.write(data)
        return response

    client.get_historical_prices = capture
    sys.argv = [str(pinned), "--output-dir", str(output)]
    entry()


if __name__ == "__main__":
    main()
