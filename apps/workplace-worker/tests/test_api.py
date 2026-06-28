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
