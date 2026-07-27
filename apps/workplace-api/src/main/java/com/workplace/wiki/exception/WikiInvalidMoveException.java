package com.workplace.wiki.exception;

/**
 * #758 트리 이동 요청 자체가 성립하지 않을 때 — 자기 자신/후손을 부모로 지정, 다른 공간의 페이지를 부모로 지정, 존재하지 않는 부모.
 *
 * <p>버전 경합(409, {@link WikiConflictException})이 아니라 요청이 잘못된 것이므로 400 으로 매핑한다.
 */
public class WikiInvalidMoveException extends RuntimeException {
  public WikiInvalidMoveException(String message) {
    super(message);
  }
}
