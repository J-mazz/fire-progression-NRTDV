"""Publish-safe filesystem helpers for the pipeline tools.

The repository's publishing rule is that a reader must never observe a partial
update: immutable assets are written to a staging location first and swapped
into place last, and the config that references them is replaced by rename.
These helpers are the single implementation of that rule.
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path


def write_text_atomic(path: Path, text: str) -> None:
    """Replace ``path`` with ``text`` via a same-directory temp file + rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.next")
    with temporary.open("w", encoding="utf-8") as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)


def write_bytes_atomic(path: Path, payload: bytes) -> None:
    """Binary counterpart of :func:`write_text_atomic`."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.next")
    with temporary.open("wb") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)


def write_json_atomic(path: Path, payload, *, indent: int | None = 2, compact: bool = False) -> None:
    """Serialize ``payload`` and replace ``path`` atomically."""
    if compact:
        text = json.dumps(payload, separators=(",", ":")) + "\n"
    else:
        text = json.dumps(payload, indent=indent) + "\n"
    write_text_atomic(path, text)


def staging_dir(destination: Path) -> Path:
    """Fresh ``<destination>.next`` staging directory alongside ``destination``."""
    staging = destination.with_name(f"{destination.name}.next")
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    return staging


def publish_directory(staging: Path, destination: Path) -> None:
    """Swap ``staging`` into ``destination``, restoring the previous tree on failure."""
    backup = destination.with_name(f"{destination.name}.previous")
    shutil.rmtree(backup, ignore_errors=True)
    if destination.exists():
        destination.rename(backup)
    try:
        staging.rename(destination)
    except Exception:
        if backup.exists() and not destination.exists():
            backup.rename(destination)
        raise
    shutil.rmtree(backup, ignore_errors=True)
