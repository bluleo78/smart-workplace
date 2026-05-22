package com.workplace.issue.exception;

/** 이슈 코멘트를 찾을 수 없을 때 발생. 404 매핑. */
public class IssueCommentNotFoundException extends RuntimeException {
  public IssueCommentNotFoundException(Long id) {
    super("코멘트를 찾을 수 없습니다: id=" + id);
  }
}
