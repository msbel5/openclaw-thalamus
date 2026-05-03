#!/usr/bin/env python3
"""PRD-D backfill: infer pre_migration_model from migrated_via for atoms with None.

Migration v0.2.3 wrote metadata.pre_migration_model = None due to a bug
(read row['metadata']['model'] which never existed; should have been row['model']).

This script fills in the historical fake-encoder names based on namespace,
since all v0.2 fake encoders had deterministic names per namespace:
  atoms.memory|code|audit|plan|audio.text|image.text -> "minilm-l6-compatible-hash"
  atoms.crossmodal text-side                         -> "clip-text-compatible-hash"
  atoms.crossmodal image-side                        -> "clip-shared-compatible"
  atoms.audio.raw                                    -> "hailo-whisper-encoder-compatible"
  atoms.image.raw                                    -> "hailo-clip-image-compatible"
"""
from __future__ import annotations
import json, os
from pathlib import Path

VECTOR_DIR = Path("/home/msbel/.openclaw/thalamus/state/vectors")

NS_LEGACY_FAKE = {
    "atoms.memory":     "minilm-l6-compatible-hash",
    "atoms.code":       "minilm-l6-compatible-hash",
    "atoms.audit":      "minilm-l6-compatible-hash",
    "atoms.plan":       "minilm-l6-compatible-hash",
    "atoms.audio.text": "whisper-transcript-minilm-compatible",
    "atoms.image.text": "vlm-ocr-minilm-compatible",
    "atoms.audio.raw":  "hailo-whisper-encoder-compatible",
    "atoms.image.raw":  "hailo-clip-image-compatible",
}

def main():
    fixed = 0
    for fpath in sorted(VECTOR_DIR.glob("atoms.*.json")):
        ns = fpath.stem
        with fpath.open() as f:
            rows = json.load(f)
        changed = False
        for r in rows:
            md = r.get("metadata") or {}
            if md.get("migrated_via") and md.get("pre_migration_model") is None:
                if ns == "atoms.crossmodal":
                    side = r.get("side") or "text"
                    if side == "image":
                        legacy = "clip-shared-compatible"
                    else:
                        legacy = "clip-text-compatible-hash"
                else:
                    legacy = NS_LEGACY_FAKE.get(ns)
                if legacy:
                    md["pre_migration_model"] = legacy
                    r["metadata"] = md
                    fixed += 1
                    changed = True
        if changed:
            tmp = fpath.with_suffix(".json.new")
            with tmp.open("w") as f:
                json.dump(rows, f, indent=2)
                f.flush(); os.fsync(f.fileno())
            os.replace(str(tmp), str(fpath))
            print(f"WROTE {fpath.name} (fixed in-file)")
    print(f"Total backfilled: {fixed}")

if __name__ == "__main__":
    main()
