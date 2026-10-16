"""변환 API 계약 테스트 — 인증·헬스·mime 디스패치·상한·오류 코드 매핑.

실제 엔진(rhwp/soffice) 없이 PDF_ENGINES/TEXT_ENGINES 를 가짜 엔진으로 바꿔 끼워
HTTP 계약(상태 코드·오류 본문·헤더)만 검증한다.
"""
import pytest
from fastapi.testclient import TestClient

from app import config, main
from app.engines.result import PdfResult
from app.errors import ConvertError

AUTH = {"Authorization": "Internal secret"}
HWP = "application/x-hwp"


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def engines(monkeypatch):
    """엔진 레지스트리를 테스트마다 빈 dict 로 격리한다(다른 태스크가 등록한 실제 엔진 배제)."""
    pdf: dict = {}
    text: dict = {}
    monkeypatch.setattr(main, "PDF_ENGINES", pdf)
    monkeypatch.setattr(main, "TEXT_ENGINES", text)
    return pdf, text


@pytest.mark.parametrize("alive,status,ok", [(True, 200, True), (False, 503, False)])
def test_health_follows_soffice(client, monkeypatch, alive, status, ok):
    """soffice 가 죽어 있고 재기동도 실패하면 readiness 503 — 이 Pod 로 트래픽을 보내지 않게."""
    # 실제 싱글턴 soffice 를 띄우지 않게 main 이 쥔 OFFICE 객체의 health 를 바꾼다
    monkeypatch.setattr(main.OFFICE, "health", lambda: alive)
    r = client.get("/health")
    assert r.status_code == status
    assert r.json()["ok"] is ok


def test_text_truncated_to_max_chars(client, engines, monkeypatch):
    """텍스트 출력은 MAX_TEXT_CHARS 글자에서 자른다(바이트가 아닌 글자 단위 — 한글이 깨지지 않게)."""
    monkeypatch.setattr(config, "MAX_TEXT_CHARS", 5)
    engines[1][HWP] = lambda data, mime: "가나다라마바사"
    r = client.post(f"/convert/text?mime={HWP}", content=b"x", headers=AUTH)
    assert r.status_code == 200
    assert r.text == "가나다라마"


def test_config_rejects_blank_token():
    """INTERNAL_SERVICE_TOKEN 이 비었거나 공백뿐이면 config import(= 앱 기동)가 실패한다."""
    import os
    import subprocess
    import sys
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent
    for value in ("", "   "):
        env = {**os.environ, "INTERNAL_SERVICE_TOKEN": value}
        cp = subprocess.run([sys.executable, "-c", "import app.config"], cwd=root, env=env,
                            capture_output=True, timeout=30)
        assert cp.returncode != 0
        assert b"INTERNAL_SERVICE_TOKEN" in cp.stderr
    env = {k: v for k, v in os.environ.items() if k != "INTERNAL_SERVICE_TOKEN"}
    cp = subprocess.run([sys.executable, "-c", "import app.config"], cwd=root, env=env,
                        capture_output=True, timeout=30)
    assert cp.returncode != 0


def test_requires_internal_token(client, engines):
    engines[0][HWP] = lambda data, mime: PdfResult(b"%PDF", 1)
    r = client.post(f"/convert/pdf?mime={HWP}", content=b"x")
    assert r.status_code == 401
    r = client.post(f"/convert/pdf?mime={HWP}", content=b"x",
                    headers={"Authorization": "Internal wrong"})
    assert r.status_code == 401


def test_unsupported_mime_415(client, engines):
    r = client.post("/convert/pdf?mime=image/png", content=b"x", headers=AUTH)
    assert r.status_code == 415
    assert r.json() == {"detail": {"code": "UNSUPPORTED"}}
    r = client.post("/convert/text?mime=image/png", content=b"x", headers=AUTH)
    assert r.status_code == 415
    assert r.json() == {"detail": {"code": "UNSUPPORTED"}}


def test_too_large_413(client, engines, monkeypatch):
    called = []
    engines[0][HWP] = lambda data, mime: called.append(1) or PdfResult(b"%PDF", 1)
    monkeypatch.setattr(config, "MAX_BYTES", 10)
    r = client.post(f"/convert/pdf?mime={HWP}", content=b"x" * 11, headers=AUTH)
    assert r.status_code == 413
    assert r.json() == {"detail": {"code": "TOO_LARGE"}}
    assert called == []


def test_too_large_413_without_content_length(client, engines, monkeypatch):
    """Content-Length 가 없는(청크 전송) 요청도 실제 길이로 재검사해 거부한다."""
    called = []
    engines[0][HWP] = lambda data, mime: called.append(1) or PdfResult(b"%PDF", 1)
    monkeypatch.setattr(config, "MAX_BYTES", 10)

    def chunks():
        yield b"x" * 6
        yield b"x" * 6

    r = client.post(f"/convert/pdf?mime={HWP}", content=chunks(), headers=AUTH)
    assert r.status_code == 413
    assert r.json() == {"detail": {"code": "TOO_LARGE"}}
    assert called == []


