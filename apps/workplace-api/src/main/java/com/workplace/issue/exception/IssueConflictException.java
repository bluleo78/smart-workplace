package com.workplace.issue.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * #611 이슈를 읽은 뒤 다른 편집이 먼저 반영됨 → 409. 클라이언트가 보낸 version 이 현재 version 과 다를 때 던진다(wiki 의
 * WikiConflictException 과 같은 규칙). 호출자는 최신 이슈를 다시 불러와 재시도한다.
 */
@ResponseStatus(HttpStatus.CONFLICT)
public class IssueConflictException extends RuntimeException {
  public IssueConflictException(String issueKey) {
    super("다른 사용자가 먼저 이 이슈를 수정했습니다. 최신 내용을 확인한 뒤 다시 시도해 주세요: " + issueKey);
  }
}
