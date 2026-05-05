# Contributing to Thalamus

We welcome contributions. The code is small enough to read in one sitting (< 7000 LOC). Pick something, open an issue, send a PR.

## Quick orientation

```
src/
├── packet_store.js       # TTL'd context blobs with content-hash resolver keys
├── vector_store.js       # 9 namespaces, cosine + BBQ search, atom search
├── encoder_client.js     # UNIX-socket client to encoder daemon
├── spawn_guard.js        # PRD-K Captain enforcement, alcyone-v1 protocol auto-tag
├── escalate.js           # Inspector REJECTED → Captain reroute state machine
├── tensor_bundle.js      # GC-aware tensor binary payloads
├── dashboard.js          # HTTP API on :18888 with HMAC bearer auth
├── router.js             # Captain-side route() entry point
└── cli.js                # CLI executable

daemon/
├── encoder_server.py     # asyncio UNIX socket, llama.cpp + Hailo HEFs
└── requirements.txt

scripts/
├── bootstrap_concept_corpus.py    # Build 50K-100K corpus for codebook training
├── build_concept_codebook.py      # Train BBQ + OPQ + PQ, pick best
├── lossless_handoff_bench.py      # Token-reduction measurement
└── post_inspector_verdict.sh      # Inspector verdict → gh pr comment

docs/
├── ALCYONE_PROTOCOL.md   # Inter-agent @-code symbolic compression
├── OPENCLAW_PATCHES.md   # Runtime patches (e.g. tilde-path fix)
└── DREAMING.md           # Optional autonomous self-improvement crons
```

## Set up

```bash
git clone https://github.com/msbel5/openclaw-thalamus
cd openclaw-thalamus
npm install

# Optional: encoder daemon
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r daemon/requirements.txt

# Run smoke test
node scripts/lossless_handoff_bench.js
```

## Where to start

### ⭐ Good first issues

- **Add unit tests** for `packet_store.js` resolver key collision handling
- **Document one MCP tool** with a worked example
- **Add a `--json` output flag** to the CLI commands that currently print human text
- **Improve `THALAMUS_HOME` discovery** when the user installs globally on macOS/Linux

### 🧠 Medium

- **Multi-platform packaging**: macOS (`brew install openclaw-thalamus`), Linux x86_64, Windows WSL2
- **More encoder backends**: BGE-M3, GTE-multilingual-base (305M), ONNX runtime adapter
- **Tensor bundle GC tuning**: current threshold is conservative; needs profiling
- **Coverage**: get `vector_store.js` test coverage above 60%
- **Hailo HEF compilation guide**: how to compile a custom embedding model to Hailo-10H format

### 🚀 Hard / research

- **GEPA loop activation**: Inspector verdicts → Captain prompt evolution proposals (scaffold exists, cron is `enabled: false`)
- **Voyager skill mining**: extract recurring patterns from telemetry → atoms.code recipes
- **TTS integration**: Piper on Pi 5 CPU for Telegram voice messages
- **Cross-vendor vector standardisation**: when OpenAI, Anthropic, Google all settle on common embedding shape, write the bridge

## How to submit

1. Open an issue first if your change is non-trivial. Avoid drive-by PRs that introduce architectural changes.
2. Create a branch: `git checkout -b feat/your-change`
3. Make the change, add tests if it touches `src/` or `daemon/`
4. Run the smoke test: `node scripts/lossless_handoff_bench.js` should still report `>=90%` reduction
5. Run linter: `npm run lint`
6. Commit with a clear message referring to the issue: `feat(vector_store): add Lance backend (#42)`
7. Push and open a PR. Fill in the template.
8. CI runs automatically: lint + smoke. PRs that touch `daemon/` also run a Python `pyflakes` check.

## Style

- **Node**: native `node:http` only. No Express, no Hono. Keep dependencies minimal.
- **Python**: stdlib + `numpy` + `faiss-cpu` + `llama-cpp-python` are allowed. No torch, no transformers in production daemon.
- **Comments**: explain *why*, not *what*. The code already says what.
- **Tests**: unit tests in `test/`. Integration tests on Pi only via `make pi-test`.

## What we will NOT merge

- Anything that adds a 1GB+ runtime dependency without an `enabled_default: false` gate
- Anything that pretends to feed raw vectors to commercial LLMs as token input. They cannot read them in 2026. Don't lie in the README.
- Hardcoded API keys, secrets, telephone numbers, or personal data
- Code without an issue discussion if it changes architecture

## Code of conduct

Be kind. We are a tiny project trying to do useful work on cheap hardware.

## License

By contributing, you agree your work will be released under [MIT](LICENSE).

## Acknowledgment

Thanks for considering this. Even tiny contributions matter — typo fixes, test
coverage, documentation. Open an issue if you want to discuss something before
writing code.

— Mami
