"""Synthetic chart and immutable public skill fixture; reads Git objects without changing the install."""
import hashlib
import json
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw, ImageFont

root = Path("output/chart-image-validation-2026-10-13")
root.mkdir(parents=True, exist_ok=True)
pin = "a2506fd1bab662723fb7142734320fef23fc48fa"
repo = Path(".ohquant/skills/tradermonty-claude-trading-skills")
target = root / "skills/tradermonty-claude-trading-skills/skills/technical-analyst"
files = subprocess.check_output(["git", "-C", str(repo), "ls-tree", "-r", "--name-only", pin, "skills/technical-analyst"], text=True).splitlines()
manifest = {}
for name in files:
    relative = Path(name).relative_to("skills/technical-analyst")
    data = subprocess.check_output(["git", "-C", str(repo), "show", f"{pin}:{name}"])
    dest = target / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    manifest[str(relative)] = hashlib.sha256(data).hexdigest()
license_bytes = subprocess.check_output(["git", "-C", str(repo), "show", f"{pin}:LICENSE"])
(root / "skills/tradermonty-claude-trading-skills/LICENSE").write_bytes(license_bytes)

chart = Image.new("RGB", (1100, 750), "white")
draw = ImageDraw.Draw(chart)
font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 22)
small = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 18)
draw.text((95, 15), "QZ-47 | SYNTHETIC WEEKLY CHART | NOT MARKET DATA", fill="black", font=font)
prices = [105, 108, 107, 115, 118, 120, 123, 130, 129, 140, 144, 147]
volumes = [100, 110, 90, 120, 130, 130, 145, 165, 155, 180, 200, 220]
for value in range(90, 161, 10):
    y = 450 - (value - 90) * 5
    draw.line((95, y, 1015, y), fill="#dddddd")
    draw.text((40, y - 10), str(value), fill="black", font=small)
for i, value in enumerate(prices):
    x, y = 115 + i * 77, 450 - (value - 90) * 5
    if i:
        draw.line((x - 77, 450 - (prices[i - 1] - 90) * 5, x, y), fill="#0055aa", width=5)
    draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill="#0055aa")
    draw.text((x - 13, y - 28), str(value), fill="#003366", font=small)
    draw.rectangle((x - 20, 700 - volumes[i] * 0.7, x + 20, 700), fill="#339988")
draw.text((95, 475), "Weekly close | 2026-07-10 to 2026-09-25 | final close 147", fill="black", font=font)
draw.text((95, 520), "Weekly volume (synthetic units): 100 to 220", fill="black", font=font)
draw.text((95, 715), "No account values. Line chart; no OHLC candles or moving averages.", fill="black", font=small)
chart.save(root / "synthetic-weekly.png")
(root / "fixture.json").write_text(json.dumps({"scope": "synthetic-public-chart", "pin": pin, "files": manifest,
    "expectedReadings": {"label": "QZ-47", "period": "weekly", "lastDate": "2026-09-25", "lastClose": 147,
        "trend": "upward with pullbacks", "volume": "100 to 220; generally rising", "notPresent": ["OHLC candles", "moving averages", "account positions"]}}, indent=2), encoding="utf-8")
print(root)
