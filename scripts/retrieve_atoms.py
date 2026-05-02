#!/usr/bin/env python3
import argparse
import json
import math
import os
import re
import sys

HOME = os.path.expanduser("~")
LANCEDB_PATH = os.path.join(HOME, ".openclaw", "lancedb")
TABLE_NAME = "atoms"
EMBED_MODEL = "text-embedding-3-small"


def load_env():
    if os.environ.get("OPENAI_API_KEY"):
        return
    env_path = os.path.join(HOME, ".openclaw", ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf8") as fh:
            for line in fh:
                line = line.strip()
                if line.startswith("OPENAI_API_KEY="):
                    os.environ["OPENAI_API_KEY"] = line.split("=", 1)[1].strip().strip('"').strip("'")
                    return
    cfg_path = os.path.join(HOME, ".openclaw", "openclaw.json")
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, "r", encoding="utf8") as fh:
                cfg = json.load(fh)
            api_key = cfg.get("agents", {}).get("defaults", {}).get("memorySearch", {}).get("remote", {}).get("apiKey")
            if api_key:
                os.environ["OPENAI_API_KEY"] = api_key
        except Exception:
            pass


def words(text):
    return set(re.findall(r"[a-zA-Z0-9_]{3,}", (text or "").lower()))


def lexical_score(query, row):
    q = words(query)
    hay = words(" ".join(str(row.get(k, "")) for k in ("task_summary", "tags", "lessons", "agent_chain")))
    if not q or not hay:
        return 0.0
    overlap = len(q & hay)
    return min(0.39, overlap / max(1, math.sqrt(len(q) * len(hay))))


def row_atom(row, score, source):
    return {
        "atom_id": row.get("atom_id"),
        "source": source,
        "similarity": round(float(score), 4),
        "task_summary": row.get("task_summary"),
        "agent_chain": row.get("agent_chain"),
        "approved": bool(row.get("approved")),
        "premium_reqs_used": int(row.get("premium_reqs_used") or 0),
        "tags": row.get("tags") or "",
        "lessons": row.get("lessons") or "",
        "git_commit_sha": row.get("git_commit_sha") or ""
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("query")
    parser.add_argument("--top", type=int, default=5)
    parser.add_argument("--sim-floor", type=float, default=0.3)
    parser.add_argument("--allow-unapproved", action="store_true")
    parser.add_argument("--no-remote", action="store_true")
    args = parser.parse_args()

    try:
        import lancedb
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"lancedb import failed: {exc}", "atoms": []}))
        return 0

    if not os.path.exists(LANCEDB_PATH):
        print(json.dumps({"ok": True, "mode": "empty", "count": 0, "atoms": []}))
        return 0

    db = lancedb.connect(LANCEDB_PATH)
    if TABLE_NAME not in db.table_names():
        print(json.dumps({"ok": True, "mode": "missing_table", "count": 0, "atoms": []}))
        return 0

    table = db.open_table(TABLE_NAME)
    count = table.count_rows()
    if count == 0:
        print(json.dumps({"ok": True, "mode": "empty_table", "count": 0, "atoms": []}))
        return 0

    errors = []
    remote_allowed = not args.no_remote and os.environ.get("THALAMUS_NO_REMOTE") != "1"
    if remote_allowed:
        load_env()
    if remote_allowed and os.environ.get("OPENAI_API_KEY"):
        try:
            import openai
            client = openai.OpenAI()
            resp = client.embeddings.create(input=args.query[:8000], model=EMBED_MODEL)
            qvec = resp.data[0].embedding
            results = table.search(qvec).metric("cosine").limit(args.top * 2).to_list()
            atoms = []
            for row in results:
                if not args.allow_unapproved and not row.get("approved", False):
                    continue
                sim = max(0.0, 1.0 - float(row.get("_distance", 1.0)))
                if sim >= args.sim_floor:
                    atoms.append(row_atom(row, sim, "lancedb-vector"))
                if len(atoms) >= args.top:
                    break
            print(json.dumps({
                "ok": True,
                "mode": "vector",
                "count": count,
                "query": args.query,
                "atoms": atoms,
                "errors": errors
            }, ensure_ascii=False))
            return 0
        except Exception as exc:
            errors.append(f"vector retrieval failed: {exc}")

    rows = table.to_arrow().to_pylist()
    scored = []
    for row in rows:
        if not args.allow_unapproved and not row.get("approved", False):
            continue
        score = lexical_score(args.query, row)
        if score > 0:
            scored.append((score, row))
    scored.sort(key=lambda item: item[0], reverse=True)
    atoms = [row_atom(row, score, "lexical-fallback") for score, row in scored[: args.top]]
    print(json.dumps({
        "ok": True,
        "mode": "lexical",
        "count": count,
        "query": args.query,
        "atoms": atoms,
        "errors": errors
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
