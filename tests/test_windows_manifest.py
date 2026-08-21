from pathlib import Path
from xml.etree import ElementTree


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = PROJECT_ROOT / "packaging" / "Bitty-Note.manifest"


def test_windows_build_declares_per_monitor_v2_dpi_awareness() -> None:
    root = ElementTree.parse(MANIFEST_PATH).getroot()
    namespace = "{http://schemas.microsoft.com/SMI/2016/WindowsSettings}"
    dpi_awareness = root.find(f".//{namespace}dpiAwareness")

    assert dpi_awareness is not None
    assert dpi_awareness.text is not None
    assert dpi_awareness.text.split(",", 1)[0].strip().lower() == "permonitorv2"


def test_pyinstaller_build_embeds_the_windows_manifest() -> None:
    spec = (PROJECT_ROOT / "bitty.spec").read_text(encoding="utf-8")

    assert 'manifest="packaging/Bitty-Note.manifest"' in spec
