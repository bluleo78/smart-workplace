package com.workplace.issue.exception;

/** 이슈를 찾을 수 없을 때 발생. 404 매핑. */
public class IssueNotFoundException extends RuntimeException {

  /** projectKey + number 기준 메시지. */
  public IssueNotFoundException(String projectKey, int number) {
    super("이슈를 찾을 수 없습니다: " + projectKey + "#" + number);
  }

  /**
   * id 로 찾는 경로(이슈 코멘트 API)용 — 없는 이슈와 볼 수 없는 프로젝트의 이슈에 같이 쓴다(WP-588). 이슈 id 는 테넌트 전역 일련번호라 문구에 싣거나
   * 응답을 달리하면 볼 수 없는 프로젝트의 이슈 수·증가 시점이 드러난다.
   */
  public IssueNotFoundException() {
    super("이슈를 찾을 수 없습니다");
  }
}
