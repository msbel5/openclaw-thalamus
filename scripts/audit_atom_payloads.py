#!/usr/bin/env python3
"""PRD-A audit: find atoms with stale raw_payload_path, mark them.

For each atom row with raw_payload_path:
  - if file exists: leave alone
  - if file missing: set metadata.payload_orphaned=True so future migration skips it.
    The atom's vector + text remain valid; only re-embedding from raw is lost.

Atomic per-file write. Idempotent.
"""
from __future__ import annotations
import argparse, json, os, sys, time
from pathlib import Path

VECTOR_DIR = Path("/home/msbel/.openclaw/thalamus/state/vectors")


def audit(dry_run: bool = False) -> dict:
    summary = {"checked": 0, "orphaned_marked": 0, "already_marked": 0, "valid": 0, "files": []}
    for fpath in sorted(VECTOR_DIR.glob("atoms.*.json")):
        ns = fpath.stem
        with fpath.open() as f:
            rows = json.load(f)
        changed = False
        local = {"file": fpath.name, "checked": 0, "orphaned_marked": 0, "already_marked": 0, "valid": 0}
        for r in rows:
            p = r.get("raw_payload_path")
            if not p:
                continue
            local["checked"] += 1
            md = r.setdefault("metadata", {})
            if md.get("payload_orphaned") is True:
                local["already_marked"] += 1
                continue
            if not os.path.exists(p):
                md["payload_orphaned"] = True
                md["payload_orphaned_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
                md["payload_orphan_path"] = p
                local["orphaned_marked"] += 1
                changed = True
            else:
                local["valid"] += 1
        if changed and not dry_run:
            tmp = fpath.with_suffix(".json.new")
            with tmp.open("w") as f:
                json.dump(rows, f, indent=2)
                f.flush(); os.fsync(f.fileno())
            os.replace(str(tmp), str(fpath))
        summary["checked"] += local["checked"]
        summary["orphaned_marked"] += local["orphaned_marked"]
        summary["already_marked"] += local["already_marked"]
        summary["valid"] += local["valid"]
        summary["files"].append(local)
    return summary


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    summary = audit(dry_run=args.dry_run)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
