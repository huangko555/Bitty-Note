from __future__ import annotations

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "app-icon.png"
TARGET = ROOT / "assets" / "app-icon.ico"
ICON_SIZES = [(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)]


def main() -> None:
    image = Image.open(SOURCE).convert("RGBA")
    visible_alpha = image.getchannel("A").point(lambda alpha: 255 if alpha >= 8 else 0)
    bounds = visible_alpha.getbbox()
    if bounds is None:
        raise RuntimeError("应用图标没有可见内容。")

    cropped = image.crop(bounds)
    side = max(cropped.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.alpha_composite(
        cropped,
        ((side - cropped.width) // 2, (side - cropped.height) // 2),
    )
    square.save(TARGET, format="ICO", sizes=ICON_SIZES)
    print(f"Generated {TARGET.relative_to(ROOT)} from bounds {bounds}.")


if __name__ == "__main__":
    main()
