"""변환 오류 모델. 엔진은 이 예외 하나로 실패를 알리고, main 이 HTTP 응답으로 바꾼다."""


class ConvertError(Exception):
    """엔진이 던지는 단일 예외 — status 는 HTTP 상태, code 는 응답 본문 `{"detail": {"code": ...}}` 값.

    예: ConvertError(429, "BUSY"), ConvertError(504, "TIMEOUT"), convert_failed()(422), unavailable()(503).
    """

    def __init__(self, status: int, code: str):
        super().__init__(f"{status} {code}")
        self.status = status
        self.code = code


def convert_failed() -> ConvertError:
    """입력 탓 변환 불가(손상 파일·0쪽 결과·형식 불일치 등) — 같은 입력으로 재시도해도 소용없다."""
    return ConvertError(422, "CONVERT_FAILED")


def unavailable() -> ConvertError:
    """일시적 인프라 오류(soffice 기동·연결 실패 등) — 입력 탓이 아니므로 호출자가 나중에 재시도할 수 있다."""
    return ConvertError(503, "UNAVAILABLE")
