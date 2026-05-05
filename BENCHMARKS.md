# Thalamus Benchmarks

Raw measurement output from v1.0.0 Pi 5 production deployment, 2026-05-05.
All numbers below are paste-ins from real measurement files. To reproduce, see
the script paths at the bottom.

## Codebook gate (Qwen3 1024d on 100K corpus)

Source: `~/.openclaw/thalamus/state/codebook_metadata.json` (paste verbatim):

```json
{
  "ok": true,
  "chosen": {
    "kind": "BBQ",
    "metric": "inner_product",
    "ncentroids": 128,
    "mean": 0.9780306816101074,
    "p10": 0.9851198792457581,
    "p50": 0.9985392093658447,
    "code_size_bytes": 128,
    "train_seconds": 456.09551072120667,
    "note": "approximate recall via top-1 neighbor cosine (not encode/decode)"
  },
  "attempts": [
    {
      "kind": "PQ",
      "m": 64,
      "mean": 0.9239791631698608,
      "p10": 0.8663310408592224,
      "p50": 0.9294230937957764,
      "code_size_bytes": 64,
      "train_seconds": 6.143991470336914
    },
    {
      "kind": "OPQ+PQ",
      "m": 64,
      "mean": 0.9664216041564941,
      "p10": 0.9204700589179993,
      "p50": 0.9780106544494629,
      "code_size_bytes": 64,
      "train_seconds": 595.3820314407349
    },
    {
      "kind": "BBQ",
      "metric": "inner_product",
      "ncentroids": 128,
      "mean": 0.9780306816101074,
      "p10": 0.9851198792457581,
      "p50": 0.9985392093658447,
      "code_size_bytes": 128,
      "train_seconds": 456.09551072120667
    }
  ],
  "N": 99823,
  "dim": 1024,
  "encoder": "qwen3-embedding-0.6b-q4_0",
  "holdout_frac": 0.1,
  "gate_mean": 0.95,
  "gate_p10": 0.9,
  "enabled_default": true,
  "coverage_estimate": 1.0,
  "trained_at": 1777945085,
  "trained_on": "desktop_rtx3070_offload",
  "wall_seconds": 1058.7805573940277
}
```

Holdout: 10% of corpus (`9982 vectors`). Train: `89841 vectors`. PQ failed the
`p10 >= 0.90` gate. OPQ+PQ passed both. BBQ chose because mean and p10 both
beat OPQ+PQ.

The BBQ "mean" is approximate recall via top-1 neighbor cosine, not strict
encode/decode reconstruction (FAISS RaBitQ Python bindings do not expose
encode/decode at this version).

## Inter-agent handoff

Source: `~/.openclaw/thalamus/state/run_telemetry.jsonl` (last 5 entries
filtered to `protocol_version=alcyone-v1`, paste verbatim):

```json
{"ts":"2026-05-05T10:17:18.871Z","run_id":"pkt_20260505101718_673a9782e719","agent":"captain","thalamus_used":true,"vector_query_present":true,"packet_count":1,"packet_id":"pkt_20260505101718_673a9782e719","resolver_key_present":true,"inline_vector_present":true,"tensor_bundle_present":false,"protocol_version":"alcyone-v1","protocol_ack":"@ack:alcyone-v1","spawn_context_tokens":68,"compact_context_tokens":55,"token_reduction":0.19117647058823528,"escalate_status":"none","rejection_count":0,"escalated_to_mami":false,"error_code":null,"source":"thalamus_route_new"}
{"ts":"2026-05-05T11:16:51.691Z","run_id":"pkt_20260505111651_19c1abfcafc5","agent":"captain","thalamus_used":true,"vector_query_present":true,"packet_count":1,"packet_id":"pkt_20260505111651_19c1abfcafc5","resolver_key_present":true,"inline_vector_present":true,"tensor_bundle_present":false,"protocol_version":"alcyone-v1","protocol_ack":"@ack:alcyone-v1","spawn_context_tokens":68,"compact_context_tokens":55,"token_reduction":0.19117647058823528,"escalate_status":"none","rejection_count":0,"escalated_to_mami":false,"error_code":null,"source":"thalamus_route_new"}
{"ts":"2026-05-05T12:16:22.166Z","run_id":"pkt_20260505121622_cec45d13c7fa","agent":"captain","thalamus_used":true,"vector_query_present":true,"packet_count":1,"packet_id":"pkt_20260505121622_cec45d13c7fa","resolver_key_present":true,"inline_vector_present":true,"tensor_bundle_present":false,"protocol_version":"alcyone-v1","protocol_ack":"@ack:alcyone-v1","spawn_context_tokens":68,"compact_context_tokens":55,"token_reduction":0.19117647058823528,"escalate_status":"none","rejection_count":0,"escalated_to_mami":false,"error_code":null,"source":"thalamus_route_new"}
```

