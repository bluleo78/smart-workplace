"""완료 결과를 api 로 콜백(best-effort 4회 백오프). 영구 유실은 api lease 가 책임."""
import time
import httpx
from . import config


def post_result(job_id: int, payload: dict) -> None:
    url = f"{config.API_BASE}/internal/worker/jobs/{job_id}/result"
    headers = {"Authorization": f"Internal {config.INTERNAL_TOKEN}"}
    for attempt in range(4):
        try:
            r = httpx.post(url, json=payload, headers=headers, timeout=30)
            if r.status_code < 500:
                return
        except httpx.HTTPError:
            pass
        time.sleep(2 ** attempt)
