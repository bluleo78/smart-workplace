package com.workplace.calendar.exception;

/**
 * 로컬 일정을 Outlook(외부 쓰기) 캘린더로 옮길 수 없는 경우 — 시도 시 422(WP-2155).
 *
 * <p>이동은 Graph 에 새 일정을 만드는 전환이라, 참석자(초대 메일이 나가거나 응답 상태가 어긋남)나 반복 규칙(Graph 반복 모델 변환 범위 밖)이 있는 일정은
 * 조용히 변환하지 않고 사유를 알려 거절한다.
 */
public class LocalToExternalMoveNotSupportedException extends RuntimeException {
  private LocalToExternalMoveNotSupportedException(String message) {
    super(message);
  }

  /** 참석자가 있는 일정. */
  public static LocalToExternalMoveNotSupportedException withAttendees() {
    return new LocalToExternalMoveNotSupportedException(
        "참석자가 있는 일정은 Outlook 캘린더로 옮길 수 없습니다. Outlook 에서 새로 만들어 초대해 주세요.");
  }

  /** 반복 일정. */
  public static LocalToExternalMoveNotSupportedException recurring() {
    return new LocalToExternalMoveNotSupportedException("반복 일정은 Outlook 캘린더로 옮길 수 없습니다.");
  }
}
