"""converter 텍스트 클라이언트 단위 테스트 — 실제 변환 서비스 없이 httpx MockTransport 로
요청 모양·일시/영구 오류 분류·재시도 백오프·동시 호출 상한을 검증한다(WP-433)."""
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import httpx
import pytest

from app import converter


@pytest.fixture
def seen():
    """handler 가 받은 요청 기록."""
    return []


@pytest.fixture
def sleeps(monkeypatch):
    """백오프 대기를 실제로 자지 않고 기록만 한다."""
    out: list[float] = []
    monkeypatch.setattr(converter, "_sleep", lambda s: out.append(s))
    return out


def _install(monkeypatch, seen, resp_or_fn):
    """converter._client 를 MockTransport 클라이언트로 교체한다.

    받은 요청은 `seen` 에 쌓는다. `resp_or_fn` 이 Response 면 매 요청마다 같은 응답(새 객체로 복제)을,
    callable 이면 `fn(req)` 결과를 돌려준다(예외를 던지면 그대로 전송 오류가 된다).
    """
    def handler(req):
        seen.append(req)
        if isinstance(resp_or_fn, httpx.Response):
            return httpx.Response(resp_or_fn.status_code, headers=resp_or_fn.headers, content=resp_or_fn.content)
        return resp_or_fn(req)

    monkeypatch.setattr(converter, "_client", lambda: httpx.Client(transport=httpx.MockTransport(handler)))


def _err(status: int, code: str) -> httpx.Response:
    """converter 오류 본문 모양({"detail":{"code":...}}) 응답."""
    return httpx.Response(status, json={"detail": {"code": code}})


def _raise(exc_type, msg: str):
    """요청을 받으면 httpx 전송 예외를 던지는 handler."""
    def fn(req):
        raise exc_type(msg, request=req)
    return fn


def test_posts_bytes_with_mime_and_internal_auth(monkeypatch, seen, sleeps):
    _install(monkeypatch, seen, httpx.Response(200, text="  안녕  "))
    assert converter.convert_to_text(b"\xd0\xcf", "application/x-hwp") == "안녕"
    req = seen[0]
    assert req.method == "POST" and req.url.path == "/convert/text"
    assert req.url.params["mime"] == "application/x-hwp"
    assert req.headers["authorization"] == "Internal secret"
    assert req.headers["content-type"] == "application/octet-stream"
    assert req.content == b"\xd0\xcf"
    assert sleeps == []


def test_busy_retries_with_backoff_then_succeeds(monkeypatch, seen, sleeps):
    _install(monkeypatch, seen, lambda req: _err(429, "BUSY") if len(seen) <= 2 else httpx.Response(200, text="ok"))
    assert converter.convert_to_text(b"x", "application/msword") == "ok"
    assert sleeps == [2, 4]


@pytest.mark.parametrize(
    "resp_or_fn",
    [
        _err(429, "BUSY"),  # converter 혼잡이 끝까지 풀리지 않음
        _err(503, "UNAVAILABLE"),  # 인프라 오류
        _raise(httpx.ConnectError, "refused"),  # converter 꺼짐·재기동 중
    ],
    ids=["429-busy", "503-unavailable", "connect-error"],
)
def test_transient_errors_are_retried_then_unavailable(resp_or_fn, monkeypatch, seen, sleeps):
    """일시 오류는 2·4·8s 백오프로 재시도(총 4회 시도)한 뒤 ConverterUnavailable."""
    _install(monkeypatch, seen, resp_or_fn)
    with pytest.raises(converter.ConverterUnavailable):
        converter.convert_to_text(b"x", "application/msword")
    assert len(seen) == 4 and sleeps == [2, 4, 8]


def test_read_timeout_is_unavailable_without_retry(monkeypatch, seen, sleeps):
    """read 타임아웃은 일시 오류지만 같은 잡에서 다시 기다리지 않는다(한 번만 시도)."""
    _install(monkeypatch, seen, _raise(httpx.ReadTimeout, "slow"))
    with pytest.raises(converter.ConverterUnavailable):
        converter.convert_to_text(b"x", "application/x-hwp")
    assert len(seen) == 1 and sleeps == []


@pytest.mark.parametrize("status", [401, 403, 404])
def test_misconfiguration_statuses_are_unavailable_without_retry(status, monkeypatch, seen, sleeps):
    """401/403/404 는 토큰·URL 오설정 — 파일 탓이 아니므로 종결(Rejected)하지 않고 일시 오류로 둔다."""
    _install(monkeypatch, seen, httpx.Response(status, json={"detail": "nope"}))
    with pytest.raises(converter.ConverterUnavailable):
        converter.convert_to_text(b"x", "application/msword")
    assert len(seen) == 1 and sleeps == []


def test_missing_url_is_unavailable_without_request(monkeypatch, seen, sleeps):
    """WORKPLACE_CONVERTER_URL 미설정이면 요청 없이 일시 오류 — 콜백 없이 보류된다."""
    monkeypatch.setattr(converter.config, "CONVERTER_URL", "")
    _install(monkeypatch, seen, httpx.Response(200, text="ok"))
    with pytest.raises(converter.ConverterUnavailable):
        converter.convert_to_text(b"x", "application/x-hwp")
    assert seen == []


