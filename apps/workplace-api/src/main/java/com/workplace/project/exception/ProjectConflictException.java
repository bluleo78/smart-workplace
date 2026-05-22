package com.workplace.project.exception;

/** 프로젝트/멤버 관련 상태 충돌 (key 중복, OWNER 최소 1명 위반 등). 409 매핑. */
public class ProjectConflictException extends RuntimeException {
  public ProjectConflictException(String message) {
    super(message);
  }
}
