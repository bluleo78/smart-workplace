package com.workplace.calendar.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * 앱에서 태그를 바꿀 수 없는 외부(M365) 일정에 태그 붙이기 시도 — 409(WP-714·716). M365 일정의 태그는 그 사서함의 Outlook 범주라 앱에서 바꾸면
 * Graph 로 써 넣는데(WP-716), 내 사서함의 쓸 수 있는 달력 사본이 아니면(동료가 공유한 읽기 전용 달력·공휴일, 초대받아 보는 남의 사본, 끊긴 계정) 써 넣을
 * 수 없다.
 */
@ResponseStatus(HttpStatus.CONFLICT)
public class ExternalEventTagNotSupportedException extends RuntimeException {
  public ExternalEventTagNotSupportedException() {
    super("이 Outlook 일정의 태그는 Outlook 범주에서 바꿀 수 있습니다");
  }
}
