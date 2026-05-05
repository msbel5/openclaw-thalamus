# Thalamus

> Cognitive routing layer for multi-agent AI systems on edge devices.
> Originally built for **Alcyone** — a personal AI on Raspberry Pi 5 with Hailo-10H NPU.

[![npm version](https://img.shields.io/npm/v/openclaw-thalamus.svg)](https://www.npmjs.com/package/openclaw-thalamus)
[![npm downloads](https://img.shields.io/npm/dm/openclaw-thalamus.svg)](https://www.npmjs.com/package/openclaw-thalamus)
[![license MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![token reduction](https://img.shields.io/badge/handoff%20token%20reduction-95.84%25-brightgreen)]()
[![codebook gate](https://img.shields.io/badge/BBQ%20codebook-0.978%2F0.985-success)]()
[![pi 5](https://img.shields.io/badge/raspberry%20pi%205-supported-red)]()

---

## What is this?

Thalamus is **a small filing cabinet between your AI agents**.

When 5 agents pass work to each other (Captain → Builder → Inspector → ...), the
naïve approach is to paste the full transcript every spawn. That blows your
token budget in days. Thalamus replaces the paste with a **3-field handoff**:

```text
{ packet_id, resolver_key, inline_vector }    // ~80 tokens
```

The receiving agent can then resolve **only the bits it needs** from the local
vector store. We measured **95.84% combined token reduction** on real production
runs.

It is deliberately small. It does not replace your LLM. It does not pretend to
let GPT-5 or Claude read raw vectors (they cannot, in 2026). What it does:

- **Packet store** — TTL'd context blobs with content-hash resolver keys
- **Vector store** — 9 namespaces (code, audit, plan, memory, audio, image, crossmodal, …)
- **Encoder daemon** — UNIX socket service running Qwen3-Embedding-0.6B (Q4_0 GGUF, 1024d) plus optional Hailo-NPU encoders for Whisper / CLIP
- **Dashboard** — HTTP API with HMAC bearer auth (`/api/resolve`, `/api/search/vector`, `/api/telemetry`)
- **MCP server** — for Claude Code / Codex / OpenClaw orchestrators
- **Concept-codes lane** — optional FAISS RaBitQ (BBQ) compression at 0.978 mean / 0.985 p10

---

## Quickstart

```bash
npm install -g openclaw-thalamus

# Health probe
openclaw-thalamus health

# Route a task — returns {packet_id, resolver_key, inline_vector}
openclaw-thalamus route "plan a small safe code change"

# Receiving agent resolves
openclaw-thalamus resolve --packet pkt_xxx --key sha256:yyy

# Vector search across atoms
openclaw-thalamus search "prior audit pattern" --namespace atoms.audit
```

The Node.js side runs anywhere. The Hailo NPU encoders (Whisper, CLIP) require
a Hailo-10H AI HAT and the Hailo runtime. **Without Hailo, Thalamus falls back
to Qwen3 on CPU automatically and reports `degraded: false` because that is the
new production default.**

---

## Architecture

```
                          ┌────────────────────────────────────┐
  ┌──────────────────┐    │         Thalamus core              │
  │   Captain agent  │◀──▶│                                    │
  │  (gpt-5.5 etc.)  │    │   ┌────────────────────────────┐   │
  └──────────────────┘    │   │   Packet store (TTL 30d)   │   │
                          │   │   atoms.{code,audit,plan,  │   │
  ┌──────────────────┐    │   │   memory,audio.*,image.*}  │   │
  │  Builder agent   │◀──▶│   └────────────────────────────┘   │
  └──────────────────┘    │                                    │
                          │   ┌────────────────────────────┐   │
  ┌──────────────────┐    │   │   Encoder daemon           │   │
  │ Inspector agent  │◀──▶│   │   (UNIX socket, JSON-RPC)  │   │
  │  (claude-opus)   │    │   │                            │   │
  └──────────────────┘    │   │   ┌──────────────────────┐ │   │
                          │   │   │ Qwen3-Embedding-0.6B │ │   │
  ┌──────────────────┐    │   │   │ (Q4_0 GGUF, 1024d)   │ │   │
  │  Liaison agent   │◀──▶│   │   │ → mlock pinned, CPU  │ │   │
  └──────────────────┘    │   │   └──────────────────────┘ │   │
                          │   │   ┌──────────────────────┐ │   │
  ┌──────────────────┐    │   │   │ Hailo HEFs (optional)│ │   │
  │ Archivist agent  │◀──▶│   │   │ Whisper · CLIP-text  │ │   │
  └──────────────────┘    │   │   │ CLIP-image           │ │   │
                          │   │   └──────────────────────┘ │   │
                          │   │   ┌──────────────────────┐ │   │
                          │   │   │ Concept codebook     │ │   │
                          │   │   │ FAISS RaBitQ (BBQ)   │ │   │
                          │   │   │ mean=0.978 p10=0.985 │ │   │
                          │   │   └──────────────────────┘ │   │
                          │   └────────────────────────────┘   │
                          │                                    │
                          │   ┌────────────────────────────┐   │
                          │   │   Dashboard HTTP API       │   │
                          │   │   :18888 · HMAC bearer     │   │
                          │   └────────────────────────────┘   │
                          └────────────────────────────────────┘
```

### Vector handoff sequence

```
Captain                   Thalamus                        Builder
   │                         │                               │
   │  thalamus_route(task)   │                               │
   ├────────────────────────▶│                               │
   │                         │ embed_text → packet store     │
   │                         │ atoms search                  │
   │                         │                               │
   │  {packet_id, resolver,  │                               │
   │   inline_vector}        │                               │
   │◀────────────────────────┤                               │
   │                         │                               │
   │   spawn(builder, ctx)   │                               │
   ├─────────────────────────────────────────────────────────▶
   │                         │                               │
   │                         │  thalamus_resolve(packet_id)  │
   │                         │◀──────────────────────────────┤
   │                         │                               │
   │                         │  { atoms[], summary }         │
   │                         ├──────────────────────────────▶│
   │                         │                               │
```

The compression happens in two layers:

1. **Packet handoff (94.81%)** — replacing transcript paste with 3-field reference
2. **Alcyone Protocol @-codes (19.9%)** — symbolic compression of the spawn context payload itself

Combined: **95.84% token reduction** measured against the original paste-everything baseline.

---

## Real metrics

All numbers below are measured on Pi 5 4GB, Hailo-10H AI HAT, openclaw 2026.5.3-1.

### Encoder

| Metric | Value | Notes |
|---|---|---|
| Qwen3-Embedding-0.6B Q4_0 latency (warm p50) | 167ms | Pi 5 CPU via llama.cpp |
| Daemon RSS at idle (qwen3 + distiluse) | 1.09GB | Both encoders mlock'd |
| Hailo Whisper-encoder latency | varies | NPU INT4 |

### Codebook gate (Qwen3 1024d, 100K corpus)

| Method | Mean cosine | p10 cosine | Code size | Verdict |
|---|---|---|---|---|
| PQ-only m=64 | 0.924 | 0.866 | 64 B | ❌ p10 fails 0.90 gate |
| OPQ + PQ m=64 | 0.966 | 0.920 | 64 B | ✅ pass |
| **FAISS RaBitQ (BBQ)** | **0.978** | **0.985** | **128 B** | ✅ **chosen** |

### Handoff

| Test | Bytes | ~Tokens | vs baseline |
|---|---|---|---|
| Eski yol (full packet paste) | 3,699 | 924 | 1.0× baseline |
| 3-field handoff | 194 | 48 | 19.2× compression |
| 3-field + Alcyone @-codes | ~150 | 38 | 24.3× compression |

**Combined token reduction**: **95.84%**

### 5-agent crew throughput

Real ember-sprint-factory hourly cron, last 50 runs:

- Captain `thalamus_route` invocation rate: **100%** (PRD-K hard-gate enforced)
- Average `vector_query` field populated: **100%**
- `protocol_version=alcyone-v1` in spawn context: **100%**
- Average spawn_context_tokens (post-protocol): **66**
- Inspector verdict → GitHub PR comment: working on every merged PR

---

## Install

```bash
npm install -g openclaw-thalamus
```

Optional: encoder daemon (recommended for production):

```bash
# On Pi or Linux box with Python 3.11+
pip install -r daemon/requirements.txt

# Start the daemon (UNIX socket)
python daemon/encoder_server.py &

# Dashboard service (optional)
node src/dashboard.js
```

Hailo NPU encoders require:

- Hailo-10H AI HAT physical hardware
- HailoRT 5.1.1+
- Compiled HEF files (Whisper / CLIP) — see `docs/HAILO_HEFS.md`

Without Hailo, Thalamus uses the CPU Qwen3 path and reports zero degradation —
that is the new production default after v1.0.

---

## Configuration

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `THALAMUS_HOME` | `~/.openclaw/thalamus` | State root |
| `THALAMUS_ENCODER_SOCKET` | `$THALAMUS_HOME/ipc.sock` | Encoder daemon socket |
| `THALAMUS_TEXT_ENCODER` | `qwen3` | `qwen3` (default) or `distiluse` (legacy 512d) |
| `THALAMUS_API_KEY` | none | Dashboard HMAC bearer key |
| `THALAMUS_CONCEPT_CODES` | `0` | Enable concept-codes lane (only after codebook gate passes) |
| `BOOTSTRAP_TEMP_CEILING` | `78` | Pi thermal throttle ceiling for corpus bootstrap |

---

## API reference

### CLI

```bash
openclaw-thalamus health
openclaw-thalamus route <task>
openclaw-thalamus resolve --packet <id> --key <resolver>
openclaw-thalamus search <query> --namespace atoms.code
openclaw-thalamus benchmark
```

### HTTP (dashboard, port 18888)

```http
GET  /api/health
GET  /api/resolve?packet_id=...&resolver_key=...
POST /api/search           { vector | text, namespace, k }
POST /api/search/vector    { vector, namespace, k, threshold }
GET  /api/telemetry/last?n=10
GET  /api/tensor-bundle/<id>
```

All routes (except `/api/health`) require `Authorization: Bearer $THALAMUS_API_KEY`.

### MCP

Thalamus exposes itself as an MCP server. Add to your Claude Code or OpenClaw config:

```json
{
  "mcpServers": {
    "thalamus": {
      "command": "openclaw-thalamus-mcp",
      "args": []
    }
  }
}
```

Tools: `thalamus_route`, `thalamus_resolve`, `thalamus_search`, `thalamus_search_with_vector`, `thalamus_promote_packet`, `thalamus_telemetry`.

---

## How agents use it

### Captain side

```javascript
const { route } = require("openclaw-thalamus");

const packet = await route({
  task: "Implement spell cooldown logic for Sprint 5",
  category_filter: ["atoms.code", "atoms.plan"],
});
// → { packet_id, resolver_key, inline_vector, vector_query }

await spawnSession("builder", {
  packet_id: packet.packet_id,
  resolver_key: packet.resolver_key,
  inline_vector: packet.inline_vector,
  protocol_version: "alcyone-v1",
});
```

### Builder side (auto via MCP)

The MCP tool `thalamus_resolve` runs automatically; Builder receives only the
distilled atoms relevant to the inline_vector, never a paste of the full
transcript.

### Skill for cross-session handoff

Drop this `~/.claude/skills/alcyone-thalamus/SKILL.md` to let Claude Code
sessions on a different machine fetch packets over SSH — see `examples/skill/`.

---

## Roadmap

### v1.0.0 (shipped 2026-05-05)

- ✅ 5-agent crew enforcement (PRD-K)
- ✅ Inspector → GitHub PR comment + escalate state machine (PRD-L)
- ✅ Alcyone Protocol @-code compression in spawn context
- ✅ Qwen3-Embedding-0.6B 1024d encoder
- ✅ FAISS RaBitQ codebook (BBQ) on 100K corpus
- ✅ Tilde-path runtime fix
- ✅ npm publish

### v1.1 (planned)

- [ ] Voicecall plugin native integration (Telegram voice messages via Piper TTS)
- [ ] Multi-platform tested (macOS, Linux x86_64; Pi 5 ARM is current production)
- [ ] GEPA prompt evolution loop (scaffold ready, disabled)
- [ ] Voyager-style skill mining (scaffold ready, disabled)
- [ ] Self-directed research-to-atoms (scaffold ready, disabled)

### v2.0 (research)

- [ ] LCM/JEPA-native vector input (waiting on commercial LLM support)
- [ ] Cross-vendor vector standardisation
- [ ] Vector-only fast lane (no LLM needed for retrieval-only tasks)

---

## Production notes

- Thalamus does **not** feed raw vectors directly into commercial LLM hidden states. They cannot read them in 2026. We use vectors for retrieval, routing, compression, and pointer-style packet handoff. The LLM still consumes tokens.
- The 95.84% number is the cost of inter-agent **handoff** transport. Reasoning costs are unaffected (LLMs are still token-bound).
- Concept-codes lane only opens when `THALAMUS_CONCEPT_CODES=1` AND `codebook_metadata.json.ok==true`. The default is conservative.
- Pi 5 4GB is the official tested platform. Sustained heavy training was unstable on our test rig (3 reboots during initial codebook bootstrap); we now train codebooks on a desktop and `scp` artifacts back. PSU quality matters.

---

## Contributing

Yes please. This was built by one person on a 4GB Pi over six weeks. There is
plenty of low-hanging fruit:

- **Multi-platform packaging** (macOS, Linux x86_64, Windows WSL2)
- **More encoder backends** (BGE-M3, GTE-multilingual, ONNX runtime)
- **Tensor bundle GC tuning** (current threshold is conservative)
- **MCP tool documentation**
- **Unit tests** for `vector_store.js` and `packet_store.js` (current coverage is thin)
- **Hailo HEF compilation guide** (currently empty)
- **TTS integration** (Piper for Pi 5 CPU, ElevenLabs for cloud)

Pick something, open an issue or PR. CI runs lint + a fast smoke test on every PR.
See [CONTRIBUTING.md](CONTRIBUTING.md) for setup.

The codebase is intentionally small — under 5,000 LOC in `src/` and another
~1,500 in `daemon/`. Read it. It is meant to be understood.

---

## Acknowledgments

- **OpenClaw** team — for building the gateway this rides on
- **Qwen team (Alibaba)** — Qwen3-Embedding-0.6B is excellent
- **llama.cpp** — for making CPU inference of GGUF embedding models actually fast
- **FAISS** — for RaBitQ landing in 1.10
- **Hailo** — for the HAT, even though their SDK strips embedding ops
- **Mami's stubbornness** — for refusing to accept that "just paste the transcript" was good enough

---

## License

MIT — see [LICENSE](LICENSE).

Built on a Raspberry Pi 5 in Diyarbakır.
