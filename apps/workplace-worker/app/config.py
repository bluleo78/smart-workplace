"""환경설정. INTERNAL_SERVICE_TOKEN·공유 볼륨 base·api base·캡."""
import os

BLOB_BASE = os.environ["WORKER_BLOB_BASE"]            # 공유 볼륨 마운트 경로(읽기 전용)
API_BASE = os.environ["WORKPLACE_API_BASE_URL"]       # 콜백 대상
INTERNAL_TOKEN = os.environ["INTERNAL_SERVICE_TOKEN"]
MAX_BYTES = int(os.environ.get("WORKER_EXTRACT_MAX_BYTES", str(25 * 1024 * 1024)))
MAX_CHARS = int(os.environ.get("WORKER_EXTRACT_MAX_CHARS", str(1_000_000)))  # ~1MB chars
# 임베딩 모델(설정 가능). 기본 BGE-M3. 차원은 api 마이그레이션 vector(1024) 와 일치해야 한다.
EMBED_MODEL = os.getenv("WORKER_EMBED_MODEL", "bge-m3")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
# 임베딩 입력 최대 문자 수. BGE-M3 컨텍스트 한계는 8192 "토큰"이지 char 가 아니다 —
# 한글은 글자당 토큰 수가 많아(#553) 8000자 클립도 토큰 한도를 초과해 Ollama 500 을 유발할 수 있다.
# 2000자를 기본 안전선으로 하향(추가 안전망은 embed.py 의 500 시 축소 재시도 백오프).
EMBED_MAX_CHARS = int(os.getenv("WORKER_EMBED_MAX_CHARS", "2000"))
# LibreOffice 변환 타임아웃(초). 초과 시 프로세스 kill → 예외 → api 가 SKIPPED 처리.
SOFFICE_TIMEOUT_SEC = int(os.getenv("WORKER_SOFFICE_TIMEOUT_SEC", "60"))
