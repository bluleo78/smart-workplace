package com.workplace.issue.exception;

/** 이슈를 찾을 수 없을 때 발생. 404 매핑. */
public class IssueNotFoundException extends RuntimeException {

  /** projectKey + number 기준 메시지. */
  public IssueNotFoundException(String projectKey, int number) {
    super("이슈를 찾을 수 없습니다: " + projectKey + "#" + number);
  }

  /** id 기준 메시지. */
  public IssueNotFoundException(Long id) {
    super("이슈를 찾을 수 없습니다: id=" + id);
  }
}
