#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/.."

tests=(
  smoke/00_init_namespaces.py
  smoke/20_semantic_text.py
  smoke/21_semantic_audio_whisper.py
  smoke/22_semantic_image_clip.py
  smoke/23_crossmodal_real.py
  smoke/24_telegram_voice_e2e.py
  smoke/25_agent_ingest_handoff.py
  smoke/26_video_ingest.py
  smoke/27_telegram_video_adapter.py
)

strict=(20 21 22 23)
pass=0
fail=0
strict_fail=0

for test in "${tests[@]}"; do
  echo "== $test =="
  if /home/msbel/projects-alcyone/hailo-apps/venv_hailo_apps/bin/python "$test"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    for id in "${strict[@]}"; do
      if [[ "$test" == *"/$id"* ]]; then
        strict_fail=$((strict_fail + 1))
      fi
    done
  fi
done

echo "{\"pass\":$pass,\"fail\":$fail,\"strict_fail\":$strict_fail}"
[[ "$strict_fail" -eq 0 ]]

