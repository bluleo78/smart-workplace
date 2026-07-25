"""LibreOffice headless 텍스트 변환. 레거시 OLE(.doc/.ppt/.xls)·.hwp 전용 경로.

동시 변환 1로 직렬화한다 — LibreOffice 인스턴스는 메모리를 크게 먹고, 같은 프로필
디렉터리를 동시에 쓰면 실패한다. 워커는 이미 백그라운드 비동기라 직렬화가 사용자
지연으로 이어지지 않는다. 변환마다 격리 프로필(-env:UserInstallation)을 지정한다.
"""
import subprocess
import tempfile
import threading
from pathlib import Path

from . import config

# 동시 변환 1 — 위 docstring 의 메모리·프로필 락 이유.
_LOCK = threading.Semaphore(1)


def convert_to_text(data: bytes, suffix: str) -> str:
    """원본 바이트를 임시 파일로 쓰고 soffice 로 txt 변환 후 내용을 돌려준다.

    :param data: 원본 파일 바이트
    :param suffix: 확장자(soffice 가 포맷을 판별하는 근거). 예 ".doc"
    :return: 추출된 텍스트
    :raises RuntimeError: 변환 실패(타임아웃·비정상 종료·산출물 없음)
    """
    with _LOCK:
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            src = tmpdir / f"input{suffix}"
            src.write_bytes(data)
            profile = tmpdir / "profile"
            cmd = [
                "soffice",
                f"-env:UserInstallation=file://{profile}",
                "--headless",
                "--norestore",
                "--convert-to",
                "txt:Text",
                "--outdir",
                str(tmpdir),
                str(src),
            ]
            try:
                proc = subprocess.run(
                    cmd, capture_output=True, timeout=config.SOFFICE_TIMEOUT_SEC
                )
            except subprocess.TimeoutExpired as e:
                raise RuntimeError(f"soffice 변환 타임아웃({config.SOFFICE_TIMEOUT_SEC}s)") from e
            if proc.returncode != 0:
                raise RuntimeError(f"soffice 변환 실패 rc={proc.returncode}")
            out = src.with_suffix(".txt")
            if not out.exists():
                raise RuntimeError("soffice 산출물 없음")
            return out.read_text(encoding="utf-8", errors="replace").strip()
