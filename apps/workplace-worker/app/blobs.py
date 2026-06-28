"""공유 볼륨에서 blob 경로 해석 + path traversal 방어."""
from pathlib import Path


def resolve_blob_path(base: str, storage_key: str) -> Path:
    base_p = Path(base).resolve()
    target = (base_p / storage_key).resolve()
    if not str(target).startswith(str(base_p) + "/") and target != base_p:
        raise ValueError("blob path escapes base")
    return target
