#!/usr/bin/env python3
import json
import subprocess

out = subprocess.check_output(
    [
        "node",
        "src/cli.js",
        "route",
        "Builder should create a tiny hello-world OpenClaw plugin and Inspector should approve it",
        "--namespace",
        "atoms.code",
        "--no-cache",
    ],
    text=True,
)
data = json.loads(out)
print(
    json.dumps(
        {
            "ok": data["ok"],
            "packet_id": data["packet_id"],
            "resolver_key_prefix": data["resolver_key"][:16],
            "confidence": data["confidence"],
            "target": data["route"]["target"],
            "aot_required": data["route"]["aot_required"],
        }
    )
)
