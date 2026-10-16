"""FastAPI 앱 통합 테스트 — 볼륨 traversal 가드 + /tasks/extract 인증 + 202 응답."""
import pytest
from app.blobs import resolve_blob_path


def test_blob_path_within_base(tmp_path):
    (tmp_path / "a").mkdir()
    f = tmp_path / "a" / "f.txt"; f.write_text("hi")
    assert resolve_blob_path(str(tmp_path), "a/f.txt") == f.resolve()


def test_blob_path_traversal_rejected(tmp_path):
    with pytest.raises(ValueError):
        resolve_blob_path(str(tmp_path), "../etc/passwd")


def test_blob_path_absolute_key_rejected(tmp_path):
    """절대 경로 storage_key는 traversal 가드에 의해 거부되어야 한다."""
    with pytest.raises(ValueError):
        resolve_blob_path(str(tmp_path), "/etc/passwd")


def test_blob_path_absolute_key_under_base_allowed(tmp_path):
    """C2: base 하위의 절대 경로 storage_key(STORAGE_PATH 그대로 전달)는 허용되어야 한다.
    api 가 FILE.STORAGE_PATH 에 절대 경로(/data/uploads/tenant-N/...)를 저장하고
    워커가 storageKey 로 그대로 전달하는 경우, base 하위면 traversal 가드를 통과해야 한다."""
    subdir = tmp_path / "tenant-1"
    subdir.mkdir()
    f = subdir / "test.pdf"
    f.write_text("content")
    # storage_key 가 절대 경로지만 base 하위 → 통과
    result = resolve_blob_path(str(tmp_path), str(f))
    assert result == f.resolve()


from fastapi.testclient import TestClient


def test_extract_endpoint_requires_auth(monkeypatch, tmp_path):
    monkeypatch.setenv("WORKER_BLOB_BASE", str(tmp_path))
    monkeypatch.setenv("WORKPLACE_API_BASE_URL", "http://api")
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", "secret")
    # 백그라운드 태스크의 콜백을 no-op으로 패치하여 재시도 백오프(~15s) 제거
    monkeypatch.setattr("app.callback.post_result", lambda *a, **kw: None)
    from app.main import app
    c = TestClient(app)
    # tenantId 필드 필수 (C1: ExtractTask 에 tenantId 추가)
    assert c.post("/tasks/extract", json={"jobId": 1, "storageKey": "a", "mime": "text/plain", "tenantId": 1}).status_code == 401
    r = c.post("/tasks/extract", headers={"Authorization": "Internal secret"},
               json={"jobId": 1, "storageKey": "a", "mime": "text/plain", "tenantId": 1})
    assert r.status_code == 202


def test_run_extract_passes_page_markers(monkeypatch, tmp_path):
    """ExtractTask.pageMarkers 가 extract_text(page_markers=) 로 전달되고, 생략 시 False(구버전 API 호환)다."""
    monkeypatch.setenv("WORKER_BLOB_BASE", str(tmp_path))
    monkeypatch.setenv("WORKPLACE_API_BASE_URL", "http://api")
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", "secret")
    monkeypatch.setattr("app.callback.post_result", lambda *a, **kw: None)
    (tmp_path / "a.txt").write_text("hi")
    from app import config, main
    monkeypatch.setattr(config, "BLOB_BASE", str(tmp_path))  # config 는 import 시점 고정이라 직접 패치
    seen = []
    monkeypatch.setattr(main, "extract_text", lambda data, mime, max_chars, page_markers=False: seen.append(page_markers) or {"text": "x"})
    main._run_extract(main.ExtractTask(jobId=1, storageKey="a.txt", mime="text/plain", tenantId=1, pageMarkers=True))
    main._run_extract(main.ExtractTask(jobId=1, storageKey="a.txt", mime="text/plain", tenantId=1))
    assert seen == [True, False]


# ---------------------------------------------------------------------------
# /render (WP-250) — PDF 페이지·이미지를 모델 입력용 이미지로 동기 변환
# ---------------------------------------------------------------------------
import io

import fitz
from PIL import Image

_AUTH = {"Authorization": "Internal secret"}


def _pdf_bytes(pages: int, with_text: bool = True) -> bytes:
    """테스트용 PDF — with_text=False 면 텍스트 레이어가 없는(스캔 유사) 페이지."""
    doc = fitz.open()
    for i in range(pages):
        p = doc.new_page()
        if with_text:
            p.insert_text((72, 72), f"page {i + 1}")
    return doc.tobytes()


