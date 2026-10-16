"""문서 변환 HTTP 진입점. mime 으로 엔진을 골라 원본 바이트를 PDF/텍스트로 바꿔 돌려준다.

상태 없음 — 요청 본문 = 원본, 응답 본문 = 결과. 처리 순서: 인증 → mime 지원 확인 → 바쁨(429) 사전 확인 → 크기 상한 → 엔진.
엔진 실패는 ConvertError(status, code) 로 정규화해 호출자(api)가 항상 `{"detail": {"code": ...}}` 계약만 보면 되게 한다.
예상 못한 예외는 코드 결함이므로 입력 탓(422)으로 숨기지 않고 500 INTERNAL 로 돌려준다.
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Callable

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse

from . import config
from .auth import require_internal
from .engines import hwp, office
from .engines.soffice import OFFICE
from .engines.result import PdfResult
from .errors import ConvertError

log = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """기동 시 상주 soffice 를 미리 띄우고 종료 시 내린다.

    기동(최대 START_WAIT_SEC)은 스레드에서 돌려 이벤트 루프를 막지 않는다.
    기동 실패(개발 호스트에 soffice 없음 등)로 앱이 죽지 않게 로그만 남긴다 — 첫 Office 변환 때 다시 기동을 시도한다.
    """
    try:
        await asyncio.to_thread(OFFICE.start)
    except Exception:
        log.warning("soffice 사전 기동 실패 — 첫 변환 때 다시 시도", exc_info=True)
    try:
        yield
    finally:
        OFFICE.stop()


app = FastAPI(lifespan=lifespan)

# mime → 엔진 함수 레지스트리. 지원 mime 의 단일 원천 — 엔진은 여기 등록된 mime 으로만 호출된다.
# HWP·HWPX: rhwp SVG(→ rsvg-convert PDF / SVG 글자 위치 텍스트)
# Office(PPTX·PPT·DOC → PDF, XLS 는 텍스트만): 상주 soffice + UNO 헬퍼
PDF_ENGINES: dict[str, Callable[[bytes, str], PdfResult]] = {
    **dict.fromkeys(hwp.MIMES, hwp.to_pdf),
    **dict.fromkeys(office.PDF_MIMES, office.to_pdf),
}
TEXT_ENGINES: dict[str, Callable[[bytes, str], str]] = {
    **dict.fromkeys(hwp.MIMES, hwp.to_text),
    **dict.fromkeys(office.TEXT_MIMES, office.to_text),
}
# mime → 엔진 바쁨 확인(본문 수신 전 429 사전 판정용). 엔진 자체의 슬롯 획득이 최종 판정이다.
BUSY_CHECKS: dict[str, Callable[[], bool]] = {
    **dict.fromkeys(hwp.MIMES, hwp.busy),
    **dict.fromkeys(office.TEXT_MIMES, office.busy),
}


def _fail(status: int, code: str) -> HTTPException:
    """오류 계약 `{"detail": {"code": code}}` 형태의 HTTPException 을 만든다."""
    return HTTPException(status_code=status, detail={"code": code})


def _engine_dep(registry: Callable[[], dict[str, Callable]]):
    """엔진 선택 의존성을 만든다. registry 는 호출 시점의 레지스트리를 돌려준다(테스트가 통째로 바꿔 끼울 수 있게).

    본문 의존성(_read_body)보다 먼저 풀리므로 미지원 형식(415)·바쁨(429)을 큰 업로드를 받기 전에 거절한다.
    바쁨 확인은 사전 판정일 뿐 — 그 사이 다른 요청이 슬롯을 잡으면 엔진이 다시 429 를 낸다.
    """
    def select(mime: str = Query(...)) -> Callable:
        engine = registry().get(mime)
        if engine is None:
            raise _fail(415, "UNSUPPORTED")
        busy = BUSY_CHECKS.get(mime)
        if busy is not None and busy():
            raise _fail(429, "BUSY")
        return engine
    return select


_pdf_engine = _engine_dep(lambda: PDF_ENGINES)
_text_engine = _engine_dep(lambda: TEXT_ENGINES)


async def _read_body(request: Request) -> bytearray:
    """요청 본문을 MAX_BYTES 상한 안에서 읽는다.

    Content-Length 로 먼저 거르고(정직한 클라이언트는 본문 수신 없이 즉시 413),
    헤더가 없거나 거짓인 경우를 위해 스트림을 읽으며 실제 길이도 재검사한다.
    선언 길이(상한 이내)만큼 미리 잡아 두고 채워 큰 본문의 재할당을 줄이고, bytes 로 다시 복사하지 않고 넘긴다
    (엔진은 bytes-like 를 받는다).
    엔드포인트는 sync(스레드풀) 이므로 본문 읽기만 이 async 의존성에서 처리한다.
    """
    limit = config.MAX_BYTES
    declared = request.headers.get("content-length")
    size = int(declared) if declared is not None and declared.isdigit() else 0
    if size > limit:
        raise _fail(413, "TOO_LARGE")
    buf = bytearray(size)
    pos = 0
    async for chunk in request.stream():
        end = pos + len(chunk)
        if end > limit:
            raise _fail(413, "TOO_LARGE")
        # 선언 길이 안이면 제자리 덮어쓰기, 넘치면(거짓 헤더·헤더 없음) 슬라이스 대입이 뒤를 늘린다
        buf[pos:end] = chunk
        pos = end
    # 선언보다 짧게 왔으면 남은 0 바이트를 잘라낸다
    del buf[pos:]
    return buf


def _run(engine: Callable, data: bytearray, mime: str):
    """엔진 호출을 감싸 오류를 계약 코드로 정규화한다."""
    try:
        return engine(data, mime)
    except ConvertError as e:
        raise _fail(e.status, e.code) from e
    except Exception as e:
        # 입력 문제는 엔진이 ConvertError(422 등)로 알린다 — 여기 온 건 코드 결함이므로 422 로 숨기지 않는다
        log.exception("변환 중 예상 못한 오류 mime=%s size=%d", mime, len(data))
        raise _fail(500, "INTERNAL") from e


@app.get("/health")
def health():
    """무인증 헬스 체크(k8s readiness probe 용).

    상주 soffice 가 죽어 있고 재기동마저 실패하면 503 `{"ok": false}` — 이 Pod 로 Office 변환을 보내지 않게 한다.
    변환은 돌리지 않는다(프로세스·포트 확인, 필요할 때만 재기동 시도).
    """
    if not OFFICE.health():
        return JSONResponse(status_code=503, content={"ok": False, "soffice": "down"})
    return {"ok": True}


@app.post("/convert/pdf", dependencies=[Depends(require_internal)])
def convert_pdf(mime: str = Query(...),
                engine: Callable = Depends(_pdf_engine),
                data: bytearray = Depends(_read_body)) -> Response:
    """원본 → PDF. 쪽수는 X-Page-Count 헤더로 알리고, MAX_PAGES 초과는 422 TOO_MANY_PAGES."""
    result: PdfResult = _run(engine, data, mime)
    if result.page_count > config.MAX_PAGES:
        raise _fail(422, "TOO_MANY_PAGES")
    return Response(content=result.data, media_type="application/pdf",
                    headers={"X-Page-Count": str(result.page_count)})


@app.post("/convert/text", dependencies=[Depends(require_internal)])
def convert_text(mime: str = Query(...),
                 engine: Callable = Depends(_text_engine),
                 data: bytearray = Depends(_read_body)) -> Response:
    """원본 → 평문 텍스트(UTF-8). 검색 색인·AI 요약 입력용. MAX_TEXT_CHARS 를 넘으면 잘라서 돌려준다(워커도 같은 상한으로 자름)."""
    text: str = _run(engine, data, mime)[:config.MAX_TEXT_CHARS]
    return Response(content=text.encode("utf-8"), media_type="text/plain; charset=utf-8")
