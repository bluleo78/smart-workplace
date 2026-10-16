"""환경설정. 내부 토큰·입력/시간/쪽수 상한·엔진 실행 파일 경로.

모듈 import 시점에 환경변수를 읽는다(테스트는 conftest 에서 import 전에 주입).
main 은 요청 시점에 `config.X` 로 참조하므로 테스트에서 monkeypatch 로 상한을 바꿀 수 있다.
"""
import os
import tempfile


def _required_token(value: str | None) -> str:
    """내부 토큰 필수 검증. 비었거나 공백뿐이면 기동을 막는다 — 빈 토큰이면 `Internal ` 헤더만으로 인증이 통과될 수 있다."""
    if value is None or not value.strip():
        raise RuntimeError("INTERNAL_SERVICE_TOKEN 이 비어 있음 — converter 를 띄울 수 없다")
    return value


INTERNAL_TOKEN = _required_token(os.environ.get("INTERNAL_SERVICE_TOKEN"))
# 입력 원본 최대 바이트(기본 100MB). 초과하면 엔진 호출 없이 413 TOO_LARGE.
MAX_BYTES = int(os.environ.get("CONVERTER_MAX_BYTES", str(100 * 1024 * 1024)))
# 변환 1건 타임아웃(초). 엔진이 하위 프로세스에 적용하고 초과 시 504 TIMEOUT.
TIMEOUT_SEC = int(os.environ.get("CONVERTER_TIMEOUT_SEC", "60"))
# /convert/text 출력 최대 글자 수(기본 100만 — 워커 MAX_CHARS 와 같음). 넘으면 잘라서 돌려준다.
MAX_TEXT_CHARS = int(os.environ.get("CONVERTER_MAX_TEXT_CHARS", "1000000"))
# 출력 PDF 최대 쪽수. 초과하면 422 TOO_MANY_PAGES — 거대 문서가 미리보기 저장소를 잠식하지 않게.
MAX_PAGES = int(os.environ.get("CONVERTER_MAX_PAGES", "500"))
# 상주 soffice 를 N건 변환마다 재기동(누수·상태 오염 누적 방지).
SOFFICE_RESTART_EVERY = int(os.environ.get("CONVERTER_SOFFICE_RESTART_EVERY", "50"))
# rhwp 동시 실행 슬롯 수. soffice(동시 1건)와 별개로 HWP 는 여러 건 병렬 처리.
RHWP_SLOTS = int(os.environ.get("CONVERTER_RHWP_SLOTS", "4"))
# 외부 실행 파일 경로 — 이미지에서는 PATH 에 있으므로 기본은 이름만.
RHWP_BIN = os.environ.get("CONVERTER_RHWP_BIN", "rhwp")
RSVG_BIN = os.environ.get("CONVERTER_RSVG_BIN", "rsvg-convert")
# UNO 헬퍼를 돌릴 파이썬 — python3-uno 는 시스템 파이썬에만 설치되므로 앱 파이썬과 분리.
UNO_PYTHON = os.environ.get("CONVERTER_UNO_PYTHON", "/usr/bin/python3")
SOFFICE_BIN = os.environ.get("CONVERTER_SOFFICE_BIN", "soffice")
# 상주 soffice 의 UNO 소켓 포트(Pod 내부 루프백 전용).
SOFFICE_PORT = int(os.environ.get("CONVERTER_SOFFICE_PORT", "2002"))


def tmp_root() -> str:
    """요청별 임시 파일 루트 — 읽기 전용 루트 FS 에서도 쓰기 가능한 TMPDIR 만 쓴다.

    매 호출마다 환경변수를 읽는다(테스트가 TMPDIR 을 바꿀 수 있게, 컨테이너는 쓰기 가능한 볼륨을 TMPDIR 로 지정).
    """
    return os.environ.get("TMPDIR") or tempfile.gettempdir()
