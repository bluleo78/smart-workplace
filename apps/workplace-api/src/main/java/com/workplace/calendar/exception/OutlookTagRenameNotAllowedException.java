package com.workplace.calendar.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * Outlook 범주에서 온 태그의 이름 바꾸기 시도(WP-714 리뷰) — 409. 동기화는 범주 이름으로 태그를 찾으므로 앱에서 이름을 바꾸면 다음 동기화가 옛 이름의
 * 태그를 새로 만들고 바뀐 태그의 Outlook 연결을 모두 떼어 태그가 둘로 갈라진다. 색은 범주와 무관해 바꿀 수 있다.
 */
@ResponseStatus(HttpStatus.CONFLICT)
public class OutlookTagRenameNotAllowedException extends RuntimeException {
  public OutlookTagRenameNotAllowedException() {
    super("Outlook 범주에서 온 태그라 이름은 Outlook에서 바꿔 주세요");
  }
}
