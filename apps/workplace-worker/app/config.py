"""환경설정. INTERNAL_SERVICE_TOKEN·공유 볼륨 base·api base·캡."""
import os

BLOB_BASE = os.environ["WORKER_BLOB_BASE"]            # 공유 볼륨 마운트 경로(읽기 전용)
API_BASE = os.environ["WORKPLACE_API_BASE_URL"]       # 콜백 대상
INTERNAL_TOKEN = os.environ["INTERNAL_SERVICE_TOKEN"]
MAX_BYTES = int(os.environ.get("WORKER_EXTRACT_MAX_BYTES", str(25 * 1024 * 1024)))
MAX_CHARS = int(os.environ.get("WORKER_EXTRACT_MAX_CHARS", str(1_000_000)))  # ~1MB chars
# 임베딩 모델(설정 가능). 기본 BGE-M3. 차원은 api 마이그레이션 vector(1024) 와 일치해야 한다.
EMBED_MODEL = os.getenv("WORKER_EMBED_MODEL", "BAAI/bge-m3")
# 임베딩 입력 최대 문자 수(BGE-M3 8192 토큰 ≈ 안전 컷). 초과분은 절단.
EMBED_MAX_CHARS = int(os.getenv("WORKER_EMBED_MAX_CHARS", "8000"))
