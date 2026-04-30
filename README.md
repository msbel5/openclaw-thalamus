# openclaw-thalamus

## What It Is

`openclaw-thalamus` is a Phase 1, position-paper-grade prototype of a native
vector routing layer for OpenClaw agents. It makes the architecture concrete
with one packet schema, stub modality adapters, a priority router, and tiered
memory, but it is not yet a measured benchmark or a production multimodal
runtime.

## Why

The text bus is lossy when the consumer is another model. A vision encoder can
produce a dense vector with texture, shape, and material cues, only for the
system to collapse it into a caption, re-embed the caption, and hand the weaker
signal to a planner or critic. The thalamus layer keeps vectors on the
inter-module bus and preserves raw embeddings in memory so text is reserved for
the user-facing boundary.

## Architecture

```text
                          user input
                              |
                              v
   +---------------------------------------------------------+
   |             specialist encoders                         |
   |   (vision, audio, text, ...)                            |
   +-----------------------------+---------------------------+
                                 |  raw embeddings
                                 v
   +---------------------------------------------------------+
   |             modality adapters                           |
   |   frozen random projections in Phase 1                  |
   +-----------------------------+---------------------------+
                                 |  shared workspace vectors
                                 v
   +---------------------------------------------------------+
   |             thalamus router                             |
   |   priority buckets, FIFO, hop limits, audit log         |
   +-----+-----------------+-----------------+---------------+
         |                 |                 |
         v                 v                 v
   +-----+----+       +----+-----+      +----+-----+
   | reasoning|       | critic   |      | planner  |
   |   core   |       |   core   |      |   core   |
   +----+-----+       +----+-----+      +----+-----+
        |                  |                  |
        +-------+----------+--------+---------+
                |                   |
                v                   v
   +---------------------------------------------------------+
   |             hippocampal memory                          |
   |   hot LRU        |  vector index  |  episodic SQLite    |
   |   raw embedding cache stays attached to each hit        |
   +---------------------------------------------------------+
```

## Phase 1 Status

This repository now contains the software prototype for the narrow Phase 1
claim: vectors can be encoded by stubs, projected into a shared workspace,
routed by priority, stored with summaries, and retrieved by both text and
vector. There is no measured implementation result yet: no latency baseline,
no fidelity comparison against a text-bus pipeline, and no trained adapter
alignment.

## Phase 2 results

Phase 2 adds a controlled experiment harness. The default reproducible Docker
run uses a Python JSONL encoder process with deterministic CPU fixture
encoders, a deliberately lossy BLIP-style caption fallback, and linear
`.npy` adapters. The caption fallback keeps color but drops shape
(`"a red object on a black background"`), so the baseline measures the loss
introduced by serializing the image vector through intermediate text.

Measured on the controlled 50 image x 5 question workload:

| pipeline | rows | median latency |      p95 |      p99 | avg intermediate tokens | avg fidelity | task success |
| -------- | ---: | -------------: | -------: | -------: | ----------------------: | -----------: | -----------: |
| text-bus |  250 |       2.542 ms | 3.616 ms | 4.512 ms |                    13.8 |        0.591 |        40.0% |
| thalamus |  250 |       2.311 ms | 3.389 ms | 4.417 ms |                     0.0 |        1.000 |       100.0% |

Artifacts are written to `experiments/results-fixture.sqlite`,
`experiments/results-fixture.csv`, and `figures/`. The numbers above are
controlled fixture results, not a claim about SigLIP or BLIP quality on
natural images.

Real HuggingFace encoders are wired behind `THALAMUS_ENCODER_BACKEND=hf`:
SigLIP for vision, MiniLM for text, and Whisper tiny encoder for audio. The
Phase 2.5 local run uses CPU fp32, not INT8 quantization. INT8 quantization is
deferred to Phase 3 if the Pi 5 memory or latency budget requires it.

HF model caches respect existing `HF_HOME`, `HF_HUB_CACHE`,
`TRANSFORMERS_CACHE`, and `SENTENCE_TRANSFORMERS_HOME`. On this Windows
workspace those point at `D:\hf-cache\main`; if `HF_HOME` is unset, local
Windows runs default to `D:\hf-cache\main` when `D:` exists. Project data
caches default to `D:\openclaw-thalamus-cache`.

## Phase 2.5 results

Phase 2.5 was run locally on Windows, CPU only, outside Docker. The encoder
backend was `huggingface-cpu-fp32`: `google/siglip-base-patch16-224` for
vision, `sentence-transformers/all-MiniLM-L6-v2` for text, and a lazy-loaded
`Salesforce/blip-image-captioning-base` captioner for the text-bus baseline.
BLIP-base is roughly 990 MB and adds about 1.5 s of first-request latency on a
typical CPU once cached; on Pi 5 in Phase 3 we should keep it warm for the
session or drop to the deterministic captioner under a stricter memory budget.

