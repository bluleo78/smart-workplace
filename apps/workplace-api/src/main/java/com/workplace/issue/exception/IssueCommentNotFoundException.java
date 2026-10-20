package com.workplace.issue.exception;

/** 이슈 코멘트를 찾을 수 없을 때 발생. 404 매핑. */
public class IssueCommentNotFoundException extends RuntimeException {
  public IssueCommentNotFoundException(Long id) {
    // 문구에 id 를 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-619)
    super("코멘트를 찾을 수 없습니다");
  }
}
