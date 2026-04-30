# Thalamus Phase 3 Pi 5 Deployment Plan

## Target

Raspberry Pi 5, 4 GB RAM, AI HAT+ 2 with Hailo-8, and 500 GB NVMe. Round 3
only makes the OpenClaw plugin installable and smoke-testable. Hailo/NPU
encoder acceleration is Round 4.

## Bring-Up Steps

1. Mount the NVMe at `/mnt/nvme`.
2. Move the OpenClaw state directory to `/mnt/nvme/openclaw` and export the
   matching service environment, for example `OPENCLAW_STATE_DIR=/mnt/nvme/openclaw`.
3. Install the Hailo runtime:

   ```bash
   sudo apt update
   sudo apt install hailort
   ```

4. Install Ollama and pull the local planner model:

   ```bash
   ollama pull phi3:mini
   ```

5. Install the plugin after Mami publishes the package:

   ```bash
   openclaw plugins install @msbel/openclaw-thalamus
   ```

6. Run the smoke test:

   ```bash
   bash scripts/pi5-smoke-test.sh
   ```

## Expected Smoke Result

The smoke test verifies ARM64, Node 20/22, plugin discovery, tool registration,
and a text encode -> route -> recall cycle. If the current OpenClaw CLI does
not expose `openclaw tool call`, the script falls back to the local
`scripts/plugin-smoke.mjs` runner against `dist/plugin.js`.

## Round 4 Work

Round 4 should measure resident memory on Pi 5, decide whether BLIP stays
loaded, and evaluate Hailo-accelerated encoder paths. If memory is tight,
remove or replace BLIP first; the Phase 2.5 paper numbers should remain marked
as Windows CPU results.
