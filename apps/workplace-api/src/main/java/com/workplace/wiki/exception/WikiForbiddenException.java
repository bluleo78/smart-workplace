package com.workplace.wiki.exception;

/**
 * 노트(위키) 공간에서 요구 역할이 모자랄 때(403). 문구는 화면 토스트에 그대로 뜨므로 공간·사용자 id 를 싣지 않는다(WP-602) — 인자는 호출부 호환을 위해
 * 받기만 한다.
 */
public class WikiForbiddenException extends RuntimeException {
  public WikiForbiddenException(long spaceId, long userId) {
    super("이 노트 공간에서 이 작업을 할 권한이 없습니다");
  }
}
