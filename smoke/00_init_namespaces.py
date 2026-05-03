import json
from pathlib import Path

names = [
    "atoms.code",
    "atoms.audit",
    "atoms.plan",
    "atoms.memory",
    "atoms.audio.raw",
    "atoms.audio.text",
    "atoms.image.raw",
    "atoms.image.text",
    "atoms.crossmodal",
]
base = Path.home() / ".openclaw" / "thalamus" / "state" / "vectors"
missing = [name for name in names if not (base / f"{name}.json").exists()]
assert not missing, f"missing namespace files: {missing}"
print(json.dumps({"test": "00_init_namespaces", "ok": True, "count": len(names)}))

