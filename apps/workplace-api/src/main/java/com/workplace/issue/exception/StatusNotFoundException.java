package com.workplace.issue.exception;

/** 상태가 없거나 다른 프로젝트의 상태 — 404. 문구에 id 를 넣지 않는다(WP-619 와 같은 이유). */
public class StatusNotFoundException extends RuntimeException {
  public StatusNotFoundException() {
    super("상태를 찾을 수 없습니다");
  }
}
