import app.embed as embed_mod


def test_embed_text_returns_dense_vector(monkeypatch):
    # BGE-M3 모델을 목킹 — 실제 2.2GB 다운로드/로드 회피. embed_text 가 dense 벡터를 list[float] 로 반환하는지만 검증.
    class FakeModel:
        def encode(self, texts, batch_size, max_length, return_dense, return_sparse, return_colbert_vecs):
            assert return_dense is True
            return {"dense_vecs": [[0.1, 0.2, 0.3] for _ in texts]}

    monkeypatch.setattr(embed_mod, "_model", FakeModel())
    vec = embed_mod.embed_text("안녕하세요 hello")
    assert isinstance(vec, list)
    assert vec == [0.1, 0.2, 0.3]


def test_embed_text_truncates_to_max_chars(monkeypatch):
    captured = {}

    class FakeModel:
        def encode(self, texts, **kw):
            captured["text"] = texts[0]
            return {"dense_vecs": [[0.0]]}

    monkeypatch.setattr(embed_mod, "_model", FakeModel())
    monkeypatch.setattr(embed_mod.config, "EMBED_MAX_CHARS", 5)
    embed_mod.embed_text("0123456789")
    assert captured["text"] == "01234"


def test_embed_query_endpoint_returns_vector(monkeypatch):
    from fastapi.testclient import TestClient
    import app.main as main_mod
    import app.embed as embed_mod2
    monkeypatch.setattr(embed_mod2, "_model", type("M", (), {"encode": lambda self, t, **k: {"dense_vecs": [[0.5, 0.5]]}})())
    monkeypatch.setattr(main_mod.config, "INTERNAL_TOKEN", "tok")
    client = TestClient(main_mod.app)
    r = client.post("/embed-query", json={"text": "hi"}, headers={"Authorization": "Internal tok"})
    assert r.status_code == 200
    assert r.json()["embedding"] == [0.5, 0.5]
