"""범용 워커 디스패치. /tasks/{type} 로 작업 받고 백그라운드 처리 후 api 콜백."""
import logging

from fastapi import FastAPI, Depends, BackgroundTasks, HTTPException, Query, Request, Response
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from . import config, blobs, callback, embed
from .converter import ConverterUnavailable
from .auth import require_internal
from .extract import extract_text
from .render import RenderError, render_image, render_pdf_page

log = logging.getLogger(__name__)

app = FastAPI()


@app.get("/health")
def health() -> dict:
    return {"ok": True}


class ExtractTask(BaseModel):
    jobId: int
    storageKey: str
    mime: str
    tenantId: int  # C1: api 가 전달한 테넌트 ID — 워커는 해석하지 않고 콜백 시 그대로 에코
    pageMarkers: bool = False  # WP-242: 첨부(TEXT_ONLY)만 true. 구버전 api 호환 기본 false


@app.post("/tasks/extract", status_code=202, dependencies=[Depends(require_internal)])
def extract_task(t: ExtractTask, bg: BackgroundTasks) -> dict:
    bg.add_task(_run_extract, t)   # 즉시 202, 긴 커넥션 없음
    return {"accepted": True}


class EmbedTask(BaseModel):
    jobId: int
    text: str
    tenantId: int  # C1: api 가 전달한 테넌트 ID — 워커는 해석하지 않고 콜백 시 그대로 에코


@app.post("/tasks/embed", status_code=202, dependencies=[Depends(require_internal)])
def tasks_embed(task: EmbedTask, bg: BackgroundTasks) -> dict:
    """추출 텍스트를 BGE-M3 로 임베딩 → api 콜백. 컴퓨트는 백그라운드(요청 즉시 202)."""
    bg.add_task(_run_embed, task)
    return {"accepted": True}


def _run_embed(task: EmbedTask) -> None:
    """임베딩 실행 후 콜백. tenantId 를 echo 해 api 가 RLS 컨텍스트를 복원하게 한다(C1 패턴)."""
    try:
        vec = embed.embed_text(task.text)
        callback.post_result(task.jobId, {"tenantId": task.tenantId, "dimensions": len(vec), "embedding": vec}, path="embed-result")
    except Exception as e:  # noqa: BLE001 — 워커 실패는 api 에 전달해 FAILED 처리(영구 정체 방지)
        callback.post_result(task.jobId, {"tenantId": task.tenantId, "error": str(e)[:480]}, path="embed-result")


class EmbedQuery(BaseModel):
    text: str


@app.post("/embed-query", dependencies=[Depends(require_internal)])
async def embed_query(q: EmbedQuery) -> dict:
    """검색 쿼리 동기 임베딩(콜백 아님 — 즉시 벡터 반환). 짧은 텍스트라 빠름."""
    vec = embed.embed_text(q.text)
    return {"dimensions": len(vec), "embedding": vec}


class RenderTask(BaseModel):
    storageKey: str
    mime: str
    page: int | None = Field(default=None, ge=1)   # PDF 만, 1부터
    maxEdge: int = Field(default=1568, ge=64, le=4096)  # 긴 변 상한(px) — 범위 밖은 422


@app.post("/render", dependencies=[Depends(require_internal)])
def render(t: RenderTask) -> Response:
    """PDF 페이지·이미지를 모델 입력용 이미지로 동기 변환(WP-250). API 가 결과를 캐시한다.

    오류는 detail={code,...} 로 돌려 api 클라이언트(WorkerRenderClient)가 코드별로 매핑한다.
    """
    try:
        path = blobs.resolve_blob_path(config.BLOB_BASE, t.storageKey)
    except ValueError:  # 경로 이탈(../ 등)
        raise HTTPException(status_code=400, detail={"code": "BAD_KEY"})
    try:
        size = path.stat().st_size
    except FileNotFoundError:  # 500 대신 404 로 구분해 api 가 '파일 없음'으로 매핑
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND"})
    if size > config.MAX_BYTES:
        raise HTTPException(status_code=413, detail={"code": "TOO_LARGE"})
    # PDF 는 경로로 연다(MuPDF 가 필요한 부분만 읽는다). 이미지는 어차피 통째로 디코딩하므로 바이트로.
    return _render_response(t.mime, t.page, t.maxEdge, pdf_source=path, image_bytes=path.read_bytes)


