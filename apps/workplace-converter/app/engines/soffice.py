"""상주 LibreOffice(soffice) 관리 — Pod 안에 soffice 하나를 띄워 두고 UNO 헬퍼로 변환한다.

왜 상주인가: 요청마다 soffice 를 새로 띄우면 4~8초, 떠 있는 인스턴스에 소켓으로 붙으면 ~1.2초.
왜 헬퍼 프로세스인가: python3-uno 는 시스템 파이썬(/usr/bin/python3)에만 설치되어 앱 파이썬(3.12)에서
`import uno` 가 안 된다. 그래서 변환 1건마다 시스템 파이썬으로 `uno_helper.py` 를 실행해 소켓에 붙인다.

동시성: soffice 는 한 번에 1건만 처리한다. 바쁘면 기다리지 않고 즉시 429 BUSY — 호출자가 재시도.
오류 구분: 헬퍼 종료코드 2 = 문서 로드·변환 실패(입력 문제, 422) → soffice 는 멀쩡하므로 재기동하지 않는다.
  그 외(타임아웃 504·연결 실패 3·import 실패·시그널 사망 등) 또는 soffice 가 죽어 있으면 인프라 오류 503 UNAVAILABLE.
복구: 인프라 오류·타임아웃이면 soffice 를 죽이기만 하고(즉시), 다시 띄우는 일은 다음 변환·/health 가 맡는다 —
  실패 응답이 재기동 대기(최대 20초)만큼 늘어지지 않게.
마감: 지연 기동 + 헬퍼 실행을 합쳐 요청 1건이 TIMEOUT_SEC 를 넘지 않게 한 마감 시각을 공유한다.
누수 방지: 성공 변환이 SOFFICE_RESTART_EVERY 건 쌓이면 다음 변환 전에 재기동한다.
"""
import logging
import os
import signal
import socket
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Literal

from .. import config
from ..errors import ConvertError, convert_failed, unavailable
from . import proc

log = logging.getLogger(__name__)

# 시스템 파이썬으로 실행할 헬퍼 스크립트 절대경로(app 패키지 바로 아래)
HELPER = Path(__file__).resolve().parent.parent / "uno_helper.py"
# soffice 가 UNO 소켓을 열 때까지 기다리는 최대 시간(초)
START_WAIT_SEC = 20
# 헬퍼 종료코드 — 2: 문서 로드·변환 실패(입력 문제), 3: soffice 연결 실패(인프라). uno_helper.py 와 맞춘다.
HELPER_RC_BAD_INPUT = 2
# stop() 이 이전 soffice.bin 의 UNO 포트가 닫힐 때까지 기다리는 최대 시간(초)
STOP_WAIT_SEC = 5
# 기동 뒤 남은 시간이 이보다 적으면 헬퍼를 띄워 봐야 타임아웃이 뻔하므로 503 으로 끝낸다
MIN_HELPER_SEC = 1.0


