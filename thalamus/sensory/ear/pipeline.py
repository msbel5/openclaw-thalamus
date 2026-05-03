"""Source-agnostic audio ingest pipeline."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any

from .ffmpeg_io import to_wav_16k_mono
from .whisper_runner import embed_audio, transcribe_audio


def run(input_path: str, source: str = "unknown", intent: str | None = None, metadata: dict | None = None) -> dict[str, Any]:
    src = Path(input_path).expanduser()
    with tempfile.TemporaryDirectory(prefix="thalamus-ear-") as tmp:
        wav = Path(tmp) / "audio.wav"
        to_wav_16k_mono(str(src), str(wav))
        audio = embed_audio(str(wav))
        transcript = transcribe_audio(str(wav))
        return {
            "ok": bool(audio.get("ok")),
            "source": source,
            "intent": intent,
            "input": str(src),
            "audio_vec_512": audio.get("vector"),
            "text": transcript.get("text"),
            "lang": transcript.get("lang"),
            "degraded": bool(audio.get("degraded") or transcript.get("degraded")),
            "metadata": metadata or {},
            "proof": {"audio": audio, "transcript": transcript},
        }


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("input_path")
    parser.add_argument("--source", default="manual")
    parser.add_argument("--intent")
    args = parser.parse_args()
    print(json.dumps(run(args.input_path, source=args.source, intent=args.intent), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

