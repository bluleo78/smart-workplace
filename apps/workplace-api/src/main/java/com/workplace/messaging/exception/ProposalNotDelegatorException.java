package com.workplace.messaging.exception;

/** 제안 승인/거부는 위임자(제안 대상)만 가능 — 다른 사용자 시도 시 403. */
public class ProposalNotDelegatorException extends RuntimeException {
  public ProposalNotDelegatorException() {
    super("이 제안을 승인/거부할 권한이 없습니다");
  }
}
