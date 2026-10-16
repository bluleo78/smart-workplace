"""테스트 환경 초기화. config 모듈이 환경변수를 import 시점에 읽으므로 import 전에 설정해야 한다."""
import os

# config 필수 환경변수 기본값 주입 — 이미 설정된 값은 덮지 않는다.
# 빈 값이면 config 가 기동을 거부하므로 비어 있을 때도 채운다.
if not os.environ.get("INTERNAL_SERVICE_TOKEN", "").strip():
    os.environ["INTERNAL_SERVICE_TOKEN"] = "secret"
