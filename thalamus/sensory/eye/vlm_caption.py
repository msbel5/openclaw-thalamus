"""Caption bridge placeholder for Hailo simple VLM chat."""

from __future__ import annotations


def caption_image(image_path: str) -> dict:
    return {
        "ok": False,
        "caption": None,
        "degraded": True,
        "error": "simple_vlm_chat wrapper not enabled in v0.2.1",
        "input": image_path,
    }

