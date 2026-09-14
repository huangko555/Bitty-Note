from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Protocol

import velopack

from . import __version__
from .config import ConfigStore
from .distribution import is_store_package, open_store_updates
from .errors import UserVisibleError
from .i18n import text


PROJECT_URL = "https://github.com/huangko555/Bitty-Note"
UPDATE_SOURCE_URL = f"{PROJECT_URL}/releases/latest/download"
CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
AUTOMATIC_CHECK_INTERVAL_SECONDS = 60 * 60
AUTOMATIC_READY_INTERVAL_SECONDS = 30
LOCKED_INSTALL_DELAY_SECONDS = 2 * 60
INVISIBLE_INSTALL_DELAY_SECONDS = 30 * 60


@dataclass(frozen=True)
class UpdateRestartState:
    all_windows_saved: bool
    all_windows_invisible: bool


class UpdateRuntime(Protocol):
    """The small seam between update policy and the window implementation."""

    def update_restart_state(self) -> UpdateRestartState: ...

    def prepare_update_restart(self, allow_visible: bool) -> bool: ...

    def notify_update_state_changed(self) -> None: ...


class UpdateService:
    """Own checking, downloading, and safe automatic installation policy."""

    def __init__(
        self,
        config_store: ConfigStore,
        store_package: bool | None = None,
        *,
        runtime: UpdateRuntime | None = None,
        session_locked: Callable[[], bool] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._config_store = config_store
        self._store_package = is_store_package() if store_package is None else store_package
        self._runtime = runtime
        self._session_locked = session_locked or (lambda: False)
        self._clock = clock
        self._lock = threading.RLock()
        self._manager: velopack.UpdateManager | None = None
        self._update_info: Any | None = None
        self._downloaded_update: Any | None = None
        self._download_notified_version: str | None = None
        self._locked_since: float | None = None
        self._invisible_since: float | None = None
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread: threading.Thread | None = None

    def state(self) -> dict[str, str | bool | None]:
        if self._store_package:
            return {
                "status": "store",
                "available_version": None,
                "auto_update": False,
            }
        config = self._config_store.config
        version = config.available_version or config.downloaded_update_version
        failed = bool(version and config.automatic_update_error_version == version)
        return {
            "status": "error" if failed else ("available" if version else "idle"),
            "available_version": version,
            "auto_update": config.auto_update,
        }

    def consume_result(self) -> dict[str, str] | None:
        if self._store_package:
            return None
        config = self._config_store.config
        downloaded = config.downloaded_update_version
        pending = config.pending_update_version
        expected = pending or downloaded
        if not expected:
            return None
        if expected == __version__:
            self._config_store.update(
                downloaded_update_version=None,
                pending_update_version=None,
                available_version=None,
                automatic_update_error_version=None,
            )
            return {"status": "success", "version": expected}
        if not pending:
            # A downloaded update can intentionally remain unapplied while
            # automatic updates are disabled.
            return None
        self._config_store.update(
            pending_update_version=None,
            available_version=expected,
            automatic_update_error_version=expected,
        )
        return {"status": "failed", "version": expected}

    def set_auto_update(self, enabled: bool) -> dict[str, bool]:
        self._config_store.update(auto_update=bool(enabled))
        self._reset_opportunity_timers()
        self._wake.set()
        return {"enabled": bool(enabled)}

    def check(self, force: bool = False) -> dict[str, str | bool | None]:
        with self._lock:
            if self._store_package:
                return self.state()
            config = self._config_store.config
            now_ms = int(time.time() * 1000)
            if (
                not force
                and config.last_update_check_ms is not None
                and now_ms - config.last_update_check_ms < CHECK_INTERVAL_MS
            ):
                return self.state()

            try:
                manager = velopack.UpdateManager(velopack.HttpSource(UPDATE_SOURCE_URL))
                update_info = manager.check_for_updates()
            except RuntimeError as error:
                if "not properly installed" in str(error).lower():
                    return {
                        "status": "unsupported",
                        "available_version": None,
                        "auto_update": False,
                    }
                raise UserVisibleError(text(
                    "Couldn't check for updates. Please try again later.",
                    "无法检查更新，请稍后重试。",
                )) from error
            except Exception as error:
                raise UserVisibleError(text(
                    "Couldn't check for updates. Please try again later.",
                    "无法检查更新，请稍后重试。",
                )) from error

            version = str(update_info.TargetFullRelease.Version) if update_info else None
            self._manager = manager
            self._update_info = update_info
            self._config_store.update(
                last_update_check_ms=now_ms,
                available_version=version,
                automatic_update_error_version=None,
            )
            if version and self._config_store.config.auto_update:
                self._wake.set()
            return self.state()

    def install(self) -> dict[str, str | bool | None]:
        with self._lock:
            if self._store_package:
                try:
                    open_store_updates()
                except OSError as error:
                    raise UserVisibleError(text(
                        "Couldn't open Microsoft Store updates.",
                        "无法打开 Microsoft Store 更新页面。",
                    )) from error
                return self.state()

            update, version = self._download_available_update_locked(force_check=True)
            if update is None or version is None:
                return self.state()
            if self._runtime is not None and not self._runtime.prepare_update_restart(True):
                raise UserVisibleError(text(
                    "Wait for every note to finish saving, then try again.",
                    "请等待所有便签保存完成后重试。",
                ))
            self._apply_downloaded_update_locked(update, version)
            return self.state()

    def start(self) -> None:
        if self._store_package or self._runtime is None:
            return
        with self._lock:
            if self._thread is not None:
                return
            self._thread = threading.Thread(
                target=self._automatic_loop,
                name="bitty-auto-update",
                daemon=True,
            )
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        thread = self._thread
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=2)

    def maintain(self) -> None:
        """Run one deterministic automatic-update maintenance cycle."""
        if (
            self._store_package
            or self._runtime is None
            or not self._config_store.config.auto_update
        ):
            self._reset_opportunity_timers()
            return

        try:
            with self._lock:
                update, version = self._download_available_update_locked()
        except UserVisibleError:
            logging.exception("Automatic update download failed.")
            self._runtime.notify_update_state_changed()
            return
        if update is None or version is None:
            self._reset_opportunity_timers()
            return
        if self._download_notified_version != version:
            self._download_notified_version = version
            self._runtime.notify_update_state_changed()

        runtime_state = self._runtime.update_restart_state()
        now = self._clock()
        locked = self._session_locked()
        locked_ready = locked and runtime_state.all_windows_saved
        invisible_ready = runtime_state.all_windows_saved and runtime_state.all_windows_invisible
        self._locked_since = self._opportunity_since(self._locked_since, locked_ready, now)
        self._invisible_since = self._opportunity_since(
            self._invisible_since, invisible_ready, now
        )

        allow_visible = False
        due = False
        if self._locked_since is not None:
            due = now - self._locked_since >= LOCKED_INSTALL_DELAY_SECONDS
            allow_visible = due
        if not due and self._invisible_since is not None:
            due = now - self._invisible_since >= INVISIBLE_INSTALL_DELAY_SECONDS
        if not due:
            return
        if allow_visible and not self._session_locked():
            self._locked_since = None
            return
        if not self._runtime.prepare_update_restart(allow_visible):
            return

        try:
            with self._lock:
                self._apply_downloaded_update_locked(update, version)
        except UserVisibleError:
            logging.exception("Automatic update installation failed.")
            self._runtime.notify_update_state_changed()

    def _automatic_loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.maintain()
            except Exception:
                logging.exception("Unexpected automatic update failure.")
            with self._lock:
                ready = (
                    self._downloaded_update is not None
                    and self._config_store.config.auto_update
                )
            interval = AUTOMATIC_READY_INTERVAL_SECONDS if ready else AUTOMATIC_CHECK_INTERVAL_SECONDS
            self._wake.wait(interval)
            self._wake.clear()

    def _download_available_update_locked(
        self,
        *,
        force_check: bool = False,
    ) -> tuple[Any | None, str | None]:
        if self._downloaded_update is not None:
            return self._downloaded_update, self._config_store.config.downloaded_update_version

        manager = self._manager
        if manager is None and force_check:
            state = self.check(force=True)
            if state["status"] not in {"available", "error"}:
                return None, None
            manager = self._manager
        if manager is None:
            try:
                manager = velopack.UpdateManager(velopack.HttpSource(UPDATE_SOURCE_URL))
                downloaded = manager.get_update_pending_restart()
            except RuntimeError as error:
                if "not properly installed" in str(error).lower():
                    return None, None
                raise self._automatic_update_error() from error
            except Exception as error:
                raise self._automatic_update_error() from error
            self._manager = manager
            if downloaded is not None:
                version = self._config_store.config.downloaded_update_version
                if version is None:
                    version = str(getattr(downloaded, "Version", "")) or None
                self._downloaded_update = downloaded
                return downloaded, version

        if self._update_info is None or force_check:
            state = self.check(force=force_check)
            if state["status"] not in {"available", "error"}:
                return None, None
            if self._update_info is None and not force_check:
                state = self.check(force=True)
                if state["status"] not in {"available", "error"}:
                    return None, None
        manager = self._manager
        update_info = self._update_info
        version = self._config_store.config.available_version
        if manager is None or update_info is None or version is None:
            return None, None
        try:
            manager.download_updates(update_info)
        except Exception as error:
            self._config_store.update(
                pending_update_version=None,
                automatic_update_error_version=version,
            )
            raise self._automatic_update_error() from error
        self._downloaded_update = update_info
        self._config_store.update(
            downloaded_update_version=version,
            automatic_update_error_version=None,
        )
        return update_info, version

    def _apply_downloaded_update_locked(self, update: Any, version: str) -> None:
        manager = self._manager
        if manager is None:
            raise UserVisibleError(text(
                "No update is ready to install.",
                "没有可安装的更新。",
            ))
        self._config_store.update(pending_update_version=version)
        try:
            manager.apply_updates_and_restart(update)
        except Exception as error:
            self._config_store.update(automatic_update_error_version=version)
            raise self._automatic_update_error() from error

    @staticmethod
    def _automatic_update_error() -> UserVisibleError:
        return UserVisibleError(text(
            "Automatic update failed. Please download it manually from GitHub.",
            "自动更新失败，请前往 GitHub 手动下载。",
        ))

    @staticmethod
    def _opportunity_since(
        previous: float | None,
        ready: bool,
        now: float,
    ) -> float | None:
        if not ready:
            return None
        return now if previous is None else previous

    def _reset_opportunity_timers(self) -> None:
        self._locked_since = None
        self._invisible_since = None
