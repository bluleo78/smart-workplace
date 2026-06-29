"""BGE-M3 dense 임베딩 — ollama /api/embeddings 로 위임.
로컬에 ollama + bge-m3 모델이 설치되어 있어야 한다.
테스트는 httpx.Client 를 monkeypatch 로 교체해 목 처리."""
import httpx
from app import config


def embed_text(text: str) -> list[float]:
    """텍스트를 dense 벡터(list[float])로 임베딩. EMBED_MAX_CHARS 로 절단."""
    clipped = (text or "")[: config.EMBED_MAX_CHARS]
    resp = httpx.post(
        f"{config.OLLAMA_BASE_URL}/api/embeddings",
        json={"model": config.EMBED_MODEL, "prompt": clipped},
        timeout=60,
    )
    resp.raise_for_status()
    return [float(x) for x in resp.json()["embedding"]]
