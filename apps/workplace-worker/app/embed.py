"""BGE-M3 dense 임베딩. FlagEmbedding 은 무겁고(수 GB) 최초 로드 시 모델을 다운로드하므로
get_model() 내부에서 lazy import + 싱글톤 캐시한다(목 테스트는 _model 을 monkeypatch 로 주입)."""
from app import config

# 프로세스당 1회 로드되는 모델 싱글톤. 테스트는 이 변수를 직접 교체한다.
_model = None


def get_model():
    """BGE-M3 모델을 lazy 로드. 최초 호출에서만 FlagEmbedding 을 import + 모델 다운로드."""
    global _model
    if _model is None:
        from FlagEmbedding import BGEM3FlagModel  # lazy: 모듈 로드 시 미설치여도 목 테스트 통과

        _model = BGEM3FlagModel(config.EMBED_MODEL, use_fp16=True)
    return _model


def embed_text(text: str) -> list[float]:
    """텍스트를 dense 벡터(list[float])로 임베딩. EMBED_MAX_CHARS 로 절단."""
    clipped = (text or "")[: config.EMBED_MAX_CHARS]
    model = get_model()
    out = model.encode(
        [clipped],
        batch_size=1,
        max_length=8192,
        return_dense=True,
        return_sparse=False,
        return_colbert_vecs=False,
    )
    return [float(x) for x in out["dense_vecs"][0]]
