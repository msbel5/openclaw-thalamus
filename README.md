# openclaw-thalamus

Thalamus is a cognitive hub for OpenClaw agents. It provides packet-based handoff, vector memory search, source-attributed multimodal ingest, routing telemetry, and a local encoder daemon. It is designed for Alcyone on Raspberry Pi 5, but most Node.js APIs run anywhere with optional Python/Hailo features disabled.

## Features

- Packet handoff: `{packet_id, resolver_key}` remains backward compatible.
- Inline vector handoff and tensor bundles for low-token agent delegation.
- Vector store namespaces for code, audit, plan, memory, audio, image, and crossmodal recall.
- Encoder daemon over UNIX socket with distiluse legacy and Qwen3 GGUF support.
- Dashboard and MCP tools for health, context, route, search, ingest, resolve, and telemetry.
- Alcyone Protocol internal symbolic compression for agent-to-agent contexts.

## Install

```bash
npm install -g openclaw-thalamus
openclaw-thalamus health
```

For the full Pi deployment, run from the repo with the Hailo apps Python venv:

```bash
export THALAMUS_HOME=${THALAMUS_HOME:-$HOME/.openclaw/thalamus}
export THALAMUS_ENCODER_SOCKET=$THALAMUS_HOME/ipc.sock
node src/cli.js health
```

Optional Python dependencies live in `daemon/requirements.txt`. Hailo HEF encoders require the Hailo runtime and model files; if unavailable, Thalamus reports degraded encoder status instead of pretending success.

## Configuration

- `THALAMUS_HOME`: state root, default `~/.openclaw/thalamus` on Alcyone.
- `THALAMUS_ENCODER_SOCKET`: encoder daemon UNIX socket.
- `THALAMUS_TEXT_ENCODER`: set `distiluse` to force legacy 512d text; default uses Qwen3 when daemon supports it.
- `THALAMUS_API_KEY`: dashboard Bearer/HMAC key.
- `THALAMUS_CONCEPT_CODES`: enable experimental concept-code path only after codebook gates pass.

## Commands

```bash
openclaw-thalamus health
openclaw-thalamus route "plan a small safe code change"
openclaw-thalamus resolve --packet pkt_... --key sha256:...
openclaw-thalamus search "prior audit pattern" --namespace atoms.audit
openclaw-thalamus heartbeat-canary
```

## Production notes

Thalamus does not feed raw vectors directly into commercial LLM hidden states. It uses vectors for retrieval, routing, compression, and packet handoff, then supplies minimal text evidence to token-based models. Concept codes are experimental and must remain behind `THALAMUS_CONCEPT_CODES=1` unless reconstruction/recall gates pass.