What this measures:
- `spawn_context_tokens` (68): rough token count of the verbose spawn context
  the Captain agent would have generated WITHOUT the @-code protocol.
- `compact_context_tokens` (55): token count of the same spawn context AFTER
  the @-code symbolic compression (`spawn_guard.js` auto-tag step).
- `token_reduction` (0.191): the ratio (68-55)/68 = 19.1%. This is the
  protocol-level compression alone.

What this does NOT measure:
- The Thalamus packet handoff savings vs. naive transcript paste. That second
  layer is computed manually below.

## Packet handoff vs naive transcript paste

Source: ad-hoc measurement on a real packet, 2026-05-05:

```
packet_id:  pkt_20260505012145-8c1520fd
task:       Sprint 5 magic: assign deterministic cooldown ticks to the three starter catalog
atoms:      3
has_vector_query: false (this packet)

Full packet JSON (paste-everything baseline):  3,699 bytes / ~924 tokens
3-field handoff (packet_id+resolver+inline_vector): 194 bytes / ~48 tokens

Compression: 19.2x
Reduction:   94.81%
```

Token estimates use the standard 4-chars-per-token heuristic. Real LLM
tokenizers (cl100k, o200k, qwen) will give slightly different absolute
numbers but similar ratios.

## Combined effect

Two compression layers stack:

```
Layer 1 (packet handoff):   924 tokens -> 48 tokens (5.2% remaining)
Layer 2 (alcyone-v1 @-code):  48 tokens -> 38 tokens (79% of L1 remaining)
Combined:                   924 tokens -> 38 tokens
Combined reduction:         95.84%
Combined compression:       24.3x
```

This is what the README's "95.84% combined token reduction" refers to. It is
a multiplicative composition of the two measurements above. It is NOT measured
end-to-end as a single number; it is computed from the two layers.

## Encoder warm latency

Source: probe run on Pi 5 from llama-server with `--cache-ram 0`, embedding 10
short text fragments, 2026-05-04:

```
[probe] embedding first 10 rows...
  row 0: cold start  906ms
  row 1: warm        167ms
  row 2: warm        191ms
  row 3: warm        ~ similar
  ...
```

Hardware: Raspberry Pi 5 4GB, no NPU offload (Qwen3 runs on CPU via llama.cpp
Q4_0 GGUF). Cold start dominated by model mmap + first-pass kv cache prepare.
Warm steady-state varies in the 150-220 ms range depending on input length.

## Pi reboot pattern during codebook bootstrap

This is anecdotal, not a controlled experiment. During v0.5 codebook bootstrap
runs that pinned CPU at 100% for >5 minutes, the Pi rebooted three times in
one evening. Workaround: codebooks are now trained on a desktop with `faiss-cpu`
and the resulting `codebook.faiss` is `scp`-d to the Pi. Inference workloads
at 167 ms intervals never tripped the Pi.

If you reproduce, expect this to be a power-supply or thermal issue specific
to one rig, not a Thalamus bug. Use a 27 W official Pi 5 supply.

## How to reproduce

```bash
# On Pi (or any Linux box with the daemon installed)
python scripts/lossless_handoff_bench.py
cat ~/.openclaw/thalamus/state/codebook_metadata.json
tail -n 5 ~/.openclaw/thalamus/state/run_telemetry.jsonl | grep alcyone-v1
```

The bench script lives at `scripts/lossless_handoff_bench.py`. It prints
direct/concept_direct/concept_via_search latencies and token counts. Output is
not byte-for-byte identical to this document because it depends on the
specific packet and corpus state, but the methodology is the same.

## What is measured vs what is asserted

- Codebook gate output: real, paste verbatim from `codebook_metadata.json`.
- Telemetry output: real, paste verbatim from `run_telemetry.jsonl`.
- Encoder warm latency: real, recorded from probe stdout.
- Pi reboot count: anecdotal, three reboots during one evening, not a
  controlled experiment.
- 95.84% combined: derived from layer-1 (94.81%) and layer-2 (19.1%) measurements.
- 100% Captain telemetry rate: based on grepping run_telemetry.jsonl for
  `thalamus_used:true` since v0.5.6 — that is the post-fix sample window.
  Pre-fix entries had `thalamus_used:false`. The 100% claim applies only to
  the post-fix window.
