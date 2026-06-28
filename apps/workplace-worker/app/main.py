"""범용 워커 디스패치. /tasks/{type} 로 작업 받고 백그라운드 처리 후 api 콜백."""
from fastapi import FastAPI, Depends, BackgroundTasks
from pydantic import BaseModel
from . import config, blobs, callback
from .auth import require_internal
from .extract import extract_text

app = FastAPI()


@app.get("/health")
def health() -> dict:
    return {"ok": True}


class ExtractTask(BaseModel):
    jobId: int
    storageKey: str
    mime: str
    tenantId: int  # C1: api 가 전달한 테넌트 ID — 워커는 해석하지 않고 콜백 시 그대로 에코


@app.post("/tasks/extract", status_code=202, dependencies=[Depends(require_internal)])
def extract_task(t: ExtractTask, bg: BackgroundTasks) -> dict:
    bg.add_task(_run_extract, t)   # 즉시 202, 긴 커넥션 없음
    return {"accepted": True}


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
        r = extract_text(path.read_bytes(), t.mime, config.MAX_CHARS)
        if not r["text"]:
            callback.post_result(t.jobId, {**base_payload, "status": "SKIPPED", "error": "empty"})
            return
        callback.post_result(t.jobId, {**base_payload, "status": "DONE", **r})
    except Exception as e:  # noqa: BLE001 — 어떤 실패든 api 로 보고(잡 멈춤 방지)
        callback.post_result(t.jobId, {**base_payload, "status": "FAILED", "error": str(e)[:500]})