@app.post("/render/bytes", dependencies=[Depends(require_internal)])
async def render_bytes(
    request: Request,
    mime: str = Query(...),
    page: int | None = Query(default=None, ge=1),
    maxEdge: int = Query(default=1568, ge=64, le=4096),
) -> Response:
    """요청 본문(원본 바이트)을 /render 와 같이 그린다(WP-388). 저장소에 두지 않는 원본 — 메일 첨부 — 용이다.

    메일 원본은 복호화한 평문을 디스크에 남기지 않으려고 공유 볼륨을 거치지 않고 본문으로 받는다. 한도·오류 코드·응답 모양은 /render 와 같다
    (BAD_KEY·NOT_FOUND 는 경로가 없어 생기지 않는다). 본문은 MAX_BYTES 를 넘는 순간 읽기를 멈추고 413 — 거대한 본문을 메모리에 다 올리지 않는다.
    인증은 /render 와 같은 Internal 토큰(require_internal).
    """
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > config.MAX_BYTES:
        raise HTTPException(status_code=413, detail={"code": "TOO_LARGE"})
    buf = bytearray()
    async for chunk in request.stream():
        buf.extend(chunk)
        if len(buf) > config.MAX_BYTES:  # Content-Length 없이(chunked) 온 경우도 막는다
            raise HTTPException(status_code=413, detail={"code": "TOO_LARGE"})
    data = bytes(buf)
    # 렌더는 CPU 작업·PDF 잠금 대기가 있어 이벤트 루프를 막지 않게 스레드풀에서(동기 /render 와 같은 실행 모델).
    return await run_in_threadpool(_render_response, mime, page, maxEdge, pdf_source=data, image_bytes=lambda: data)


def _render_response(mime: str, page: int | None, max_edge: int, *, pdf_source, image_bytes) -> Response:
    """/render·/render/bytes 공통 — page 규칙 확인 → 그리기 → 응답(PDF 면 X-Page-Count). 오류는 detail={code,...}."""
    try:
        if mime == "application/pdf":
            if page is None:
                raise RenderError(400, {"code": "PAGE_REQUIRED"})
            r = render_pdf_page(pdf_source, page, max_edge)
        else:
            if page is not None:
                raise RenderError(400, {"code": "PAGE_NOT_ALLOWED"})
            r = render_image(image_bytes(), mime, max_edge)
    except RenderError as e:
        raise HTTPException(status_code=e.status, detail=e.detail)
    # PDF 만 전체 페이지 수를 헤더로 알려 api 가 범위를 안내하게 한다.
    headers = {"X-Page-Count": str(r.page_count)} if r.page_count is not None else {}
    return Response(content=r.data, media_type=r.mime, headers=headers)


def _run_extract(t: ExtractTask) -> None:
    # C1: 모든 콜백 페이로드에 tenantId 를 에코한다. api WorkerCallbackController 가
    # TenantContext.set(tenantId) 로 RLS GUC 를 복원한다. 워커는 tenantId 를 해석하지 않는다.
    base_payload: dict = {"tenantId": t.tenantId}
    try:
        path = blobs.resolve_blob_path(config.BLOB_BASE, t.storageKey)
        size = path.stat().st_size
        if size > config.MAX_BYTES:
            callback.post_result(t.jobId, {**base_payload, "status": "SKIPPED", "error": "oversize"})
            return
        r = extract_text(path.read_bytes(), t.mime, config.MAX_CHARS, page_markers=t.pageMarkers)
        if not r["text"]:
            # WP-250: 스캔 PDF 도 페이지 수는 전달(페이지 이미지 보기 범위)
            callback.post_result(t.jobId, {**base_payload, "status": "SKIPPED", "error": "empty",
                                           "pageCount": r.get("pageCount")})
            return
        callback.post_result(t.jobId, {**base_payload, "status": "DONE", **r})
    except ConverterUnavailable as e:
        # converter 일시 오류(BUSY·연결 실패·503·read 타임아웃·오설정·URL 미설정 등): 콜백을 보내지 않는다.
        # api 는 FAILED/SKIPPED 콜백을 종결 처리하므로, 콜백 없이 EXTRACTING 리스 만료(10분) 후 재클레임에 맡긴다(WP-433).
        log.warning("converter 일시 오류로 추출 보류 jobId=%s mime=%s: %s", t.jobId, t.mime, e)
        return
    except Exception as e:  # noqa: BLE001 — 어떤 실패든 api 로 보고(잡 멈춤 방지)
        callback.post_result(t.jobId, {**base_payload, "status": "FAILED", "error": str(e)[:500]})
