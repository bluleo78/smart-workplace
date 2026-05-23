package com.workplace.issue.exception;

/** 이슈당 첨부 개수 한도(10개)를 초과한 경우 — HTTP 409 매핑. */
public class AttachmentLimitExceededException extends RuntimeException {

  /** 현재 + 신규 + 한도 모두 메시지에 포함. */
  public AttachmentLimitExceededException(int current, int adding, int max) {
    super("이슈당 첨부 한도(" + max + "개)를 초과합니다: 현재 " + current + " + 신규 " + adding);
  }
}
