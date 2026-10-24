package com.workplace.issue.exception;

/** 범주의 마지막 상태를 지우려 함 — 409 (WP-809). 범주마다 상태가 하나 이상 있어야 범주 기본 상태(범주로만 바꿀 때 들어가는 상태)가 있다. */
public class StatusLastInCategoryException extends RuntimeException {
  public StatusLastInCategoryException() {
    super("범주의 마지막 상태는 지울 수 없어요");
  }
}
