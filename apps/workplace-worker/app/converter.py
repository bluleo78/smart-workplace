"""문서 변환 서비스(workplace-converter) 텍스트 클라이언트 (WP-433).

레거시 OLE(.doc/.ppt/.xls)·.hwp 텍스트 추출을 워커 로컬 변환 대신
`POST {WORKPLACE_CONVERTER_URL}/convert/text?mime=<mime>` 으로 위임한다.

오류는 두 갈래로 나눈다 — api 는 워커의 FAILED/SKIPPED 콜백을 종결 처리하므로 구분이 중요하다.
- 일시 오류 → `ConverterUnavailable`. 호출측은 콜백을 보내지 않고 api 추출 리스 만료 재시도에 맡긴다.
  - 429 BUSY·503 등 500/504 를 뺀 5xx·연결 계열 TransportError: 2·4·8s 백오프로 재시도 후 포기.
  - read 타임아웃: 재시도 없이 바로 포기(이미 90s 를 썼다 — 같은 잡에서 또 기다리면 슬롯만 오래 막는다).
  - 401/403/404: 토큰·URL 오설정이라 재시도해도 같다 — 바로 포기하되 파일 탓이 아니므로 종결시키지 않는다.
  - WORKPLACE_CONVERTER_URL 미설정·동시 호출 슬롯 대기 초과.
- 영구 오류(500 INTERNAL·504 TIMEOUT·그 밖의 4xx): 재시도 없이 `ConverterRejected`. 호출측이 FAILED 로 콜백한다.
  추출엔 시도 상한이 없어, 문서 탓으로 매번 같은 식으로 실패하는 파일(변환 중 예기치 못한 오류·타임아웃)을
  일시로 두면 리스 주기마다 변환 슬롯을 영원히 태운다(converter 는 바쁘면 큐잉 없이 즉시 429).
"""
import logging
import threading
import time

import httpx

from . import config
from .auth import internal_headers

log = logging.getLogger(__name__)

# converter 를 경유하는 mime — 정확히 이 4개. HWPX(application/hwp+zip)는 extract.py 가 직접 파싱한다.
CONVERTER_MIMES: frozenset[str] = frozenset({
    "application/msword",
    "application/vnd.ms-powerpoint",
    "application/vnd.ms-excel",
    "application/x-hwp",
})

# 일시 오류 재시도 간격(초). 최대 3회 재시도(총 4회 시도) — 총 대기가 api 추출 리스(10분)보다 충분히 짧다.
_BACKOFF_SEC = (2, 4, 8)

# 워커 → converter 동시 호출 상한. BackgroundTasks 스레드풀이 한 틱에 수십 건을 동시에 쏘면
# converter 가 429 로 포화돼 사용자 미리보기까지 굶으므로 세마포어로 직렬화한다.
# 슬롯은 요청 한 번 동안만 쥔다 — 백오프 대기 중엔 놓아 다른 잡이 그 사이 converter 를 쓸 수 있게 한다.
_SEM = threading.BoundedSemaphore(config.CONVERTER_CONCURRENCY)

# 테스트 주입점 — 백오프 대기를 실제로 자지 않게 바꿔 끼운다.
_sleep = time.sleep


class ConverterUnavailable(Exception):
    """converter 일시 오류(재시도 소진). 콜백 없이 api 리스 만료 재시도에 맡긴다."""


class ConverterRejected(Exception):
    """converter 영구 오류. `code` 는 converter 오류 코드(없으면 `HTTP_<status>`)."""

    def __init__(self, code: str):
        super().__init__(f"converter:{code}")
        self.code = code


def _client() -> httpx.Client:
    """converter 호출용 클라이언트. read 타임아웃은 converter 서버 타임아웃(60s)보다 길게 둔다(테스트 주입점)."""
    return httpx.Client(timeout=httpx.Timeout(config.CONVERTER_READ_TIMEOUT_SEC, connect=5.0))


