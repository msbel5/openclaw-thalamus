#!/usr/bin/env bash
set -euo pipefail
cd /home/msbel/projects-alcyone/openclaw-thalamus
LOG=/home/msbel/.openclaw/thalamus/state/corpus/bootstrap.qwen3.log
export BOOTSTRAP_TEMP_CEILING=${BOOTSTRAP_TEMP_CEILING:-84}
export THALAMUS_MAX_TEMP_C=${THALAMUS_MAX_TEMP_C:-84}
/home/msbel/projects-alcyone/hailo-apps/venv_hailo_apps/bin/python scripts/bootstrap_concept_corpus.py --target 100000 --limit-local 15000 --limit-mteb 90000 --encoder qwen3-0.6b --resume --batch 8 >> "$LOG" 2>&1
/home/msbel/projects-alcyone/hailo-apps/venv_hailo_apps/bin/python scripts/build_concept_codebook.py --prefer qwen3 >> "$LOG" 2>&1