The COCO adapter run used 5,000 image-caption pairs cached under
`D:\openclaw-thalamus-cache\data\coco_5k`. The downloader uses a reachable
`datasets` mirror (`jxie/coco_captions`) and normalizes it into one
`image.jpg` plus `caption.txt` per pair. Two linear adapters were trained with
InfoNCE at temperature `0.07`, batch size 64, Adam `1e-3`, and 2 epochs. On a
held-out 500-pair split, the measured retrieval scores were
retrieval@1 = `0.108` and retrieval@5 = `0.474`. Training logs are in
`adapters/training_log.csv`; the summary is in
`adapters/training_metrics.json`.

The real controlled workload uses 50 COCO images copied into
`experiments/inputs/real`, with 3 QA rows per image. Manual ground truth is
recorded in `experiments/inputs/real/labels.csv`; the experiment reads the
per-image `image_NNN.qa.jsonl` files. The planner is still a deterministic
stub, intentionally, so the measurement isolates the communication substrate
rather than LLM variance.

| metric                  | fixture text-bus | fixture thalamus | real text-bus | real thalamus |
| ----------------------- | ---------------: | ---------------: | ------------: | ------------: |
| rows                    |              250 |              250 |           150 |           150 |
| median latency          |         2.542 ms |         2.311 ms |   1837.632 ms |    174.782 ms |
| p95 latency             |         3.616 ms |         3.389 ms |   2303.725 ms |    209.884 ms |
| p99 latency             |         4.512 ms |         4.417 ms |   3694.863 ms |    252.303 ms |
| avg intermediate tokens |           13.800 |            0.000 |        18.193 |         0.000 |
| avg fidelity            |         0.590971 |         1.000000 |      0.078195 |      0.068837 |
| task success            |          40.000% |         100.000% |        6.000% |        4.667% |

The real numbers are low because BLIP often captions the scene rather than the
manual color/shape target, and the vector-bus planner stub has no learned
color/shape probe over the COCO-trained workspace. These are measured results,
not tuned paper numbers. Experiments were run locally on Windows; Pi 5 /
Docker deployment is Phase 3.

Pi 5 model-size budget for Phase 3: SigLIP about 370 MB, MiniLM about 80 MB,
Whisper-tiny about 80 MB, and BLIP-base about 990 MB, for roughly 1.5 GB
resident model memory. With a 1 GB OpenClaw process, that leaves roughly
1.5 GB headroom on a 4 GB Pi 5. If that budget is too tight, BLIP is the first
component to remove or replace on Pi 5 only.

## Round 3 status

Round 3 makes the package installable as an OpenClaw runtime extension. The
canonical plugin entry is `dist/plugin.js`, declared through
`package.json#openclaw.runtimeExtensions` and `openclaw.plugin.json`; npm
publish is still manual and should not be run by automation.

The plugin registers three agent tools:

| tool              | purpose                                                      |
| ----------------- | ------------------------------------------------------------ |
| `thalamus_encode` | encode text/image/audio input, create a packet, store memory |
| `thalamus_route`  | pop the next packet from the priority/FIFO router            |
| `thalamus_recall` | recall packet memory by packet id or text query              |

ARM64 packaging is pure TypeScript plus `better-sqlite3`; the package includes
`dist/`, Python encoder helpers, trained adapter weights, adapter metrics, and
Pi smoke scripts. Use `npm pack --dry-run` before publishing to confirm the
tarball contents.

Pi 5 smoke testing lives in `scripts/pi5-smoke-test.sh`. It checks ARM64,
Node 20/22, OpenClaw plugin registration, exposed tools, and an
encode -> route -> recall flow. When the target OpenClaw CLI does not expose
`openclaw tool call`, it falls back to `scripts/plugin-smoke.mjs`, which imports
the built plugin and exercises the same tools with a mock runtime.

The optional local planner bridge is `src/pipelines/llmPlanner.ts`. It calls
Ollama at `http://localhost:11434/api/generate` with `phi3:mini` by default and
falls back to the deterministic planner stub when Ollama is unreachable.

The Pi 5 deployment checklist is in `THALAMUS_PHASE3_PLAN.md`: mount NVMe at
`/mnt/nvme`, move OpenClaw state to `/mnt/nvme/openclaw`, install Hailo runtime,
install Ollama with `phi3:mini`, install the plugin, and run the smoke test.
Hailo/NPU encoder optimization is deferred to Round 4.

## Quick Start

```bash
npm install
npm test
npm run build
npm run experiment:run
docker compose build
docker compose run thalamus
```

## Roadmap To Phase 3

- Validate the same HF stack under Docker on amd64 and `linux/arm64/v8`.
- Measure Pi 5 resident memory and decide whether BLIP stays warm, is
  quantized, or is replaced on-device.
- Add an audio QA workload before treating Whisper as an empirical path.
- Add paired statistical tests over the real workload once the planner probe is
  less brittle.

## Companion Packages

- [@msbel/openclaw-aegis-signer](https://github.com/msbel5/openclaw-aegis-signer)
  provides Ed25519-signed tool-call audit.
- [@msbel/openclaw-sga-mcts-atoms](https://github.com/msbel5/openclaw-sga-mcts-atoms)
  provides LanceDB-backed plan-time atom retrieval.

## License

MIT
