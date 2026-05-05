# Thalamus

Cognitive routing layer for multi-agent AI systems on edge devices.
Built for Alcyone — a personal AI on Raspberry Pi 5 with optional Hailo-10H NPU.

[![npm version](https://img.shields.io/npm/v/openclaw-thalamus.svg)](https://www.npmjs.com/package/openclaw-thalamus)
[![license MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![release v1.0.0](https://img.shields.io/badge/release-v1.0.0-success)](https://github.com/msbel5/openclaw-thalamus/releases/tag/v1.0.0)

See [BENCHMARKS.md](BENCHMARKS.md) for raw measurement data.

---

## What it does

When 5 agents (Captain, Builder, Inspector, Liaison, Archivist) hand work to each
other, the naive approach is to paste the full transcript on every spawn. This
burns tokens fast.

Thalamus replaces the paste with a 3-field reference:

```
{ packet_id, resolver_key, inline_vector }
```

The receiving agent resolves only the atoms it needs from a local vector store.
Reasoning still runs on tokens. Vectors are used for retrieval, routing, and
pointer-style packet handoff. They are not fed to commercial LLMs as input —
GPT-5, Claude, and Qwen do not read raw vectors.

## Components

- Packet store with TTL and content-hash resolver keys
- Vector store with 9 namespaces: `atoms.code`, `atoms.audit`, `atoms.plan`,
  `atoms.memory`, `atoms.audio.raw`, `atoms.audio.text`, `atoms.image.raw`,
  `atoms.image.text`, `atoms.crossmodal`
- Encoder daemon over UNIX socket: Qwen3-Embedding-0.6B Q4_0 GGUF on CPU,
  optional Hailo HEFs for Whisper (ASR) and CLIP (vision)
- Concept-codes lane using FAISS RaBitQ (BBQ) — disabled by default unless the
  codebook gate passes; see `BENCHMARKS.md` for current gate output
- Dashboard HTTP API on port 18888 with HMAC bearer auth
- MCP server tools for Claude Code, Codex, OpenClaw

## Install

```bash
npm install -g openclaw-thalamus
openclaw-thalamus health
```

For the encoder daemon (recommended for production):

```bash
pip install -r daemon/requirements.txt
python daemon/encoder_server.py &
```

Hailo NPU encoders require Hailo-10H hardware, HailoRT 5.1.1+, and compiled
HEF files. Without Hailo, Thalamus falls back to Qwen3 on CPU.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `THALAMUS_HOME` | `~/.openclaw/thalamus` | State root |
| `THALAMUS_ENCODER_SOCKET` | `$THALAMUS_HOME/ipc.sock` | Encoder daemon socket |
| `THALAMUS_TEXT_ENCODER` | `qwen3` | `qwen3` (1024d) or `distiluse` (legacy 512d) |
| `THALAMUS_API_KEY` | none | Dashboard HMAC bearer key |
| `THALAMUS_CONCEPT_CODES` | `0` | Enable concept-codes lane (only after codebook gate passes) |

## CLI

```
openclaw-thalamus health
openclaw-thalamus route <task>
openclaw-thalamus resolve --packet <id> --key <resolver>
openclaw-thalamus search <query> --namespace atoms.code
openclaw-thalamus benchmark
```

## HTTP API

```
GET  /api/health
GET  /api/resolve?packet_id=...&resolver_key=...
POST /api/search           { vector | text, namespace, k }
POST /api/search/vector    { vector, namespace, k, threshold }
GET  /api/telemetry/last?n=10
GET  /api/tensor-bundle/<id>
```

All routes except `/api/health` require `Authorization: Bearer $THALAMUS_API_KEY`.

## MCP

Add to your Claude Code or OpenClaw config:

```json
{
  "mcpServers": {
    "thalamus": { "command": "openclaw-thalamus-mcp" }
  }
}
```

Tools: `thalamus_route`, `thalamus_resolve`, `thalamus_search`,
`thalamus_search_with_vector`, `thalamus_promote_packet`, `thalamus_telemetry`.

## Architecture

```
  Agents                    Thalamus core                 State
  ------                    -------------                 -----
  Captain     <-- route -->   Encoder daemon  <-- mlock --> Qwen3 model
  Builder     <-- spawn -->   (UNIX socket)   <-- HEF   --> Hailo Whisper/CLIP
  Inspector
  Liaison                     Dashboard       <-- HTTP --> filesystem
  Archivist                   (HMAC bearer)                packets/
                                                           atoms/
                                                           tensor_bundles/
                              MCP server      <-- stdio --> Claude/Codex/OpenClaw
```

Captain calls `thalamus_route(task)`. Daemon embeds the task, stores the
packet, returns `{packet_id, resolver_key, inline_vector}`. Captain spawns
Builder with that 3-field reference. Builder resolves on demand via the MCP
tool, fetching only the atoms it needs.

## Roadmap

### v1.0.0 (shipped 2026-05-05)

- 5-agent crew enforcement via `spawn_guard.js`
- Inspector verdict to GitHub PR comment
- Alcyone Protocol @-code compression in spawn context
- Qwen3-Embedding-0.6B 1024d encoder
- FAISS RaBitQ codebook on 100K corpus (gate output in `BENCHMARKS.md`)
- Tilde-path runtime fix (`docs/OPENCLAW_PATCHES.md`)
- npm publish

### Planned for v1.1

- Multi-platform CI (currently Pi-only verified)
- Voicecall plugin native integration
- GEPA prompt evolution loop (scaffold present, disabled)
- Voyager-style skill mining (scaffold present, disabled)

### Out of scope until commercial LLMs support vector input

- Vector-as-LLM-token input (LCM, JEPA — research only as of 2026)
- Vector-only retrieval-without-LLM fast lane

## Production notes

- Vectors are NOT fed directly to commercial LLMs. They cannot read them in 2026.
- Pi 5 4GB is the verified platform. Sustained 100% CPU codebook training was
  unstable on the test rig and we now train codebooks on a desktop and `scp`
  artifacts back. PSU quality matters.
- Hailo SDK strips embedding ops, so text encoding stays on CPU. NPU is useful
  for Whisper ASR and CLIP vision only.

## Contributing

The codebase is small (~4400 LOC: 3796 in `src/`, 635 in `daemon/`). Pick
something, open an issue or PR. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE).
