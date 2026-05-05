# Contributing to Thalamus

Contributions are welcome. The code is small (~4400 LOC: 3796 in `src/`, 635 in `daemon/`).

## Layout

```
src/
  packet_store.js       TTL packet store with content-hash resolver keys
  vector_store.js       9 namespaces, cosine + BBQ search
  encoder_client.js     UNIX-socket client to encoder daemon
  spawn_guard.js        Captain enforcement, alcyone-v1 protocol auto-tag
  escalate.js           Inspector REJECTED -> Captain reroute state machine
  tensor_bundle.js      GC-aware tensor binary payloads
  dashboard.js          HTTP API on :18888 with HMAC bearer auth
  router.js             Captain-side route() entry point
  cli.js                CLI executable
  server.js             MCP server entry point

daemon/
  encoder_server.py     asyncio UNIX socket, llama.cpp + Hailo HEFs
  requirements.txt

scripts/
  bootstrap_concept_corpus.py    Build 50K-100K corpus for codebook training
  build_concept_codebook.py      Train BBQ + OPQ + PQ, pick best
  lossless_handoff_bench.py      Token-reduction measurement
  post_inspector_verdict.sh      Inspector verdict -> gh pr comment

docs/
  ALCYONE_PROTOCOL.md   Inter-agent @-code symbolic compression
  OPENCLAW_PATCHES.md   Runtime patches (e.g. tilde-path fix)
  DREAMING.md           Optional autonomous self-improvement crons
```

## Set up

```
git clone https://github.com/msbel5/openclaw-thalamus
cd openclaw-thalamus
npm install

python -m venv .venv
source .venv/bin/activate            # or .venv\Scripts\activate on Windows
pip install -r daemon/requirements.txt

python scripts/lossless_handoff_bench.py
```

## Where to start

### Good first issues

- Add unit tests for `packet_store.js` resolver key collision handling
- Document one MCP tool with a worked example
- Add a `--json` output flag to CLI commands that currently print human text
- Improve `THALAMUS_HOME` discovery on macOS/Linux global installs

### Medium

- Multi-platform packaging: macOS, Linux x86_64, Windows WSL2
- More encoder backends: BGE-M3, GTE-multilingual-base (305M), ONNX runtime
- Tensor bundle GC tuning: current threshold is conservative
- Coverage: get `vector_store.js` test coverage above 60%
- Hailo HEF compilation guide

### Larger work

- GEPA loop activation: Inspector verdicts -> Captain prompt evolution proposals (scaffold exists, cron is `enabled: false`)
- Voyager skill mining: extract recurring patterns from telemetry -> atoms.code recipes
- TTS integration: Piper on Pi 5 CPU for Telegram voice messages

## Submission

1. Open an issue first for non-trivial changes.
2. Create a branch: `git checkout -b feat/your-change`.
3. Make the change. Add tests if it touches `src/` or `daemon/`.
4. Run the bench: `python scripts/lossless_handoff_bench.py` should still
   report a token reduction (compare against `BENCHMARKS.md`).
5. Run lint: `npm run lint`.
6. Commit with a clear message.
7. Push and open a PR. Fill in the template.
8. CI runs lint and a fast smoke test on every PR. PRs touching `daemon/`
   also run pyflakes.

## Style

- Node: native `node:http`. No Express, no Hono. Keep dependencies minimal.
- Python: stdlib + `numpy` + `faiss-cpu` + `llama-cpp-python` for the daemon.
  No torch or transformers in production daemon.
- Comments explain *why*, not *what*.
- Tests in `test/`. Integration tests on Pi via `make pi-test`.

## What we will not merge

- Changes that add 1 GB+ runtime dependencies without an `enabled_default: false` gate
- Anything that claims to feed raw vectors to commercial LLMs as token input —
  current LLMs do not read raw vectors as of 2026
- Hardcoded API keys, secrets, telephone numbers, or personal data
- Architectural changes without an issue discussion

## License

MIT. See [LICENSE](LICENSE).