def _port_open(port: int) -> bool:
    """루프백 포트에 TCP 접속이 되는지(= soffice 가 --accept 소켓을 열었는지)."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


class Office:
    """상주 soffice 프로세스 하나와 그 변환 슬롯(동시 1건)을 관리한다."""

    def __init__(self) -> None:
        # 변환 슬롯이자 start/stop 직렬화 락. 변환 중 재기동이 끼어들지 않게 같은 락을 쓴다.
        self._lock = threading.Lock()
        self._proc: subprocess.Popen | None = None
        # 마지막 기동 이후 성공 변환 수 — RESTART_EVERY 도달 시 재기동
        self._done = 0

    @property
    def _running(self) -> bool:
        """기동 성공 여부 = 프로세스를 쥐고 있는지. start 는 소켓이 열려야 _proc 를 남기고 실패하면 stop 으로 비운다.

        기동 실패(개발 호스트에 soffice 없음 등)면 False — 다음 변환 때 다시 기동한다.
        """
        return self._proc is not None

    def busy(self) -> bool:
        """변환 중(락 점유)인지 — 본문을 받기 전에 429 를 미리 판정하는 값싼 확인. 최종 판정은 convert 의 락 획득."""
        return self._lock.locked()

    # ---- 프로세스 수명 ----

    def start(self, wait: float = START_WAIT_SEC) -> None:
        """soffice 를 headless 로 띄우고 UNO 소켓이 열릴 때까지 최대 wait 초 기다린다. 실패 시 503 UNAVAILABLE.

        기동 완료는 '포트가 열림'으로 판정하므로, 띄우기 전에 포트가 이미 열려 있으면(이전 인스턴스가 아직 안 죽음·
        다른 프로세스가 점유) 그 소켓을 우리 soffice 로 착각하게 된다 — 그때는 띄우지 않고 503 으로 끝낸다.
        """
        self.stop()
        port = config.SOFFICE_PORT
        if _port_open(port):
            log.warning("soffice 기동 전 포트 %d 가 이미 열려 있음 — 기동 판정을 믿을 수 없어 중단", port)
            raise unavailable()
        cmd = [config.SOFFICE_BIN, "--headless", "--invisible", "--nologo", "--norestore", "--nodefault",
               f"--accept=socket,host=127.0.0.1,port={port};urp;",
               f"-env:UserInstallation=file://{config.tmp_root()}/lo-profile"]
        try:
            # 새 세션으로 띄워 프로세스 그룹째 죽일 수 있게 한다(soffice 래퍼 → oosplash → soffice.bin 자식 체인)
            self._proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                          stderr=subprocess.DEVNULL, start_new_session=True)
        except OSError as e:
            log.warning("soffice 기동 실패 bin=%s err=%s", config.SOFFICE_BIN, e)
            raise unavailable() from e

        deadline = time.monotonic() + wait
        while time.monotonic() < deadline:
            if _port_open(port):
                self._done = 0
                log.info("soffice 기동 완료 port=%d pid=%d", port, self._proc.pid)
                return
            if self._proc.poll() is not None:
                break  # 소켓을 열기 전에 죽음 — 더 기다릴 필요 없음
            time.sleep(0.2)
        log.warning("soffice 가 %.1fs 안에 포트 %d 를 열지 못함", wait, port)
        self.stop()
        raise unavailable()

    def stop(self) -> None:
        """soffice 프로세스 그룹을 강제 종료한다. 이미 꺼져 있으면 아무 것도 안 한다."""
        p, self._proc = self._proc, None
        if p is None:
            return
        try:
            # 멈춘 soffice 는 정상 종료 요청에 응답하지 않을 수 있으므로 그룹 전체를 SIGKILL.
            # 래퍼가 이미 끝났어도 그룹에 soffice.bin 이 남아 포트를 쥐고 있을 수 있으므로 래퍼 생존과 무관하게 보낸다.
            os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            log.warning("soffice 종료 대기 시간 초과 pid=%d", p.pid)
        # p.wait 는 래퍼(그룹 리더)만 기다린다. SIGKILL 받은 soffice.bin 은 그 뒤에도 잠깐 UNO 포트를 쥐고 있어서,
        # 바로 이어지는 start() 가 죽어 가는 이전 인스턴스의 포트를 보고 '기동 완료'로 착각하고 헬퍼가 거기 붙어
        # 실패(rc 3·SIGSEGV)하거나 _alive() 가 거짓이 되어 또 재기동된다. 포트가 실제로 닫힐 때까지 기다린다.
        deadline = time.monotonic() + STOP_WAIT_SEC
        while _port_open(config.SOFFICE_PORT):
            if time.monotonic() >= deadline:
                log.warning("soffice 종료 후 %.1fs 지나도 포트 %d 가 열려 있음", STOP_WAIT_SEC, config.SOFFICE_PORT)
                break
            time.sleep(0.02)

    def _alive(self) -> bool:
        """soffice 가 살아서 UNO 소켓을 받고 있는지. 래퍼(oosplash)만 살고 soffice.bin 이 죽은 경우도 포트로 잡는다."""
        return self._proc is not None and self._proc.poll() is None and _port_open(config.SOFFICE_PORT)

    def health(self) -> bool:
        """readiness 판정. 변환 중(락 점유)이면 살아 있는 것으로 보고, 아니면 생존 확인 후 죽어 있으면 재기동을 시도한다.

        변환은 돌리지 않는다(프로세스·포트 확인만). 재기동은 최대 START_WAIT_SEC 걸릴 수 있다.
        """
        if not self._lock.acquire(blocking=False):
            return True
        try:
            if self._alive():
                return True
            try:
                self.start()
                return True
            except ConvertError:
                return False
        finally:
            self._lock.release()

    # ---- 변환 ----

    def convert(self, data: bytes | bytearray, suffix: str, target: Literal["pdf", "txt"],
                filter_name: str | None = None) -> bytes:
        """원본 바이트(suffix 는 형식 판별용 확장자, 예 '.pptx')를 target 형식 바이트로 변환한다.

        filter_name: LibreOffice 가져오기 필터 이름(예 'MS Word 97'). 주면 내용 자동 판별을 쓰지 않고 그 필터로만
        연다 — 확장자만 바꾼 파일(평문을 .pptx 로 저장 등)이 다른 형식으로 열려 '성공'하지 않고 422 가 되게.
        """
        if not self._lock.acquire(blocking=False):
            raise ConvertError(429, "BUSY")
        try:
            # 지연 기동 + 헬퍼를 합친 요청 전체 마감 — 둘이 각자 시간을 쓰면 TIMEOUT_SEC 를 넘길 수 있다.
            # 기동이 예산을 다 쓰면 503(헬퍼를 띄우면 타임아웃이 뻔함 — soffice 는 살려 둔다), 헬퍼 자체 초과는 proc.run 의 504.
            deadline = proc.Deadline(config.TIMEOUT_SEC, on_expire=unavailable)
            # 누적 변환이 한도에 닿았으면 깨끗한 인스턴스로 바꾼 뒤 처리
            if self._running and self._done >= config.SOFFICE_RESTART_EVERY:
                log.info("soffice 정기 재기동 done=%d", self._done)
                self.stop()
            # 꺼져 있거나(기동 실패·직전 인프라 오류로 내림) 죽은 프로세스면 이번 요청을 헛되이 실패시키지 않게 먼저 띄운다
            if not self._alive():
                self.start(wait=min(START_WAIT_SEC, deadline.left()))
            left = deadline.remaining(min_left=MIN_HELPER_SEC)
            with tempfile.TemporaryDirectory(prefix="office-", dir=config.tmp_root()) as tmp:
                work = Path(tmp)
                src = work / f"input{suffix}"
                src.write_bytes(data)
                out = work / f"out.{target}"
                cmd = [config.UNO_PYTHON, str(HELPER), "--port", str(config.SOFFICE_PORT),
                       "--in", str(src), "--out", str(out), "--target", target]
                if filter_name:
                    cmd += ["--filter", filter_name]
                try:
                    proc.run(cmd, timeout=left, cwd=work, on_fail=self._helper_error)
                except ConvertError as e:
                    # 입력 문제(422)라도 soffice 가 그 사이 죽었으면 인프라 오류로 본다(변환 중 크래시 → 브리지 끊김 → rc 2)
                    if e.code == "CONVERT_FAILED" and not self._alive():
                        log.warning("변환 실패 후 soffice 사망 확인 — 인프라 오류로 처리")
                        self.stop()
                        raise unavailable() from e
                    if e.code in ("TIMEOUT", "UNAVAILABLE"):
                        # 멈춤·연결 실패 — soffice 상태를 믿을 수 없으니 내린다. 재기동은 다음 변환·/health 에서
                        self.stop()
                    raise
                if not out.is_file():
                    raise convert_failed()
                self._done += 1
                return out.read_bytes()
        finally:
            self._lock.release()

    @staticmethod
    def _helper_error(rc: int) -> ConvertError:
        """헬퍼 종료코드 → 오류. 2 만 입력 문제(422), 나머지(3=연결 실패·1=import 실패·음수=시그널)는 인프라 503."""
        return convert_failed() if rc == HELPER_RC_BAD_INPUT else unavailable()


# 프로세스 전역 싱글턴 — main 의 startup/shutdown 과 Office 엔진이 공유한다
OFFICE = Office()
