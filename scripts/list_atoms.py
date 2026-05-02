#!/usr/bin/env python3
import argparse
import json
import os
import sys

HOME = os.path.expanduser("~")
LANCEDB_PATH = os.path.join(HOME, ".openclaw", "lancedb")
TABLE_NAME = "atoms"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--stats", action="store_true")
    args = parser.parse_args()

    try:
        import lancedb
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"lancedb import failed: {exc}"}))
        return 0

    if not os.path.exists(LANCEDB_PATH):
        print(json.dumps({"ok": True, "db_exists": False, "table_exists": False, "count": 0, "atoms": []}))
        return 0

    db = lancedb.connect(LANCEDB_PATH)
    tables = db.table_names()
    if TABLE_NAME not in tables:
        print(json.dumps({"ok": True, "db_exists": True, "table_exists": False, "count": 0, "atoms": []}))
        return 0

    table = db.open_table(TABLE_NAME)
    count = table.count_rows()
    if args.stats:
        print(json.dumps({
            "ok": True,
            "db_exists": True,
            "table_exists": True,
            "count": count,
            "tables": tables,
            "schema": str(table.schema)
        }))
        return 0

    rows = table.to_arrow().to_pylist()[: args.limit]
    atoms = []
    for row in rows:
        atoms.append({
            "atom_id": row.get("atom_id"),
            "task_summary": row.get("task_summary"),
            "agent_chain": row.get("agent_chain"),
            "approved": row.get("approved"),
            "premium_reqs_used": row.get("premium_reqs_used"),
            "tags": row.get("tags"),
            "lessons": row.get("lessons"),
            "git_commit_sha": row.get("git_commit_sha")
        })

    print(json.dumps({
        "ok": True,
        "db_exists": True,
        "table_exists": True,
        "count": count,
        "atoms": atoms
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
