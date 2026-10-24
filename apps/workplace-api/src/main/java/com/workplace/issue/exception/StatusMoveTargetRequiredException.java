package com.workplace.issue.exception;

/** 활성 이슈가 있는 상태를 옮길 상태(moveTo) 없이 지우려 함 — 400 (WP-809). 이슈를 어디로 보낼지는 사용자가 골라야 한다. */
public class StatusMoveTargetRequiredException extends RuntimeException {
  public StatusMoveTargetRequiredException() {
    super("옮길 상태를 골라 주세요");
  }
}
