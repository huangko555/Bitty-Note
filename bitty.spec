# -*- mode: python ; coding: utf-8 -*-

analysis = Analysis(
    ["run_bitty.py"],
    pathex=["backend"],
    binaries=[],
    datas=[
        ("dist/web", "dist/web"),
        ("web/src/assets/fonts/OFL-FuzzyBubbles.txt", "licenses"),
        ("web/src/assets/fonts/OFL-SarasaGothic.txt", "licenses"),
        ("web/src/assets/fonts/OFL-SmileySans.txt", "licenses"),
    ],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=1,
)

pyz = PYZ(analysis.pure)

exe = EXE(
    pyz,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="Bitty-Note",
    icon="assets/app-icon.ico",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
)

bundle = COLLECT(
    exe,
    analysis.binaries,
    analysis.datas,
    strip=False,
    upx=False,
    name="Bitty-Note",
)
