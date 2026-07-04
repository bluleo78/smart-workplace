import httpx
import pytest

import app.embed as embed_mod


class FakeResponse:
    def __init__(self, embedding):
        self._embedding = embedding

    def raise_for_status(self):
        pass

    def json(self):
        return {"embedding": self._embedding}


class FakeErrorResponse:
    """Ollama 컨텍스트 초과(500) 응답을 흉내내는 목."""

    def __init__(self, message="the input length exceeds the context length", status_code=500):
        self._message = message
        self.status_code = status_code

    def raise_for_status(self):
        raise httpx.HTTPStatusError("error", request=None, response=self)

    def json(self):
        return {"error": self._message}


def test_embed_text_returns_dense_vector(monkeypatch):
    # ollama /api/embeddings 를 목킹 — 실제 네트워크 호출 회피. embed_text 가 dense 벡터를 list[float] 로 반환하는지만 검증.
    def fake_post(url, json, timeout):
        return FakeResponse([0.1, 0.2, 0.3])

    monkeypatch.setattr(embed_mod.httpx, "post", fake_post)
    vec = embed_mod.embed_text("안녕하세요 hello")
    assert isinstance(vec, list)
    assert vec == [0.1, 0.2, 0.3]


def test_embed_text_truncates_to_max_chars(monkeypatch):
    captured = {}

    def fake_post(url, json, timeout):
        captured["text"] = json["prompt"]
        return FakeResponse([0.0])

    monkeypatch.setattr(embed_mod.httpx, "post", fake_post)
    monkeypatch.setattr(embed_mod.config, "EMBED_MAX_CHARS", 5)
    embed_mod.embed_text("0123456789")
    assert captured["text"] == "01234"


def test_embed_text_default_max_chars_is_lowered(monkeypatch):
    # #553: char 클립만으로는 한글 장문에서 토큰 한도를 넘겨 500 을 유발했다.
    # 기본값이 안전선(8000 미만)으로 하향됐는지 회귀 방지.
    import app.config as config_mod

    assert config_mod.EMBED_MAX_CHARS < 8000


def test_embed_text_retries_with_shrunk_input_on_context_length_error(monkeypatch):
    # #553: bge-m3 컨텍스트(8192 토큰) 초과 500 응답을 받으면 입력을 절반으로 줄여 재시도하고,
    # 짧아진 입력이 성공하면 그 결과를 반환해야 한다(영구 FAILED 방지).
    calls = []

    def fake_post(url, json, timeout):
        text = json["prompt"]
        calls.append(text)
        if len(text) > 3:
            return FakeErrorResponse()
        return FakeResponse([0.9])

    monkeypatch.setattr(embed_mod.httpx, "post", fake_post)
    monkeypatch.setattr(embed_mod.config, "EMBED_MAX_CHARS", 10)
    monkeypatch.setattr(embed_mod, "_MIN_CHARS", 1)
    vec = embed_mod.embed_text("가나다라마바사아자차")

    assert vec == [0.9]
    assert len(calls) >= 2
    # 매 재시도마다 입력 길이가 절반으로 줄어들어야 한다
    for prev, cur in zip(calls, calls[1:]):
        assert len(cur) < len(prev)


def test_embed_text_raises_when_context_length_error_persists(monkeypatch):
    # 최소 길이까지 줄여도 계속 500 이면 재시도를 포기하고 예외를 올려 job 이 FAILED 처리되게 한다.
    def fake_post(url, json, timeout):
        return FakeErrorResponse()

    monkeypatch.setattr(embed_mod.httpx, "post", fake_post)
    monkeypatch.setattr(embed_mod.config, "EMBED_MAX_CHARS", 10)
    with pytest.raises(httpx.HTTPStatusError):
        embed_mod.embed_text("가나다라마바사아자차")


def test_embed_text_does_not_retry_non_context_length_errors(monkeypatch):
    # 컨텍스트 초과가 아닌 다른 에러(예: 모델 미존재)는 축소 재시도 없이 즉시 예외를 올린다.
    calls = []

    def fake_post(url, json, timeout):
        calls.append(json["prompt"])
        return FakeErrorResponse(message="model not found")

    monkeypatch.setattr(embed_mod.httpx, "post", fake_post)
    monkeypatch.setattr(embed_mod.config, "EMBED_MAX_CHARS", 10)
    with pytest.raises(httpx.HTTPStatusError):
        embed_mod.embed_text("가나다라마바사아자차")
    assert len(calls) == 1


def test_embed_query_endpoint_returns_vector(monkeypatch):
    from fastapi.testclient import TestClient
    import app.main as main_mod
    import app.embed as embed_mod2

    def fake_post(url, json, timeout):
        return FakeResponse([0.5, 0.5])

    monkeypatch.setattr(embed_mod2.httpx, "post", fake_post)
    monkeypatch.setattr(main_mod.config, "INTERNAL_TOKEN", "tok")
    client = TestClient(main_mod.app)
    r = client.post("/embed-query", json={"text": "hi"}, headers={"Authorization": "Internal tok"})
    assert r.status_code == 200
    assert r.json()["embedding"] == [0.5, 0.5]
