package com.workplace.messaging.exception;

/** 위임자·AI 둘 다 멤버인 프로젝트가 없어 위임 불가 — 400. */
public class NoDelegationCandidateException extends RuntimeException {
  public NoDelegationCandidateException() {
    super("함께하는 프로젝트가 없어 위임받을 수 없습니다");
  }
}