def _error_code(r: httpx.Response) -> str:
    """오류 본문 `{"detail":{"code":...}}` 에서 코드를 꺼낸다. JSON 이 아니거나 detail 이 문자열이면 HTTP_<status>."""
    try:
        code = r.json()["detail"]["code"]
        if isinstance(code, str) and code:
            return code
    except (ValueError, KeyError, TypeError):
        pass
    return f"HTTP_{r.status_code}"


# 토큰·URL 오설정 — 재시도로 낫지 않지만 파일 탓도 아니라 종결(FAILED)시키지 않는다.
_MISCONFIG_STATUSES = frozenset({401, 403, 404})


def _is_retryable(status: int) -> bool:
    """429 와 500·504 를 뺀 5xx(503 UNAVAILABLE 등)는 재시도할 일시 오류(converter 혼잡·인프라 장애)."""
    return status == 429 or (status >= 500 and status not in (500, 504))


def _post_once(client: httpx.Client, url: str, mime: str, data: bytes, headers: dict) -> httpx.Response:
    """동시 호출 슬롯을 잡아 요청을 한 번 보낸다. 슬롯 대기가 길어지면 일시 오류로 포기한다."""
    if not _SEM.acquire(timeout=config.CONVERTER_ACQUIRE_TIMEOUT_SEC):
        raise ConverterUnavailable(f"converter 슬롯 대기 초과({config.CONVERTER_ACQUIRE_TIMEOUT_SEC}s)")
    try:
        return client.post(url, params={"mime": mime}, content=data, headers=headers)
    finally:
        _SEM.release()


def convert_to_text(data: bytes, mime: str) -> str:
    """원본 바이트를 converter 로 보내 평문 텍스트를 받는다.

    동시 호출 슬롯은 요청 한 번 동안만 쥐고 백오프 대기 중엔 놓는다.

    :param data: 원본 파일 바이트
    :param mime: CONVERTER_MIMES 중 하나
    :return: 앞뒤 공백을 걷어낸 텍스트(빈 문자열 가능 — 호출측이 empty 판정)
    :raises ConverterUnavailable: 일시 오류(재시도 소진·read 타임아웃·오설정·슬롯 대기 초과)
    :raises ConverterRejected: 영구 오류(재시도 없음)
    """
    if not config.CONVERTER_URL:
        # 주입 누락 — 레거시 4종만 보류하고 워커의 나머지 기능은 그대로 둔다(콜백 없이 리스 재시도).
        log.error("WORKPLACE_CONVERTER_URL 미설정 — 레거시 형식(mime=%s) 텍스트 추출 보류", mime)
        raise ConverterUnavailable("WORKPLACE_CONVERTER_URL 미설정")
    url = f"{config.CONVERTER_URL}/convert/text"
    headers = {**internal_headers(), "Content-Type": "application/octet-stream"}
    with _client() as client:
        last: str = ""
        for attempt in range(len(_BACKOFF_SEC) + 1):
            if attempt > 0:
                _sleep(_BACKOFF_SEC[attempt - 1])
            try:
                r = _post_once(client, url, mime, data, headers)
            except httpx.ReadTimeout as e:
                # 응답 대기만 90s 를 넘겼다 — 같은 잡에서 다시 기다리지 않고 리스 재시도에 맡긴다.
                raise ConverterUnavailable(f"ReadTimeout: {e}") from e
            except httpx.TransportError as e:
                # 연결 거부·DNS·연결 타임아웃 등 — converter 가 꺼져 있거나 재기동 중인 경우
                last = f"{type(e).__name__}: {e}"
                continue
            if r.status_code == 200:
                return r.text.strip()
            code = _error_code(r)
            if r.status_code in _MISCONFIG_STATUSES:
                log.error("converter 호출 오설정 의심 HTTP %s(%s) — 토큰·URL 확인 필요", r.status_code, code)
                raise ConverterUnavailable(f"HTTP {r.status_code} {code}")
            if _is_retryable(r.status_code):
                last = f"HTTP {r.status_code} {code}"
                continue
            raise ConverterRejected(code)
        raise ConverterUnavailable(last)
