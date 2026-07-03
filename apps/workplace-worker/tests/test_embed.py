import app.embed as embed_mod


class FakeResponse:
    def __init__(self, embedding):
        self._embedding = embedding

    def raise_for_status(self):
        pass

    def json(self):
        return {"embedding": self._embedding}


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
