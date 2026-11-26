package com.workplace.issue.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * WP-2113: version 없이 제목·본문을 바꾸려는 요청 → 409. 남이 먼저 저장한 글을 알림·기록 없이 덮지 않기 위해 막는다
 * (IssueConflictException 이 "남이 먼저 고침"을 알리는 것과 달리 여기는 "version 이 없다"를 알린다). 호출자는 이슈 상세에서 version 을
 * 읽어 다시 보낸다.
 *
 * <p>메시지는 사람이 화면에서 보는 문구라 내부 필드명(version) 대신 쓰는 말로 적는다(MCP `update_issue` 는 도구 설명에 version 입력 흐름을
 * 적어 두었다).
 */
@ResponseStatus(HttpStatus.CONFLICT)
public class IssueTextWriteRequiresVersionException extends RuntimeException {
  public IssueTextWriteRequiresVersionException(String issueKey) {
    super("제목·본문을 고치려면 이슈의 최신 내용을 다시 확인해 주세요: " + issueKey);
  }
}
