# openclaw-thalamus

> v1 reference implementation in progress. See PRD for spec.

Phase 1 software simulation of a native vector routing layer for OpenClaw
agents. Removes text from the inter-module bus when the consumer is
another agent, in favor of modality-preserving vector packets.

This is the third plugin in a series:

- [openclaw-aegis-signer](https://github.com/msbel5/openclaw-aegis-signer) — Ed25519-signed tool-call audit (live)
- [openclaw-sga-mcts-atoms](https://github.com/msbel5/openclaw-sga-mcts-atoms) — Plan-time atom retrieval (live)
- **openclaw-thalamus** — Native vector routing (this repo, in progress)

## Status

| Component | Status |
|-----------|--------|
| PRD | published, see [THALAMUS_PRD.md](./THALAMUS_PRD.md) |
| arXiv preprint | drafted, see https://arxiv.org/abs/26XX.YYYYY (TBD) |
| msbel.com long-form | published, see https://msbel.com/writing/thalamus-layer |
| Code (Phase 1) | implementation pending |
| npm package | reserved as @msbel/openclaw-thalamus |
| Smoke tests | defined in PRD, not yet executed |

## Roadmap

- **Phase 1** (current): software simulation, single-process, deployable on Raspberry Pi 5.
- **Phase 2**: distributed multi-process. Tensor passing via shared memory or RDMA.
- **Phase 3**: hardware thalamus. FPGA or NPU as routing accelerator.

## Why

Multi-agent LLM systems serialize through text at every hop. Each
serialization is lossy. The cost compounds. We propose routing
modality-preserving vectors directly between specialist modules,
through a software router we call the thalamus, with a layered
hippocampal memory and an idle replay loop modeled on the default
mode network.

For the long-form argument see the [arXiv preprint](https://arxiv.org/abs/26XX.YYYYY)
and the [msbel.com post](https://msbel.com/writing/thalamus-layer).

## Author

Muhammet Sıddık Bel ([@msbel5](https://github.com/msbel5)) — Independent.
Alcyone personal AI infrastructure project.

## License

MIT
