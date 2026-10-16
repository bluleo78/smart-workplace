"""외부 변환 프로세스 실행 헬퍼. 타임아웃·비정상 종료를 변환 오류 계약(ConvertError)으로 바꾼다."""
import logging
import subprocess
import time
from pathlib import Path
from typing import Callable

from ..errors import ConvertError, convert_failed

log = logging.getLogger(__name__)


def _timeout() -> ConvertError:
    """마감 초과 기본 오류 — 504 TIMEOUT."""
    return ConvertError(504, "TIMEOUT")


class Deadline:
    """요청 1건의 공통 마감 시각. 여러 단계(rhwp·rsvg, soffice 기동·헬퍼)가 시간 예산 하나를 나눠 쓰게 한다.

    단계마다 각자 TIMEOUT_SEC 를 쓰면 합계가 상한을 넘으므로, 다음 단계 타임아웃은 항상 남은 시간으로 준다.
    """

    def __init__(self, seconds: float, on_expire: Callable[[], ConvertError] = _timeout) -> None:
        self._end = time.monotonic() + seconds
        # 예산이 바닥났을 때 던질 오류(기본 504). soffice 는 '기동이 예산을 다 씀'을 503 으로 알린다.
        self._on_expire = on_expire

    def left(self) -> float:
        """남은 시간(초, 음수 없이). 예외를 던지지 않는다 — 대기 시간 상한을 깎을 때 쓴다."""
        return max(self._end - time.monotonic(), 0.0)

    def remaining(self, min_left: float = 0.0) -> float:
        """남은 시간을 돌려준다. 다 썼거나 min_left 보다 적으면(다음 단계가 타임아웃이 뻔하면) on_expire 오류."""
        left = self._end - time.monotonic()
        if left <= 0 or left < min_left:
            raise self._on_expire()
        return left


def run(cmd: list[str], timeout: float, cwd: Path,
        on_fail: Callable[[int], ConvertError] | None = None) -> subprocess.CompletedProcess:
    """cmd 를 cwd 에서 실행하고 완료 결과를 돌려준다.

    - 타임아웃: subprocess.run 이 자식 프로세스를 kill 한 뒤 TimeoutExpired 를 던지므로 504 TIMEOUT 으로 바꾼다.
    - 비정상 종료(returncode != 0): 기본은 손상 파일 등 변환 불가로 보고 422 CONVERT_FAILED.
      on_fail 을 주면 종료코드 → 오류 매핑을 호출자가 정한다(UNO 헬퍼: 2=입력 문제 422, 그 외=인프라 503).
    stdin 은 닫아 대화형 프롬프트(예: 암호 입력)에서 멈추지 않게 한다.
    """
    try:
        cp = subprocess.run(cmd, cwd=cwd, timeout=timeout, capture_output=True,
                            stdin=subprocess.DEVNULL, check=False)
    except subprocess.TimeoutExpired as e:
        log.warning("변환 프로세스 타임아웃 cmd=%s timeout=%s", cmd[0], timeout)
        raise _timeout() from e
    if cp.returncode != 0:
        # stderr 앞부분만 남겨 원인 추적은 하되 로그가 문서 내용으로 넘치지 않게 한다
        log.warning("변환 프로세스 실패 cmd=%s rc=%d stderr=%s",
                    cmd[0], cp.returncode, cp.stderr[:500].decode("utf-8", "replace"))
        raise on_fail(cp.returncode) if on_fail else convert_failed()
    return cp
