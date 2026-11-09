"""Check compact layouts in real WebView2 after running npm run build.

Run from an interactive Windows desktop with --language zh-CN or --language en.
All note data and configuration are isolated under .desktop-notes-dev.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import threading
import time
from pathlib import Path

import webview

from desktop_notes.bridge import DesktopBridge, javascript_api
from desktop_notes.config import ConfigStore
from desktop_notes.errors import UserVisibleError
from desktop_notes.platform_windows import (
    _run_on_native_ui_thread,
    _webview_control,
    install_webview_recovery,
    resize_window_without_showing,
)


class LayoutBridge(DesktopBridge):
    fail_save = False

    def save_note(self, *args, **kwargs):
        if self.fail_save:
            raise UserVisibleError(("C:/Layout/" + "VeryLongPathSegment" * 12 + "\n") * 8)
        return super().save_note(*args, **kwargs)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--language", choices=("zh-CN", "en"), default="zh-CN")
    language = parser.parse_args().language
    root = Path(__file__).resolve().parents[1]
    index = root / "dist" / "web" / "index.html"
    if not index.is_file():
        raise SystemExit("Run npm run build before the native layout check.")
    profile = root / ".desktop-notes-dev" / f"compact-layout-{os.getpid()}-{time.time_ns()}"
    notes = profile / "notes"
    notes.mkdir(parents=True)
    name = "Compact layout with a very long title for minimum width.md"
    (notes / name).write_text("# Layout test\n\n- [ ] Save and layout check\n", encoding="utf-8")
    for number in range(6):
        filename = f"Long title {number} with repeated words and narrow window content.md"
        (notes / filename).write_text("Long preview " * 24, encoding="utf-8")
    os.environ["LOCALAPPDATA"] = str(profile)
    logging.getLogger("pywebview").setLevel(logging.CRITICAL)
    store = ConfigStore(profile / "config.json", notes)
    store.update(language=language, auto_update=False)
    bridge = LayoutBridge(store, window_role="note", initial_note=name)
    window = webview.create_window(
        "Compact layout test", str(index), js_api=javascript_api(bridge),
        width=300, height=380, min_size=(300, 380), frameless=True,
        easy_drag=False, background_color="#fffdf5",
    )
    bridge.attach_window(window)
    failures = []

    def wait_until(predicate, timeout=6):
        deadline = time.monotonic() + timeout
        while not predicate():
            if time.monotonic() >= deadline:
                raise AssertionError("Layout check did not reach the requested UI state")
            time.sleep(0.02)

    def click(selector):
        window.run_js(f"document.querySelector({json.dumps(selector)}).click()")

    def measure(selector):
        return window.evaluate_js("""((selector) => {
            const element = document.querySelector(selector);
            const rect = element.getBoundingClientRect();
            return {
                left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
                width: rect.width, height: rect.height, viewport: [innerWidth, innerHeight],
                scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
                scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
            };
        })(""" + json.dumps(selector) + ")")

    def check_bounds(label, selector):
        bounds = measure(selector)
        width, height = bounds["viewport"]
        if (
            bounds["width"] <= 0 or bounds["height"] <= 0
            or bounds["left"] < -1 or bounds["top"] < -1
            or bounds["right"] > width + 1 or bounds["bottom"] > height + 1
        ):
            failures.append({"case": label, "bounds": bounds})
        return bounds

    def probe():
        try:
            wait_until(lambda: bridge._window_ready)
            install_webview_recovery(window)
            sizes = ((300, 380, 1), (328, 380, 1), (350, 530, 1), (300, 380, 1.25))
            for width, height, zoom in sizes:
                resize_window_without_showing(window, width, height)
                _run_on_native_ui_thread(
                    window.native,
                    lambda: setattr(_webview_control(window.native), "ZoomFactor", zoom),
                )
                time.sleep(0.1)
                label = f"{language} {width}x{height} zoom={zoom}"
                click('[data-action="note-menu"]')
                wait_until(lambda: window.evaluate_js(
                    'document.querySelectorAll(".note-window-menu-note-item").length === 5'
                ))
                menu = check_bounds(label + " menu", ".note-window-menu")
                check_bounds(label + " home action", ".note-window-menu-view-all")
                if menu["scrollWidth"] > menu["clientWidth"] + 1:
                    failures.append({"case": label + " menu horizontal overflow", "bounds": menu})
                window.run_js('document.querySelector(".note-window-menu-note-list").scrollTop = 10000')
                check_bounds(label + " last quick note", ".note-window-menu-note-item:last-child")
                click('[data-action="note-menu"]')
                window.run_js('document.querySelector(".format-toolbar").classList.add("visible")')
                check_bounds(label + " toolbar", ".format-toolbar")
                check_bounds(label + " toolbar settings button", ".editor-settings-button")
                click(".editor-settings-button")
                appearance = check_bounds(label + " settings", ".editor-settings-popover")
                if appearance["scrollWidth"] > appearance["clientWidth"] + 1:
                    failures.append({"case": label + " settings horizontal overflow", "bounds": appearance})
                click(".editor-settings-button")

            _run_on_native_ui_thread(
                window.native, lambda: setattr(_webview_control(window.native), "ZoomFactor", 1),
            )
            resize_window_without_showing(window, 300, 380)
            bridge.fail_save = True
            click('.ProseMirror input[type="checkbox"]')
            wait_until(lambda: window.evaluate_js('Boolean(document.querySelector(".modal-panel"))'))
            panel = check_bounds(language + " long save error dialog", ".modal-panel")
            if panel["scrollWidth"] > panel["clientWidth"] + 1:
                failures.append({"case": language + " dialog horizontal overflow", "bounds": panel})
            window.run_js('document.querySelector(".modal-panel").scrollTop = 10000')
            check_bounds(language + " dialog actions", ".modal-actions")
            print(json.dumps({"language": language, "failures": failures}), flush=True)
            os._exit(1 if failures else 0)
        except BaseException as error:
            print(f"ERROR {error}", flush=True)
            os._exit(2)

    def timed_out():
        print("ERROR native layout check timed out", flush=True)
        os._exit(2)

    watchdog = threading.Timer(30, timed_out)
    watchdog.daemon = True
    watchdog.start()
    webview.start(probe, gui="edgechromium", private_mode=True)


if __name__ == "__main__":
    main()