def test_pdf_ok_returns_pdf_and_page_count(client, engines):
    seen = {}

    def fake(data: bytes, mime: str) -> PdfResult:
        seen["data"], seen["mime"] = data, mime
        return PdfResult(b"%PDF-1.7...", 3)

    engines[0][HWP] = fake
    r = client.post(f"/convert/pdf?mime={HWP}", content=b"hwp-bytes", headers=AUTH)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["x-page-count"] == "3"
    assert r.content == b"%PDF-1.7..."
    assert seen == {"data": b"hwp-bytes", "mime": HWP}


def test_too_many_pages_422(client, engines):
    engines[0][HWP] = lambda data, mime: PdfResult(b"%PDF", 501)
    r = client.post(f"/convert/pdf?mime={HWP}", content=b"x", headers=AUTH)
    assert r.status_code == 422
    assert r.json() == {"detail": {"code": "TOO_MANY_PAGES"}}


@pytest.mark.parametrize("status,code", [
    (429, "BUSY"), (503, "UNAVAILABLE"), (504, "TIMEOUT"), (422, "CONVERT_FAILED")])
def test_engine_error_maps_status(client, engines, status, code):
    """엔진의 ConvertError 는 상태·코드 그대로 오류 계약으로 나간다."""
    def fail(data, mime):
        raise ConvertError(status, code)

    engines[0][HWP] = fail
    r = client.post(f"/convert/pdf?mime={HWP}", content=b"x", headers=AUTH)
    assert r.status_code == status
    assert r.json() == {"detail": {"code": code}}


def test_unexpected_exception_is_500_internal(client, engines):
    """ConvertError 가 아닌 예외는 코드 결함 — 입력 탓(422)으로 숨기지 않고 500 INTERNAL."""
    def boom(data, mime):
        raise RuntimeError("boom")

    engines[0][HWP] = boom
    engines[1][HWP] = boom
    for path in ("pdf", "text"):
        r = client.post(f"/convert/{path}?mime={HWP}", content=b"x", headers=AUTH)
        assert r.status_code == 500
        assert r.json() == {"detail": {"code": "INTERNAL"}}


@pytest.mark.parametrize("path", ["pdf", "text"])
def test_busy_engine_is_429_before_reading_body(client, engines, monkeypatch, path):
    """엔진이 바쁘면 본문을 받기 전에 429 — 큰 업로드를 헛되이 받지 않는다."""
    called = []
    engines[0][HWP] = engines[1][HWP] = lambda data, mime: called.append(1)
    monkeypatch.setitem(main.BUSY_CHECKS, HWP, lambda: True)
    pulled = []

    def body():
        pulled.append(1)  # 앱이 본문을 읽으면(receive) 여기가 실행된다
        yield b"x"

    r = client.post(f"/convert/{path}?mime={HWP}", content=body(), headers=AUTH)
    assert r.status_code == 429
    assert r.json() == {"detail": {"code": "BUSY"}}
    assert pulled == [] and called == []


@pytest.mark.parametrize("busy,mime", [("hwp", HWP), ("office", "application/msword")])
def test_busy_checks_follow_engine_slots(busy, mime):
    """BUSY_CHECKS 는 실제 엔진 슬롯 상태를 본다 — HWP 는 rhwp 세마포어, Office 는 soffice 락."""
    from app.engines import hwp, office
    check = main.BUSY_CHECKS[mime]
    assert check() is False
    if busy == "hwp":
        taken = [hwp._SLOTS.acquire(blocking=False) for _ in range(config.RHWP_SLOTS)]
        release = hwp._SLOTS.release
    else:
        taken = [office.OFFICE._lock.acquire(blocking=False)]
        release = office.OFFICE._lock.release
    try:
        assert all(taken) and check() is True
    finally:
        for _ in taken:
            release()
    assert check() is False


def _request(declared: str | None, chunks: list[bytes]):
    """_read_body 직접 검증용 starlette Request — 헤더 Content-Length 와 실제 본문 조각을 따로 정한다."""
    from starlette.requests import Request

    headers = [(b"content-length", declared.encode())] if declared is not None else []
    msgs = [{"type": "http.request", "body": c, "more_body": i < len(chunks) - 1} for i, c in enumerate(chunks)]

    async def receive():
        return msgs.pop(0)

    return Request({"type": "http", "method": "POST", "headers": headers}, receive)


@pytest.mark.parametrize("declared", ["10", "2", None])
def test_read_body_matches_actual_length(declared):
    """미리 잡은 버퍼는 실제 받은 길이로 맞춘다 — 선언보다 짧거나 길어도(거짓 헤더) 받은 바이트 그대로."""
    import asyncio
    body = asyncio.run(main._read_body(_request(declared, [b"ab", b"cd"])))
    assert body == b"abcd"


def test_read_body_lying_header_still_capped(monkeypatch):
    """Content-Length 를 작게 속여도 실제 길이가 MAX_BYTES 를 넘으면 413."""
    import asyncio
    monkeypatch.setattr(config, "MAX_BYTES", 5)
    with pytest.raises(main.HTTPException) as e:
        asyncio.run(main._read_body(_request("2", [b"abc", b"def"])))
    assert e.value.status_code == 413


def test_text_ok(client, engines):
    engines[1][HWP] = lambda data, mime: "안녕"
    r = client.post(f"/convert/text?mime={HWP}", content=b"x", headers=AUTH)
    assert r.status_code == 200
    assert r.headers["content-type"] == "text/plain; charset=utf-8"
    assert r.text == "안녕"
