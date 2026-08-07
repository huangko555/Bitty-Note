from PIL import Image, ImageDraw

from scripts.build_msix_assets import (
    UNPLATED_ALTERNATE_FORMS,
    UNPLATED_TARGET_SIZES,
    main,
)


def test_msix_assets_include_taskbar_unplated_variant(tmp_path, monkeypatch):
    source = tmp_path / "source.png"
    output = tmp_path / "Assets"
    image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    ImageDraw.Draw(image).rounded_rectangle((4, 4, 59, 59), radius=12, fill=(255, 255, 255, 255))
    image.save(source)

    monkeypatch.setattr("sys.argv", ["build_msix_assets.py", str(source), str(output)])
    main()

    assert 44 in UNPLATED_TARGET_SIZES
    expected = {
        output / f"Square44x44Logo.targetsize-{size}_altform-{alternate_form}.png"
        for size in UNPLATED_TARGET_SIZES
        for alternate_form in UNPLATED_ALTERNATE_FORMS
    }
    assert all(path.is_file() for path in expected)
    assert Image.open(output / "Square44x44Logo.targetsize-44_altform-unplated.png").getpixel((0, 0))[3] == 0
    assert Image.open(output / "Square44x44Logo.targetsize-44_altform-lightunplated.png").getpixel((0, 0))[3] == 0
