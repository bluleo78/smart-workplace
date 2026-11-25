package com.workplace.issue.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * WP-2113: version 없이 제목·본문을 바꾸려는 요청 → 409. 남이 먼저 저장한 글을 알림·기록 없이 덮지 않기 위해 막는다
 * (IssueConflictException 이 "남이 먼저 고침"을 알리는 것과 달리 여기는 "version 이 없다"를 알린다). 호출자는 이슈 상세에서 version 을
 * 읽어 다시 보낸다.
 */
@ResponseStatus(HttpStatus.CONFLICT)
public class IssueTextWriteRequiresVersionException extends RuntimeException {
  public IssueTextWriteRequiresVersionException(String issueKey) {
    super("제목·본문을 고치려면 version 을 함께 싣어 주세요: " + issueKey);
  }
}
