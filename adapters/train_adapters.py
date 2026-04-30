#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import math
import os
from pathlib import Path
from typing import Any


DEFAULT_DATA_ROOT = Path("D:/openclaw-thalamus-cache/data/coco_5k")
DEFAULT_ENCODED_CACHE = Path("D:/openclaw-thalamus-cache/data/coco_5k_encoded.npz")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["coco", "synthetic"], default="coco")
    parser.add_argument("--data-root", type=Path, default=default_data_root())
    parser.add_argument("--encoded-cache", type=Path, default=default_encoded_cache())
    parser.add_argument("--output", type=Path, default=Path("adapters"))
    parser.add_argument("--workspace-dim", type=int, default=512)
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--temperature", type=float, default=0.07)
    parser.add_argument("--limit", type=int, default=5000)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    if args.mode == "synthetic":
        write_synthetic(args.output, args.workspace_dim)
        return 0

    import numpy as np
    import torch
    import torch.nn.functional as F

    image_embeddings, text_embeddings = load_or_encode_pairs(args)
    train_size = max(1, len(image_embeddings) - 500)
    train_v = torch.from_numpy(image_embeddings[:train_size]).float()
    train_t = torch.from_numpy(text_embeddings[:train_size]).float()
    test_v = torch.from_numpy(image_embeddings[train_size:]).float()
    test_t = torch.from_numpy(text_embeddings[train_size:]).float()

    torch.manual_seed(20260429)
    image_adapter = torch.nn.Linear(train_v.shape[1], args.workspace_dim, bias=False)
    text_adapter = torch.nn.Linear(train_t.shape[1], args.workspace_dim, bias=False)
    torch.nn.init.xavier_uniform_(image_adapter.weight)
    torch.nn.init.xavier_uniform_(text_adapter.weight)

    optimizer = torch.optim.Adam(
        list(image_adapter.parameters()) + list(text_adapter.parameters()),
        lr=args.lr,
    )
    log_path = args.output / "training_log.csv"
    step = 0
    with log_path.open("w", newline="", encoding="utf8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["step", "epoch", "loss"])
        writer.writeheader()
        for epoch in range(args.epochs):
            permutation = torch.randperm(train_v.shape[0])
            for start in range(0, train_v.shape[0], args.batch_size):
                indices = permutation[start : start + args.batch_size]
                v_batch = train_v[indices]
                t_batch = train_t[indices]
                z_v = F.normalize(image_adapter(v_batch), dim=1)
                z_t = F.normalize(text_adapter(t_batch), dim=1)
                logits = z_v @ z_t.T / args.temperature
                labels = torch.arange(logits.shape[0])
                loss = (F.cross_entropy(logits, labels) + F.cross_entropy(logits.T, labels)) / 2
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
                if step % 50 == 0:
                    writer.writerow({"step": step, "epoch": epoch + 1, "loss": float(loss.detach())})
                    handle.flush()
                    print(f"step={step} epoch={epoch + 1} loss={float(loss.detach()):.6f}")
                step += 1

    metrics = evaluate(image_adapter, text_adapter, test_v, test_t, args.temperature)
    np.save(args.output / "image_to_workspace.npy", image_adapter.weight.detach().cpu().numpy().astype("float32"))
    np.save(args.output / "text_to_workspace.npy", text_adapter.weight.detach().cpu().numpy().astype("float32"))
    (args.output / "training_metrics.json").write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf8")
    print(json.dumps(metrics, indent=2))
    return 0


def default_data_root() -> Path:
    if os.name == "nt" and Path("D:/").exists():
        return DEFAULT_DATA_ROOT
    return Path.home() / ".cache" / "openclaw-thalamus" / "data" / "coco_5k"


def default_encoded_cache() -> Path:
    if os.name == "nt" and Path("D:/").exists():
        return DEFAULT_ENCODED_CACHE
    return Path.home() / ".cache" / "openclaw-thalamus" / "data" / "coco_5k_encoded.npz"


def write_synthetic(output: Path, workspace_dim: int) -> None:
    import numpy as np

    image = np.zeros((workspace_dim, 768), dtype=np.float32)
    text = np.zeros((workspace_dim, 384), dtype=np.float32)
    for index in range(min(workspace_dim, 768)):
        image[index, index] = 1.0
    for index in range(min(workspace_dim, 384)):
        text[index, index] = 1.0
    np.save(output / "image_to_workspace.npy", image)
    np.save(output / "text_to_workspace.npy", text)
    (output / "training_metrics.json").write_text(
        json.dumps(
            {
                "mode": "synthetic",
                "retrieval@1": 1.0,
                "retrieval@5": 1.0,
                "heldout_pairs": 0,
            },
            indent=2,
        )
        + "\n",
        encoding="utf8",
    )
    (output / "training_log.csv").write_text("step,epoch,loss\n0,0,0\n", encoding="utf8")
    print("synthetic adapters written")


def load_or_encode_pairs(args: argparse.Namespace):
    import numpy as np

    args.encoded_cache.parent.mkdir(parents=True, exist_ok=True)
    if args.encoded_cache.exists():
        cached = np.load(args.encoded_cache)
        print(f"using encoded cache: {args.encoded_cache}")
        return cached["image_embeddings"], cached["text_embeddings"]

    pairs = read_pairs(args.data_root, args.limit)
    if len(pairs) < 1000:
        raise SystemExit(f"expected at least 1000 pairs, found {len(pairs)} in {args.data_root}")

    image_embeddings, text_embeddings = encode_pairs(pairs)
    np.savez_compressed(
        args.encoded_cache,
        image_embeddings=image_embeddings,
        text_embeddings=text_embeddings,
    )
    print(f"wrote encoded cache: {args.encoded_cache}")
    return image_embeddings, text_embeddings


def read_pairs(data_root: Path, limit: int) -> list[dict[str, str]]:
    manifest_path = data_root / "manifest.jsonl"
    if not manifest_path.exists():
        raise SystemExit(f"missing COCO manifest: {manifest_path}; run adapters/download_coco_5k.py")

    pairs: list[dict[str, str]] = []
    with manifest_path.open("r", encoding="utf8") as handle:
        for line in handle:
            if not line.strip():
                continue
            item = json.loads(line)
            pairs.append({"image": item["image"], "caption": item["caption"]})
            if len(pairs) >= limit:
                break
    return pairs


def encode_pairs(pairs: list[dict[str, str]]):
    import numpy as np
    import torch
    from PIL import Image
    from sentence_transformers import SentenceTransformer
    from tqdm import tqdm
    from transformers import AutoModel, AutoProcessor

    processor = AutoProcessor.from_pretrained("google/siglip-base-patch16-224")
    vision_model = AutoModel.from_pretrained("google/siglip-base-patch16-224").eval()
    text_model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2", device="cpu")

    image_vectors: list[np.ndarray] = []
    text_vectors: list[np.ndarray] = []
    batch_size = 32
    with torch.no_grad():
        for start in tqdm(range(0, len(pairs), batch_size), desc="encoding images"):
            batch = pairs[start : start + batch_size]
            images = [Image.open(item["image"]).convert("RGB") for item in batch]
            inputs = processor(images=images, return_tensors="pt", padding=True)
            features = vision_model.get_image_features(**inputs)
            features = pooled_tensor(features)
            features = torch.nn.functional.normalize(features.float(), dim=1)
            image_vectors.extend(features.cpu().numpy())

    captions = [Path(item["caption"]).read_text(encoding="utf8").strip() for item in pairs]
    text_encoded = text_model.encode(
        captions,
        batch_size=64,
        show_progress_bar=True,
        normalize_embeddings=True,
    )
    text_vectors.extend(text_encoded)

    return np.asarray(image_vectors, dtype=np.float32), np.asarray(text_vectors, dtype=np.float32)


def evaluate(image_adapter: Any, text_adapter: Any, test_v: Any, test_t: Any, temperature: float) -> dict[str, Any]:
    import torch
    import torch.nn.functional as F

    if test_v.shape[0] == 0:
        return {"mode": "coco", "retrieval@1": 0.0, "retrieval@5": 0.0, "heldout_pairs": 0}
    with torch.no_grad():
        z_v = F.normalize(image_adapter(test_v), dim=1)
        z_t = F.normalize(text_adapter(test_t), dim=1)
        sims = z_v @ z_t.T / temperature
        top5 = torch.topk(sims, k=min(5, sims.shape[1]), dim=1).indices
        labels = torch.arange(sims.shape[0]).unsqueeze(1)
        r1 = (top5[:, :1] == labels).any(dim=1).float().mean().item()
        r5 = (top5 == labels).any(dim=1).float().mean().item()
    return {
        "mode": "coco",
        "retrieval@1": r1,
        "retrieval@5": r5,
        "heldout_pairs": int(test_v.shape[0]),
    }


def pooled_tensor(features: Any) -> Any:
    tensor = getattr(features, "pooler_output", None)
    if tensor is None:
        tensor = getattr(features, "last_hidden_state", None)
    if tensor is None:
        tensor = features[0] if isinstance(features, (tuple, list)) else features
    if getattr(tensor, "ndim", 0) == 3:
        tensor = tensor.mean(dim=1)
    return tensor


if __name__ == "__main__":
    raise SystemExit(main())
