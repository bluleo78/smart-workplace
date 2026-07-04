"""BGE-M3 dense 임베딩 — ollama /api/embeddings 로 위임.
로컬에 ollama + bge-m3 모델이 설치되어 있어야 한다.
테스트는 httpx.Client 를 monkeypatch 로 교체해 목 처리."""
import httpx
from app import config

# EMBED_MAX_CHARS 로 클립해도 한글처럼 글자당 토큰수가 많은 언어는 여전히
# bge-m3 의 8192 토큰 컨텍스트를 초과할 수 있다(#553). Ollama 가 컨텍스트 초과를
# 500 으로 응답하면 입력을 절반으로 줄여 재시도하는 축소 백오프로 방어한다.
_MAX_RETRIES = 3
_MIN_CHARS = 200  # 이보다 더 줄여도 실패하면 재시도를 포기하고 에러를 올린다


def _is_context_length_error(resp: httpx.Response) -> bool:
    """Ollama 응답 본문이 컨텍스트 초과 에러인지 판별(상태코드는 raise_for_status 가 이미 확인)."""
    try:
        body = resp.json()
    except Exception:  # noqa: BLE001 — 본문 파싱 실패 시 컨텍스트 초과로 간주하지 않음
        return False
    return "context length" in str(body.get("error", "")).lower()


def embed_text(text: str) -> list[float]:
    """텍스트를 dense 벡터(list[float])로 임베딩. EMBED_MAX_CHARS 로 절단하고,
    컨텍스트 초과 에러 시 입력을 절반씩 줄여가며 재시도한다."""
    attempt = (text or "")[: config.EMBED_MAX_CHARS]
    for i in range(_MAX_RETRIES):
        resp = httpx.post(
            f"{config.OLLAMA_BASE_URL}/api/embeddings",
            json={"model": config.EMBED_MODEL, "prompt": attempt},
            timeout=60,
        )
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError:
            is_last_attempt = i == _MAX_RETRIES - 1
            if not is_last_attempt and len(attempt) > _MIN_CHARS and _is_context_length_error(resp):
                attempt = attempt[: len(attempt) // 2]
                continue
            raise
        return [float(x) for x in resp.json()["embedding"]]
    raise RuntimeError("embed_text: retries exhausted")  # pragma: no cover — 루프가 항상 return/raise
