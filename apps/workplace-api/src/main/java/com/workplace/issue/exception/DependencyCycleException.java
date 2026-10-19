package com.workplace.issue.exception;

/** 의존성 추가가 사이클을 유발하는 경우 — 409. */
public class DependencyCycleException extends RuntimeException {
  public DependencyCycleException() {
    super("서로를 기다리는 순환 관계가 생겨 연결할 수 없습니다");
  }
}