def test_semaphore_acquire_timeout_is_unavailable(monkeypatch, seen, sleeps):
    """다른 호출이 슬롯을 쥐고 있으면 대기 상한 뒤 ConverterUnavailable — 요청은 나가지 않는다."""
    sem = threading.BoundedSemaphore(1)
    monkeypatch.setattr(converter, "_SEM", sem)
    monkeypatch.setattr(converter.config, "CONVERTER_ACQUIRE_TIMEOUT_SEC", 0.2)
    _install(monkeypatch, seen, httpx.Response(200, text="ok"))
    sem.acquire()
    try:
        started = time.monotonic()
        with pytest.raises(converter.ConverterUnavailable):
            converter.convert_to_text(b"x", "application/msword")
        assert 0.15 <= time.monotonic() - started < 2
    finally:
        sem.release()
    assert seen == []


def test_backoff_sleep_releases_semaphore(monkeypatch, seen):
    """백오프 대기 중엔 슬롯을 놓는다 — 그 사이 다른 스레드가 슬롯을 잡을 수 있어야 한다."""
    sem = threading.BoundedSemaphore(1)
    monkeypatch.setattr(converter, "_SEM", sem)
    acquired_during_sleep: list[bool] = []

    def fake_sleep(_s):
        # 다른 스레드에서 슬롯 획득을 시도해 본다(대기 중 쥐고 있으면 실패).
        out: list[bool] = []
        t = threading.Thread(target=lambda: out.append(sem.acquire(timeout=0.5)))
        t.start()
        t.join()
        if out[0]:
            sem.release()
        acquired_during_sleep.append(out[0])

    monkeypatch.setattr(converter, "_sleep", fake_sleep)
    _install(monkeypatch, seen, lambda req: _err(429, "BUSY") if len(seen) == 1 else httpx.Response(200, text="ok"))
    assert converter.convert_to_text(b"x", "application/msword") == "ok"
    assert acquired_during_sleep == [True]


@pytest.mark.parametrize(
    "status,code",
    [
        # 500 INTERNAL·504 TIMEOUT 도 영구 오류 — 추출엔 시도 상한이 없어 같은 파일이 매번 같은 식으로 실패하기 때문.
        (500, "INTERNAL"),
        (504, "TIMEOUT"),
        (415, "UNSUPPORTED"),
        (413, "TOO_LARGE"),
        (422, "CONVERT_FAILED"),
        (422, "TOO_MANY_PAGES"),
    ],
)
def test_permanent_errors_are_rejected_with_code(status, code, monkeypatch, seen, sleeps):
    """영구 오류는 재시도 없이 converter 코드를 담은 ConverterRejected."""
    _install(monkeypatch, seen, _err(status, code))
    with pytest.raises(converter.ConverterRejected) as e:
        converter.convert_to_text(b"x", "application/vnd.ms-powerpoint")
    assert e.value.code == code and str(e.value) == f"converter:{code}" and len(seen) == 1
    assert sleeps == []


@pytest.mark.parametrize(
    "resp,code",
    [
        (httpx.Response(422, json={"detail": "unprocessable"}), "HTTP_422"),  # detail 이 문자열
        (httpx.Response(400, text="bad"), "HTTP_400"),  # JSON 아님
    ],
    ids=["string-detail", "non-json"],
)
def test_error_without_code_uses_http_status(resp, code, monkeypatch, seen, sleeps):
    """오류 본문에서 코드를 못 꺼내면 HTTP_<status> 로 대신한다."""
    _install(monkeypatch, seen, resp)
    with pytest.raises(converter.ConverterRejected) as e:
        converter.convert_to_text(b"x", "application/msword")
    assert e.value.code == code and str(e.value) == f"converter:{code}" and len(seen) == 1


def test_concurrency_is_bounded(monkeypatch, seen, sleeps):
    """여러 스레드가 동시에 호출해도 converter 로 가는 동시 요청은 상한(1)을 넘지 않는다."""
    monkeypatch.setattr(converter, "_SEM", threading.BoundedSemaphore(1))
    lock = threading.Lock()
    state = {"now": 0, "max": 0}

    def handler(req):
        with lock:
            state["now"] += 1
            state["max"] = max(state["max"], state["now"])
        time.sleep(0.05)
        with lock:
            state["now"] -= 1
        return httpx.Response(200, text="ok")

    _install(monkeypatch, seen, handler)
    results: list[str] = []
    threads = [
        threading.Thread(target=lambda: results.append(converter.convert_to_text(b"x", "application/msword")))
        for _ in range(4)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results == ["ok"] * 4
    assert state["max"] == 1


def _import_config(env_overrides: dict[str, str | None]) -> subprocess.CompletedProcess:
    """별도 프로세스에서 app.config 를 import 한다 — 모듈 수준 검증을 현재 프로세스 상태와 격리해 확인한다."""
    env = {**os.environ}
    for k, v in env_overrides.items():
        if v is None:
            env.pop(k, None)
        else:
            env[k] = v
    return subprocess.run(
        [sys.executable, "-c", "from app import config; print(repr(config.CONVERTER_URL))"],
        cwd=Path(__file__).resolve().parents[1], env=env, capture_output=True, text=True,
    )


def test_config_imports_without_converter_url():
    """WORKPLACE_CONVERTER_URL 이 없어도 워커는 기동한다(레거시 형식만 보류)."""
    r = _import_config({"WORKPLACE_CONVERTER_URL": None})
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "''"


@pytest.mark.parametrize("value", ["0", "-1"])
def test_config_rejects_non_positive_concurrency(value):
    """동시 호출 상한이 1 미만이면 import 시점에 분명한 오류로 기동 실패한다."""
    r = _import_config({"WORKER_CONVERTER_CONCURRENCY": value})
    assert r.returncode != 0
    assert "WORKER_CONVERTER_CONCURRENCY" in r.stderr
