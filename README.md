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

## Quick Start

```bash
npm install
npm test
npm run build
```

## Roadmap To Phase 2

- Replace stub encoders with real local adapters for vision, text, and audio.
- Train paired-data contrastive adapters for image-caption and
  audio-transcript alignment.
- Add latency and fidelity benchmarks against a text-bus baseline.
- Move toward multi-process tensor transport with JSON metadata and binary
  payloads out of band.

## Companion Packages

- [@msbel/openclaw-aegis-signer](https://github.com/msbel5/openclaw-aegis-signer)
  provides Ed25519-signed tool-call audit.
- [@msbel/openclaw-sga-mcts-atoms](https://github.com/msbel5/openclaw-sga-mcts-atoms)
  provides LanceDB-backed plan-time atom retrieval.

## License

MIT
