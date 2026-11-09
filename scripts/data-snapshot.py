#!/usr/bin/env python3
"""Private, quiesced data snapshots. Stop every app/worker before using this tool."""
from __future__ import annotations

import argparse
from contextlib import closing, contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import stat
import sys

ROOTS = {"builds", "imports", "engineering", "clips"}
DATABASE = "studio.sqlite"
ACTIVE = {"builds": "job", "engineering_jobs": "job", "import_jobs": "job", "clips": "job", "agent_runs": "run"}
REQUIRED_TABLES = {"designs", "operations", "builds", "documents", "ai_usage", "design_admission"}


class SnapshotError(Exception):
    pass


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def package_python_version(value: str) -> bool:
    parts = PurePosixPath(value).parts
    return len(parts) == 4 and parts[0] == "builds" and parts[2:] == ("package", ".python-version")


def validate_package_python_version(path: Path, relative: str) -> None:
    # CAD exports carry this non-secret named-environment selector as source metadata.
    # Never allow arbitrary dotfiles or executable/configuration content through it.
    if package_python_version(relative):
        if path.stat().st_size > 67 or re.fullmatch(rb"\.[A-Za-z0-9][A-Za-z0-9._-]{0,63}\r?\n?", path.read_bytes()) is None:
            raise SnapshotError("Exported Python version must name one private project environment")


def safe_relative(value: str) -> str:
    if not isinstance(value, str) or "\\" in value:
        raise SnapshotError("Invalid manifest path")
    path = PurePosixPath(value)
    if path.is_absolute() or str(path) != value or any(p in {"", ".", ".."} for p in path.parts):
        raise SnapshotError("Invalid manifest path")
    if value != DATABASE and (len(path.parts) < 2 or path.parts[0] not in ROOTS):
        raise SnapshotError("Unexpected data path")
    for index, part in enumerate(path.parts):
        low = part.lower()
        allowed_selector = index == 3 and package_python_version(value)
        if (low.startswith(".") and not allowed_selector) or low.endswith((".pem", ".key", ".p12", ".pfx")) or low in {"credentials", "id_rsa", "id_ed25519"}:
            raise SnapshotError("Private configuration is not a data artifact")
    return value


def regular(path: Path) -> None:
    if not stat.S_ISREG(path.lstat().st_mode):
        raise SnapshotError("Snapshot inputs must be regular files, without symlinks")


def inventory(root: Path) -> list[str]:
    regular(root / DATABASE)
    result = [DATABASE]
    for name in sorted(ROOTS):
        directory = root / name
        if not directory.exists() and not directory.is_symlink():
            continue
        if directory.is_symlink() or not directory.is_dir():
            raise SnapshotError("Artifact roots must be real directories")
        for current, dirs, files in os.walk(directory, followlinks=False):
            for item in dirs:
                if (Path(current) / item).is_symlink():
                    raise SnapshotError("Artifact directory symlinks are not supported")
            for item in files:
                file = Path(current) / item
                regular(file)
                relative = safe_relative(file.relative_to(root).as_posix())
                validate_package_python_version(file, relative)
                result.append(relative)
    return sorted(result)


@contextmanager
def connect(path: Path, write: bool = False):
    regular(path)
    db = sqlite3.connect(path.as_uri() + ("?mode=rw" if write else "?mode=ro"), uri=True, timeout=1)
    try:
        db.execute("PRAGMA trusted_schema=OFF")
        yield db
    finally:
        db.close()


def validate_database(db: sqlite3.Connection) -> None:
    if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
        raise SnapshotError("SQLite integrity check failed")
    if db.execute("PRAGMA foreign_key_check").fetchone():
        raise SnapshotError("SQLite foreign-key check failed")
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not REQUIRED_TABLES <= tables:
        raise SnapshotError("Expected application tables are missing")
    for table, column in ACTIVE.items():
        if table in tables:
            for (value,) in db.execute(f'SELECT "{column}" FROM "{table}"'):
                if json.loads(value).get("status") in {"queued", "running"}:
                    raise SnapshotError("Work is queued or running; stop and drain the application first")


def relative_reference(value: str, source_root: Path) -> str:
    if not isinstance(value, str) or not Path(value).is_absolute():
        raise SnapshotError("Artifact references must be absolute paths")
    try:
        relative = Path(value).resolve().relative_to(source_root.resolve()).as_posix()
    except ValueError as error:
        raise SnapshotError("A referenced artifact is outside the data directory") from error
    return safe_relative(relative)


