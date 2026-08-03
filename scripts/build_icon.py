from __future__ import annotations

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "app-icon.png"
TARGET = ROOT / "assets" / "app-icon.ico"
ICON_SIZES = [(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)]


def main() -> None:
    image = Image.open(SOURCE).convert("RGBA")
    if image.width != image.height:
        raise RuntimeError("应用图标必须为正方形。")
    if image.getchannel("A").getbbox() is None:
        raise RuntimeError("应用图标没有可见内容。")

    image.save(TARGET, format="ICO", sizes=ICON_SIZES)
    print(f"Generated {TARGET.relative_to(ROOT)} with its original canvas.")


if __name__ == "__main__":
    main()
