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
# 문서 변환 서비스(workplace-converter) 주소. 레거시 .doc/.ppt/.xls·.hwp 텍스트 추출이 이를 탄다(WP-433).
# 선택 — 비어 있으면 레거시 4종만 일시 오류(콜백 없음, 에러 로그)로 보류하고 나머지 추출·렌더는 정상 동작한다.
# 기동 실패로 두면 converter 주입 누락 하나로 PDF·DOCX 등 모든 추출과 렌더까지 멈추기 때문이다.
CONVERTER_URL = os.getenv("WORKPLACE_CONVERTER_URL", "").strip().rstrip("/")
# converter 호출 read 타임아웃(초). converter 서버 변환 타임아웃(60s)보다 길어야 504 TIMEOUT 을 받아 영구 실패로 판정할 수 있다.
CONVERTER_READ_TIMEOUT_SEC = float(os.getenv("WORKER_CONVERTER_READ_TIMEOUT_SEC", "90"))
# 워커 → converter 동시 호출 상한. 한 틱의 대량 디스패치가 converter 를 429 로 포화시켜 사용자 미리보기를 굶기지 않게 한다.
CONVERTER_CONCURRENCY = int(os.getenv("WORKER_CONVERTER_CONCURRENCY", "1"))
if CONVERTER_CONCURRENCY < 1:
    # 0 이하면 세마포어를 영원히 못 잡아 레거시 추출이 전부 대기 초과로 굳는다 — 기동 시점에 분명히 알린다.
    raise ValueError(f"WORKER_CONVERTER_CONCURRENCY 는 1 이상이어야 한다: {CONVERTER_CONCURRENCY}")
# converter 동시 호출 슬롯을 기다리는 최대 시간(초). 넘기면 일시 오류로 보고 api 리스 만료 재시도에 맡긴다 —
# BackgroundTasks 스레드가 슬롯 앞에 무한정 줄 서서 스레드풀을 막지 않게 한다.
CONVERTER_ACQUIRE_TIMEOUT_SEC = float(os.getenv("WORKER_CONVERTER_ACQUIRE_TIMEOUT_SEC", "30"))