def references(db: sqlite3.Connection, source_root: Path, runtime_paths: dict) -> list[tuple[str, str | None]]:
    """Runtime file references; historical input JSON and immutable ZIP bytes stay unchanged."""
    result: list[tuple[str, str | None]] = []
    def pointer(value: str) -> str:
        if value not in runtime_paths:
            raise SnapshotError("A runtime artifact pointer is missing from the manifest")
        return safe_relative(runtime_paths[value])
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    for job, archive in db.execute("SELECT job,archive FROM builds"):
        if json.loads(job).get("status") == "ready" and not archive:
            raise SnapshotError("A ready build has no archive")
        if archive:
            result.append((pointer(archive), None))
    if "imported_sources" in tables:
        for (raw,) in db.execute("SELECT record FROM imported_sources"):
            record = json.loads(raw)
            result.append((pointer(record["sourcePath"]), record["sourceHash"]))
    if "clips" in tables:
        for identifier, raw in db.execute("SELECT id,job FROM clips"):
            if json.loads(raw).get("status") == "ready":
                if not isinstance(identifier, str) or not identifier or any(c in identifier for c in "/\\") or identifier in {".", ".."}:
                    raise SnapshotError("Invalid video artifact identifier")
                result.append((safe_relative(f"clips/{identifier}/product.mp4"), None))
    return result


def verify_references(db: sqlite3.Connection, source_root: Path, entries: dict, runtime_paths: dict) -> None:
    for relative, expected in references(db, source_root, runtime_paths):
        if relative not in entries:
            raise SnapshotError("A referenced artifact is missing from the snapshot")
        if expected is not None and entries[relative]["sha256"] != expected:
            raise SnapshotError("An imported original failed its recorded hash")


def destination(path: Path, source: Path) -> Path:
    # Resolve the parent to avoid nested/symlink alias paths, but never follow the destination itself.
    parent = path.parent.resolve(strict=True)
    target = parent / path.name
    if source == target or source in target.parents or target in source.parents:
        raise SnapshotError("Source and destination must be separate directories")
    target.mkdir(mode=0o700)  # Exclusive: an existing directory, even empty, is never overwritten.
    return target


