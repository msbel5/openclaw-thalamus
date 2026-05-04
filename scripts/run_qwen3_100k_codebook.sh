#!/usr/bin/env bash
set -euo pipefail
cd /home/msbel/projects-alcyone/openclaw-thalamus
LOG=/home/msbel/.openclaw/thalamus/state/corpus/bootstrap.qwen3.log
export THALAMUS_MAX_TEMP_C=${THALAMUS_MAX_TEMP_C:-86}
/home/msbel/projects-alcyone/hailo-apps/venv_hailo_apps/bin/python scripts/bootstrap_concept_corpus.py --target 100000 --limit-local 15000 --limit-mteb 90000 --encoder qwen3 --resume >> "$LOG" 2>&1
/home/msbel/projects-alcyone/hailo-apps/venv_hailo_apps/bin/python scripts/build_concept_codebook.py --prefer qwen3 >> "$LOG" 2>&1
