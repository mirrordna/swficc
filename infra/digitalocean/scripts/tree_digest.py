#!/usr/bin/env python3
"""Compute a deterministic digest for a release source tree."""

from __future__ import annotations

import hashlib
import json
import os
import stat
import sys
from pathlib import Path


def digest_tree(root: Path) -> dict[str, object]:
    if not root.is_dir() or root.is_symlink():
        raise ValueError(f"tree root must be a real directory: {root}")

    digest = hashlib.sha256()
    entries = 0
    files = 0
    symlinks = 0

    for path in sorted(root.rglob("*"), key=lambda item: item.relative_to(root).as_posix()):
        relative = path.relative_to(root).as_posix()
        metadata = path.lstat()
        mode = stat.S_IMODE(metadata.st_mode)

        if path.is_symlink():
            kind = "symlink"
            payload = os.readlink(path).encode()
            symlinks += 1
        elif path.is_file():
            kind = "file"
            payload = hashlib.sha256(path.read_bytes()).hexdigest().encode()
            files += 1
        elif path.is_dir():
            kind = "directory"
            payload = b""
        else:
            raise ValueError(f"unsupported tree entry: {path}")

        digest.update(kind.encode())
        digest.update(b"\0")
        digest.update(relative.encode())
        digest.update(b"\0")
        digest.update(f"{mode:o}".encode())
        digest.update(b"\0")
        digest.update(payload)
        digest.update(b"\0")
        entries += 1

    return {
        "schema_version": "swfipn.tree_digest.v1",
        "root": str(root.resolve()),
        "sha256": digest.hexdigest(),
        "entries": entries,
        "files": files,
        "symlinks": symlinks,
    }


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {Path(sys.argv[0]).name} TREE", file=sys.stderr)
        return 2

    try:
        result = digest_tree(Path(sys.argv[1]))
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1

    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