def private_copy(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    regular(source)
    with source.open("rb") as incoming, target.open("xb") as outgoing:
        shutil.copyfileobj(incoming, outgoing)
    target.chmod(0o600)


def backup(source: Path, output: Path) -> dict:
    source = source.resolve(strict=True)
    if not source.is_dir():
        raise SnapshotError("Data directory is missing")
    target = None
    # This blocks new SQLite writes as a secondary guard, not as proof that all filesystem writers stopped.
    with connect(source / DATABASE, write=True) as lock:
        lock.execute("BEGIN IMMEDIATE")
        validate_database(lock)
        files = inventory(source)
        runtime_paths = {}
        for (archive,) in lock.execute("SELECT archive FROM builds WHERE archive IS NOT NULL"):
            runtime_paths[archive] = relative_reference(archive, source)
        tables = {row[0] for row in lock.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "imported_sources" in tables:
            for (raw,) in lock.execute("SELECT record FROM imported_sources"):
                value = json.loads(raw)["sourcePath"]
                runtime_paths[value] = relative_reference(value, source)
        try:
            target = destination(output, source)
            with connect(source / DATABASE) as reader, closing(sqlite3.connect(target / DATABASE)) as snapshot:
                reader.backup(snapshot)
                snapshot.execute("PRAGMA journal_mode=DELETE")
            (target / DATABASE).chmod(0o600)
            entries = {DATABASE: {"sha256": digest(target / DATABASE), "bytes": (target / DATABASE).stat().st_size}}
            for relative in files:
                if relative == DATABASE:
                    continue
                before = (source / relative).stat()
                private_copy(source / relative, target / relative)
                after = (source / relative).stat()
                value = digest(target / relative)
                if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns) or digest(source / relative) != value:
                    raise SnapshotError("Data changed during backup; stop every writer and retry")
                entries[relative] = {"sha256": value, "bytes": after.st_size}
            if inventory(source) != files:
                raise SnapshotError("Artifact inventory changed during backup")
            with connect(target / DATABASE) as snapshot:
                validate_database(snapshot)
                verify_references(snapshot, source, entries, runtime_paths)
            manifest = {"schema": 1, "createdAt": datetime.now(timezone.utc).isoformat(), "sourceDataDir": str(source),
                        "quiescence": "confirmed-stopped", "files": entries, "runtimePaths": runtime_paths}
            (target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
            (target / "manifest.json").chmod(0o600)
            return {"ok": True, "operation": "backup", "files": len(entries), "bytes": sum(e["bytes"] for e in entries.values())}
        except BaseException:
            if target is not None:
                shutil.rmtree(target)
            raise
        finally:
            lock.rollback()


def verify(source: Path) -> dict:
    source = source.resolve(strict=True)
    regular(source / "manifest.json")
    if (source / "manifest.json").stat().st_size > 20_000_000:
        raise SnapshotError("Snapshot manifest is too large")
    manifest = json.loads((source / "manifest.json").read_text())
    if not isinstance(manifest, dict):
        raise SnapshotError("Invalid snapshot manifest")
    if manifest.get("schema") != 1 or manifest.get("quiescence") != "confirmed-stopped" or not isinstance(manifest.get("files"), dict) or not isinstance(manifest.get("runtimePaths"), dict):
        raise SnapshotError("Unsupported snapshot manifest")
    root = Path(manifest["sourceDataDir"])
    if not root.is_absolute():
        raise SnapshotError("Invalid source data directory")
    entries = manifest["files"]
    for relative, expected in entries.items():
        safe_relative(relative)
        if not isinstance(expected, dict) or type(expected.get("bytes")) is not int or expected["bytes"] < 0 or not isinstance(expected.get("sha256"), str) or len(expected["sha256"]) != 64 or any(c not in "0123456789abcdef" for c in expected["sha256"]):
            raise SnapshotError("Invalid snapshot file metadata")
    for original, relative in manifest["runtimePaths"].items():
        if not Path(original).is_absolute():
            raise SnapshotError("Invalid runtime artifact pointer")
        safe_relative(relative)
    if DATABASE not in entries or sorted(entries) != inventory(source):
        raise SnapshotError("Snapshot file inventory is incomplete or unexpected")
    for relative, expected in entries.items():
        safe_relative(relative)
        file = source / relative
        if file.stat().st_size != expected.get("bytes") or digest(file) != expected.get("sha256"):
            raise SnapshotError("Snapshot file hash or size mismatch")
    with connect(source / DATABASE) as db:
        validate_database(db)
        verify_references(db, root, entries, manifest["runtimePaths"])
    return manifest


def restore(source: Path, output: Path) -> dict:
    source = source.resolve(strict=True)
    manifest = verify(source)
    target = None
    try:
        target = destination(output, source)
        for relative, expected in manifest["files"].items():
            private_copy(source / relative, target / relative)
            if digest(target / relative) != expected["sha256"]:
                raise SnapshotError("Snapshot changed during restore")
        with connect(target / DATABASE, write=True) as db:
            # Only runtime storage pointers change. Design/history, notes, counters, AI charges and output bytes do not.
            for identifier, archive in db.execute("SELECT id,archive FROM builds").fetchall():
                if archive:
                    db.execute("UPDATE builds SET archive=? WHERE id=?", (str(target / manifest["runtimePaths"][archive]), identifier))
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if "imported_sources" in tables:
                for identifier, raw in db.execute("SELECT id,record FROM imported_sources").fetchall():
                    record = json.loads(raw)
                    record["sourcePath"] = str(target / manifest["runtimePaths"][record["sourcePath"]])
                    db.execute("UPDATE imported_sources SET record=? WHERE id=?", (json.dumps(record, separators=(",", ":")), identifier))
            db.commit()
            validate_database(db)
            relocated = {str(target / relative): relative for relative in manifest["runtimePaths"].values()}
            verify_references(db, target, manifest["files"], relocated)
        # No snapshot manifest is placed in live data: the restored DB has deliberately relocated pointers.
        return {"ok": True, "operation": "restore", "files": len(manifest["files"]), "relocatedRuntimePaths": True}
    except BaseException:
        if target is not None:
            shutil.rmtree(target)
        raise


def main() -> int:
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["backup", "verify", "restore"])
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--confirm-stopped", action="store_true", help="Attest every app and worker using source/target data is stopped; this tool cannot prove that")
    args = parser.parse_args()
    try:
        if args.operation != "verify" and (not args.confirm_stopped or args.destination is None):
            raise SnapshotError("Backup/restore require --confirm-stopped and a new --destination")
        if args.operation == "backup":
            result = backup(args.source, args.destination)
        elif args.operation == "restore":
            result = restore(args.source, args.destination)
        else:
            result = {"ok": True, "operation": "verify", "files": len(verify(args.source)["files"])}
        print(json.dumps(result))
        return 0
    except (SnapshotError, OSError, sqlite3.Error, ValueError, KeyError, TypeError) as error:
        # Filesystem exception text can include private paths; only deliberate operational messages are printed.
        message = str(error) if isinstance(error, SnapshotError) else type(error).__name__
        print(json.dumps({"ok": False, "error": message}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
