from __future__ import annotations

from typing import Literal


AppLanguage = Literal["en", "zh-CN"]
SUPPORTED_LANGUAGES = {"en", "zh-CN"}
_language: AppLanguage = "en"


def set_language(language: str) -> AppLanguage:
    global _language
    _language = language if language in SUPPORTED_LANGUAGES else "en"  # type: ignore[assignment]
    return _language


def text(english: str, chinese: str) -> str:
    return chinese if _language == "zh-CN" else english
