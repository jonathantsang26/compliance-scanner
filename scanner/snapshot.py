"""Read and write raw snapshots.

Layout, one folder per pull:
    data/raw/<city>/<stamp>/rows.json      every row we kept, as the API sent it
    data/raw/<city>/<stamp>/manifest.json  when, how many rows, sha256, ...
    data/raw/<city>/LATEST                 the stamp of the newest good pull
Later steps only ever read the folder named in LATEST, so a half-finished pull
can never leak into the site.
"""

import hashlib
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

from .config import RAW


def city_dir(city: str) -> Path:
    return RAW / city


def latest_dir(city: str) -> Path | None:
    pointer = city_dir(city) / "LATEST"
    if not pointer.exists():
        return None
    folder = city_dir(city) / pointer.read_text().strip()
    return folder if (folder / "manifest.json").exists() and (folder / "rows.json").exists() else None


def load_manifest(city: str) -> dict | None:
    folder = latest_dir(city)
    return json.loads((folder / "manifest.json").read_text()) if folder else None


def snapshot_ok(city: str) -> bool:
    """True when the newest snapshot's rows.json is present and matches its sha256."""
    folder = latest_dir(city)
    if folder is None:
        return False
    manifest = json.loads((folder / "manifest.json").read_text())
    return hashlib.sha256((folder / "rows.json").read_bytes()).hexdigest() == manifest.get("sha256")


def load_latest(city: str) -> tuple[list[dict], dict]:
    folder = latest_dir(city)
    if folder is None:
        raise SystemExit(f"No {city} snapshot yet. Run: python -m scanner.pull")
    rows_bytes = (folder / "rows.json").read_bytes()
    manifest = json.loads((folder / "manifest.json").read_text())
    if hashlib.sha256(rows_bytes).hexdigest() != manifest["sha256"]:
        raise SystemExit(f"{folder}/rows.json does not match its manifest sha256")
    return json.loads(rows_bytes), manifest


def write_snapshot(city: str, rows: list[dict], manifest: dict) -> Path:
    """Write rows + manifest to a temp folder, then rename it into place."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    final = city_dir(city) / stamp
    n = 1
    while final.exists():  # two pulls within one second
        n += 1
        final = city_dir(city) / f"{stamp}-{n}"
    stamp = final.name
    tmp = city_dir(city) / f".{stamp}.tmp"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    rows_bytes = json.dumps(rows, separators=(",", ":"), sort_keys=True).encode()
    (tmp / "rows.json").write_bytes(rows_bytes)
    manifest = {**manifest, "stamp": stamp, "sha256": hashlib.sha256(rows_bytes).hexdigest()}
    (tmp / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    os.replace(tmp, final)
    pointer_tmp = city_dir(city) / ".LATEST.tmp"
    pointer_tmp.write_text(stamp + "\n")
    os.replace(pointer_tmp, city_dir(city) / "LATEST")
    return final


def prune(city: str, keep: int = 3) -> list[Path]:
    """Delete all but the newest `keep` snapshots (never the one LATEST names)."""
    current = latest_dir(city)
    folders = sorted(p for p in city_dir(city).iterdir() if p.is_dir() and not p.name.startswith("."))
    removed = []
    for folder in folders[:-keep] if keep else folders:
        if folder != current:
            shutil.rmtree(folder)
            removed.append(folder)
    return removed


def mark_checked(city: str, checked_at: str) -> dict:
    """Record that a run confirmed the newest snapshot is still current.

    Only manifest.json changes; rows.json and its sha256 stay as they were.
    """
    folder = latest_dir(city)
    manifest = json.loads((folder / "manifest.json").read_text())
    manifest["checked_at"] = checked_at
    tmp = folder / ".manifest.json.tmp"
    tmp.write_text(json.dumps(manifest, indent=2) + "\n")
    os.replace(tmp, folder / "manifest.json")
    return manifest
