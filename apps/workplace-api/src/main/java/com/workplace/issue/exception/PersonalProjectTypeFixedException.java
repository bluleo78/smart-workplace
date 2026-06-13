package com.workplace.issue.exception;

/** 개인 프로젝트의 이슈는 TASK 유형만 허용 — 비TASK 유형으로 변경/지정 시 400. */
public class PersonalProjectTypeFixedException extends RuntimeException {
  public PersonalProjectTypeFixedException() {
    super("개인 프로젝트의 이슈는 태스크 유형만 사용할 수 있습니다");
  }
}
