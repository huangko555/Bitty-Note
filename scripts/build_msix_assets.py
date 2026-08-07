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

# Shell uses target-sized variants for taskbar, jump-list, Start, and search
# surfaces. Cover the common Windows 11 scale factors so it never needs to
# fall back to a plated resource. Light Shell has its own alternate form.
UNPLATED_TARGET_SIZES = (16, 20, 24, 30, 32, 36, 40, 44, 48, 60, 64, 72, 96, 256)
UNPLATED_ALTERNATE_FORMS = ("unplated", "lightunplated")


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
        for alternate_form in UNPLATED_ALTERNATE_FORMS:
            filename = (
                f"Square44x44Logo.targetsize-{size}_altform-{alternate_form}.png"
            )
            target.save(args.output / filename)


if __name__ == "__main__":
    main()
