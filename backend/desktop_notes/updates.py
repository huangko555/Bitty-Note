from __future__ import annotations

import threading
import time
from typing import Any

import velopack

from . import __version__
from .config import ConfigStore
from .distribution import is_store_package, open_store_updates
from .errors import UserVisibleError
from .i18n import text


PROJECT_URL = "https://github.com/huangko555/Bitty-Note"
CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000


class UpdateService:
    def __init__(
        self,
        config_store: ConfigStore,
        store_package: bool | None = None,
    ):
        self._config_store = config_store
        self._store_package = is_store_package() if store_package is None else store_package
        self._lock = threading.RLock()
        self._manager: velopack.UpdateManager | None = None
        self._update_info: Any | None = None

    def state(self) -> dict[str, str | None]:
        if self._store_package:
            return {"status": "store", "available_version": None}
        version = self._config_store.config.available_version
        return {
            "status": "available" if version else "idle",
            "available_version": version,
        }

    def consume_result(self) -> dict[str, str] | None:
        if self._store_package:
            return None
        pending = self._config_store.config.pending_update_version
        if not pending:
            return None
        succeeded = pending == __version__
        self._config_store.update(
            pending_update_version=None,
            available_version=None if succeeded else pending,
        )
        return {
            "status": "success" if succeeded else "failed",
            "version": pending,
        }

    def check(self, force: bool = False) -> dict[str, str | None]:
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
                manager = velopack.UpdateManager(
                    velopack.GithubSource(PROJECT_URL, None, False)
                )
                update_info = manager.check_for_updates()
            except RuntimeError as error:
                if "not properly installed" in str(error).lower():
                    return {"status": "unsupported", "available_version": None}
                raise UserVisibleError(
                    text(
                        "Couldn't check for updates. Please try again later.",
                        "无法检查更新，请稍后重试。",
                    )
                ) from error
            except Exception as error:
                raise UserVisibleError(
                    text(
                        "Couldn't check for updates. Please try again later.",
                        "无法检查更新，请稍后重试。",
                    )
                ) from error

            version = (
                str(update_info.TargetFullRelease.Version) if update_info else None
            )
            self._manager = manager
            self._update_info = update_info
            self._config_store.update(
                last_update_check_ms=now_ms,
                available_version=version,
            )
            return self.state()

    def install(self) -> dict[str, str | None]:
        with self._lock:
            if self._store_package:
                try:
                    open_store_updates()
                except OSError as error:
                    raise UserVisibleError(
                        text(
                            "Couldn't open Microsoft Store updates.",
                            "无法打开 Microsoft Store 更新页面。",
                        )
                    ) from error
                return self.state()
            state = self.check(force=True)
            if state["status"] != "available":
                return state
            manager = self._manager
            update_info = self._update_info
            version = state["available_version"]
            if manager is None or update_info is None or version is None:
                raise UserVisibleError(
                    text("No update is ready to install.", "没有可安装的更新。")
                )
            try:
                manager.download_updates(update_info)
                self._config_store.update(pending_update_version=version)
                manager.apply_updates_and_restart(update_info)
            except Exception as error:
                self._config_store.update(pending_update_version=None)
                raise UserVisibleError(
                    text(
                        "Automatic update failed. Please download it manually from GitHub.",
                        "自动更新失败，请前往 GitHub 手动下载。",
                    )
                ) from error
            return self.state()
