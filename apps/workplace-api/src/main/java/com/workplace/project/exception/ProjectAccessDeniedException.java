package com.workplace.project.exception;

/** 프로젝트 접근 권한이 없을 때 발생 (멤버 아님, 역할 부족 등). 403 매핑. */
public class ProjectAccessDeniedException extends RuntimeException {
  public ProjectAccessDeniedException(String message) {
    super(message);
  }
}
