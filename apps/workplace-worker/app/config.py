"""환경설정. INTERNAL_SERVICE_TOKEN·공유 볼륨 base·api base·캡."""
import os

BLOB_BASE = os.environ["WORKER_BLOB_BASE"]            # 공유 볼륨 마운트 경로(읽기 전용)
API_BASE = os.environ["WORKPLACE_API_BASE_URL"]       # 콜백 대상
INTERNAL_TOKEN = os.environ["INTERNAL_SERVICE_TOKEN"]
MAX_BYTES = int(os.environ.get("WORKER_EXTRACT_MAX_BYTES", str(25 * 1024 * 1024)))
MAX_CHARS = int(os.environ.get("WORKER_EXTRACT_MAX_CHARS", str(1_000_000)))  # ~1MB chars
