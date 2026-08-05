"""Fail the build when the application version declarations diverge."""

from __future__ import annotations

import ast
import json
import tomllib
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent


def read_python_version() -> str:
    source = (PROJECT_ROOT / "backend" / "desktop_notes" / "__init__.py").read_text(
        encoding="utf-8"
    )
    module = ast.parse(source)
    for statement in module.body:
        if not isinstance(statement, ast.Assign):
            continue
        if not any(
            isinstance(target, ast.Name) and target.id == "__version__"
            for target in statement.targets
        ):
            continue
        if isinstance(statement.value, ast.Constant) and isinstance(
            statement.value.value, str
        ):
            return statement.value.value
    raise ValueError("backend/desktop_notes/__init__.py does not define __version__")


def main() -> None:
    versions = {
        "backend/desktop_notes/__init__.py": read_python_version(),
        "pyproject.toml": tomllib.loads(
            (PROJECT_ROOT / "pyproject.toml").read_text(encoding="utf-8")
        )["project"]["version"],
        "package.json": json.loads(
            (PROJECT_ROOT / "package.json").read_text(encoding="utf-8")
        )["version"],
    }
    if len(set(versions.values())) != 1:
        details = ", ".join(f"{path}={version}" for path, version in versions.items())
        raise SystemExit(f"Version declarations do not match: {details}")

    print(f"Version declarations match: {next(iter(versions.values()))}")


if __name__ == "__main__":
    main()
