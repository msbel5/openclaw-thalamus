# openclaw-thalamus v0.1

Thalamus v0.1 is a conservative router and observability layer for Alcyone.
It does not claim to replace frontier coding models. It gives OpenClaw agents a
small proof-backed context packet built from local state, SGA atom memory, and
Hailo health.

## What ships in v0.1

- `thalamus_health`: Hailo, OpenClaw, disk, services, and atom memory status.
- `thalamus_context`: task -> small context packet with atom IDs and proof.
- `thalamus_benchmark`: Hailo benchmark and context-packet measurements.
- Local dashboard on `127.0.0.1:18888`.
- MCP server for OpenClaw or any MCP-aware client.

## Non-goals

- No GPT-5.5 replacement claim.
- No OpenClaw crew/auth/heartbeat rewrites.
- No cron or dream loop activation until benchmark evidence exists.
- No Hailo GenAI apt install until package conflicts are verified by dry-run.

## Local commands

```bash
node src/cli.js health
node src/cli.js context "Build Sprint 5 magic system"
node src/cli.js benchmark --run-hailo
node src/dashboard.js
node src/server.js
```

## MCP tools

The MCP server exposes:

- `thalamus_health`
- `thalamus_context`
- `thalamus_benchmark`

The tool output is JSON text with no secrets. Packets include `packet_id`,
`summary`, `atoms`, `confidence`, `recommended_next`, `token_estimate`, and
`proof`.

