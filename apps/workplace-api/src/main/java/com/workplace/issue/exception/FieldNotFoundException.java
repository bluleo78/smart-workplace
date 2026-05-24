package com.workplace.issue.exception;

/** 프로젝트 custom field 정의를 찾을 수 없을 때. → 404. */
public class FieldNotFoundException extends RuntimeException {
  public FieldNotFoundException(Long id) {
    super("필드를 찾을 수 없습니다: id=" + id);
  }
}
