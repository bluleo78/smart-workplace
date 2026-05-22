package com.workplace.project.exception;

/** 프로젝트(또는 프로젝트 내 리소스)를 찾을 수 없을 때 발생. 404 매핑. */
public class ProjectNotFoundException extends RuntimeException {
  public ProjectNotFoundException(String message) {
    super(message);
  }
}
