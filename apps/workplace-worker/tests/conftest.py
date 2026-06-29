"""테스트 환경 초기화. config 모듈이 환경변수를 즉시 읽으므로 import 전에 설정해야 한다."""
import os

# config 필수 환경변수 기본값 주입 — 이미 설정된 값은 덮지 않는다.
os.environ.setdefault("WORKER_BLOB_BASE", "/tmp/worker-test-blobs")
os.environ.setdefault("WORKPLACE_API_BASE_URL", "http://localhost:9090/api/v1")
os.environ.setdefault("INTERNAL_SERVICE_TOKEN", "secret")
