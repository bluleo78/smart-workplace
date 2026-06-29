"""완료 결과를 api 로 콜백(best-effort 4회 백오프). 영구 유실은 api lease 가 책임."""
import time
import httpx
from . import config


def post_result(job_id: int, payload: dict, path: str = "result") -> None:
    """워커 결과를 api 콜백으로 전송. path='result'(추출) | 'embed-result'(임베딩). 4회 백오프 재시도."""
    url = f"{config.API_BASE}/internal/worker/jobs/{job_id}/{path}"
    headers = {"Authorization": f"Internal {config.INTERNAL_TOKEN}"}
    for attempt in range(4):
        try:
            r = httpx.post(url, json=payload, headers=headers, timeout=30)
            if r.status_code < 500:
                return
        except httpx.HTTPError:
            pass
        time.sleep(2 ** attempt)
