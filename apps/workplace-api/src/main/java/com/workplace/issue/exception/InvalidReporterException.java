package com.workplace.issue.exception;

/** 보고자로 지정할 수 없는 사용자(WP-944) — AI 구성원, 비활성·정지, 프로젝트를 볼 수 없는 사람. 담당자 지정 거절과 같은 400 매핑을 쓴다(상속). */
public class InvalidReporterException extends InvalidAssigneeForProjectException {
  public InvalidReporterException(String message) {
    super(message);
  }
}
