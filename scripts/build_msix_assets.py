from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


ASSETS = {
    "Square44x44Logo.png": (44, 44),
    "Square150x150Logo.png": (150, 150),
    "Square310x310Logo.png": (310, 310),
    "Wide310x150Logo.png": (310, 150),
    "StoreLogo.png": (50, 50),
}

UNPLATED_TARGET_SIZES = (16, 24, 32, 48, 256)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    source = Image.open(args.source).convert("RGBA")
    args.output.mkdir(parents=True, exist_ok=True)
    for filename, size in ASSETS.items():
        canvas = Image.new("RGBA", size, (0, 0, 0, 0))
        fitted = source.copy()
        fitted.thumbnail(size, Image.Resampling.LANCZOS)
        x = (size[0] - fitted.width) // 2
        y = (size[1] - fitted.height) // 2
        canvas.alpha_composite(fitted, (x, y))
        canvas.save(args.output / filename)

    for size in UNPLATED_TARGET_SIZES:
        target = source.resize((size, size), Image.Resampling.LANCZOS)
        filename = f"Square44x44Logo.targetsize-{size}_altform-unplated.png"
        target.save(args.output / filename)


if __name__ == "__main__":
    main()
