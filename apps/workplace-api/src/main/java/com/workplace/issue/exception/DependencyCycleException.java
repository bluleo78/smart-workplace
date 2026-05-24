package com.workplace.issue.exception;

/** 의존성 추가가 사이클을 유발하는 경우 — 409. */
public class DependencyCycleException extends RuntimeException {
  public DependencyCycleException() {
    super("의존성 사이클이 발생합니다");
  }
}