def _render_client(monkeypatch, tmp_path):
    """BLOB_BASE 를 tmp_path 로 고정한 TestClient (config 는 import 시점 고정이라 직접 패치)."""
    from app import config
    from app.main import app
    monkeypatch.setattr(config, "BLOB_BASE", str(tmp_path))
    return TestClient(app)


def test_render_pdf_page_returns_png_and_page_count(monkeypatch, tmp_path):
    (tmp_path / "a.pdf").write_bytes(_pdf_bytes(3))
    c = _render_client(monkeypatch, tmp_path)
    r = c.post("/render", headers=_AUTH, json={"storageKey": "a.pdf", "mime": "application/pdf", "page": 2, "maxEdge": 800})
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.headers["x-page-count"] == "3"


def test_render_image_has_no_page_count_header(monkeypatch, tmp_path):
    buf = io.BytesIO()
    Image.new("RGB", (100, 80)).save(buf, "JPEG")
    (tmp_path / "a.jpg").write_bytes(buf.getvalue())
    c = _render_client(monkeypatch, tmp_path)
    r = c.post("/render", headers=_AUTH, json={"storageKey": "a.jpg", "mime": "image/jpeg"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    assert "x-page-count" not in r.headers


def test_render_pdf_requires_page(monkeypatch, tmp_path):
    (tmp_path / "a.pdf").write_bytes(_pdf_bytes(1))
    c = _render_client(monkeypatch, tmp_path)
    r = c.post("/render", headers=_AUTH, json={"storageKey": "a.pdf", "mime": "application/pdf"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "PAGE_REQUIRED"


def test_render_image_rejects_page(monkeypatch, tmp_path):
    buf = io.BytesIO()
    Image.new("RGB", (10, 10)).save(buf, "JPEG")
    (tmp_path / "a.jpg").write_bytes(buf.getvalue())
    c = _render_client(monkeypatch, tmp_path)
    r = c.post("/render", headers=_AUTH, json={"storageKey": "a.jpg", "mime": "image/jpeg", "page": 1})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "PAGE_NOT_ALLOWED"


def test_render_page_out_of_range_carries_page_count(monkeypatch, tmp_path):
    (tmp_path / "a.pdf").write_bytes(_pdf_bytes(3))
    c = _render_client(monkeypatch, tmp_path)
    r = c.post("/render", headers=_AUTH, json={"storageKey": "a.pdf", "mime": "application/pdf", "page": 9})
    assert r.status_code == 400
    assert r.json()["detail"] == {"code": "PAGE_OUT_OF_RANGE", "pageCount": 3}


def test_render_requires_auth(monkeypatch, tmp_path):
    c = _render_client(monkeypatch, tmp_path)
    r = c.post("/render", json={"storageKey": "a.pdf", "mime": "application/pdf", "page": 1})
    assert r.status_code == 401


def test_render_rejects_path_traversal(monkeypatch, tmp_path):
    c = _render_client(monkeypatch, tmp_path)
    r = c.post("/render", headers=_AUTH, json={"storageKey": "../x", "mime": "application/pdf", "page": 1})
    assert r.status_code == 400


def test_render_missing_blob_is_404(monkeypatch, tmp_path):
    """blob 파일이 없으면 500 이 아니라 404 NOT_FOUND — api 클라이언트가 구분해 매핑한다."""
    c = _render_client(monkeypatch, tmp_path)
    r = c.post("/render", headers=_AUTH, json={"storageKey": "nope.pdf", "mime": "application/pdf", "page": 1})
    assert r.status_code == 404 and r.json()["detail"] == {"code": "NOT_FOUND"}


def test_render_oversize_is_413(monkeypatch, tmp_path):
    from app import config
    (tmp_path / "a.pdf").write_bytes(_pdf_bytes(1))
    c = _render_client(monkeypatch, tmp_path)
    monkeypatch.setattr(config, "MAX_BYTES", 10)
    r = c.post("/render", headers=_AUTH, json={"storageKey": "a.pdf", "mime": "application/pdf", "page": 1})
    assert r.status_code == 413 and r.json()["detail"]["code"] == "TOO_LARGE"


def test_run_extract_skipped_empty_carries_page_count(monkeypatch, tmp_path):
    """텍스트 없는 PDF(스캔) 도 SKIPPED/empty 콜백에 pageCount 를 실어 페이지 이미지 보기가 범위를 알게 한다."""
    from app import config, main
    (tmp_path / "scan.pdf").write_bytes(_pdf_bytes(3, with_text=False))
    monkeypatch.setattr(config, "BLOB_BASE", str(tmp_path))
    posted = []
    monkeypatch.setattr("app.callback.post_result", lambda job_id, payload, **kw: posted.append(payload))
    main._run_extract(main.ExtractTask(jobId=1, storageKey="scan.pdf", mime="application/pdf", tenantId=7))
    assert posted == [{"tenantId": 7, "status": "SKIPPED", "error": "empty", "pageCount": 3}]


def test_render_rejects_invalid_page_and_max_edge(monkeypatch, tmp_path):
    """page<1, maxEdge 범위 밖은 500 이 아니라 422(요청 검증)."""
    (tmp_path / "a.pdf").write_bytes(_pdf_bytes(1))
    c = _render_client(monkeypatch, tmp_path)
    for bad in ({"page": 0}, {"page": 1, "maxEdge": 0}, {"page": 1, "maxEdge": 100000}):
        r = c.post("/render", headers=_AUTH, json={"storageKey": "a.pdf", "mime": "application/pdf", **bad})
        assert r.status_code == 422, bad


# ---------------------------------------------------------------------------
# /render/bytes (WP-388) — 저장소에 두지 않는 원본(메일 첨부)을 본문으로 받아 /render 와 같이 그린다
# ---------------------------------------------------------------------------
def _bytes_url(**q) -> str:
    from urllib.parse import urlencode
    return "/render/bytes?" + urlencode(q)


def test_render_bytes_pdf_page_returns_png_and_page_count(monkeypatch, tmp_path):
    c = _render_client(monkeypatch, tmp_path)
    r = c.post(_bytes_url(mime="application/pdf", page=2, maxEdge=800), headers=_AUTH, content=_pdf_bytes(3))
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.headers["x-page-count"] == "3"
    assert list(tmp_path.iterdir()) == []  # 공유 볼륨을 쓰지 않는다


def test_render_bytes_image_has_no_page_count_header(monkeypatch, tmp_path):
    buf = io.BytesIO()
    Image.new("RGB", (100, 80)).save(buf, "JPEG")
    c = _render_client(monkeypatch, tmp_path)
    r = c.post(_bytes_url(mime="image/jpeg"), headers=_AUTH, content=buf.getvalue())
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    assert "x-page-count" not in r.headers


def test_render_bytes_same_errors_as_render(monkeypatch, tmp_path):
    """page 규칙·범위 밖·손상은 /render 와 같은 코드."""
    c = _render_client(monkeypatch, tmp_path)
    pdf = _pdf_bytes(3)
    r = c.post(_bytes_url(mime="application/pdf"), headers=_AUTH, content=pdf)
    assert r.status_code == 400 and r.json()["detail"]["code"] == "PAGE_REQUIRED"
    r = c.post(_bytes_url(mime="image/jpeg", page=1), headers=_AUTH, content=pdf)
    assert r.status_code == 400 and r.json()["detail"]["code"] == "PAGE_NOT_ALLOWED"
    r = c.post(_bytes_url(mime="application/pdf", page=9), headers=_AUTH, content=pdf)
    assert r.status_code == 400 and r.json()["detail"] == {"code": "PAGE_OUT_OF_RANGE", "pageCount": 3}
    r = c.post(_bytes_url(mime="application/pdf", page=1), headers=_AUTH, content=b"not a pdf")
    assert r.status_code == 422 and r.json()["detail"]["code"] == "UNREADABLE"


def test_render_bytes_requires_auth(monkeypatch, tmp_path):
    c = _render_client(monkeypatch, tmp_path)
    r = c.post(_bytes_url(mime="application/pdf", page=1), content=_pdf_bytes(1))
    assert r.status_code == 401


def test_render_bytes_oversize_is_413(monkeypatch, tmp_path):
    from app import config
    c = _render_client(monkeypatch, tmp_path)
    monkeypatch.setattr(config, "MAX_BYTES", 10)
    r = c.post(_bytes_url(mime="application/pdf", page=1), headers=_AUTH, content=_pdf_bytes(1))
    assert r.status_code == 413 and r.json()["detail"]["code"] == "TOO_LARGE"
    # Content-Length 없이(chunked) 와도 읽는 도중 끊는다.
    r = c.post(_bytes_url(mime="application/pdf", page=1), headers=_AUTH, content=iter([b"x" * 8, b"x" * 8]))
    assert r.status_code == 413 and r.json()["detail"]["code"] == "TOO_LARGE"


def test_render_bytes_rejects_invalid_params(monkeypatch, tmp_path):
    c = _render_client(monkeypatch, tmp_path)
    for q in ({"mime": "application/pdf", "page": 0}, {"mime": "application/pdf", "page": 1, "maxEdge": 0}, {"page": 1}):
        r = c.post(_bytes_url(**q), headers=_AUTH, content=b"x")
        assert r.status_code == 422, q
