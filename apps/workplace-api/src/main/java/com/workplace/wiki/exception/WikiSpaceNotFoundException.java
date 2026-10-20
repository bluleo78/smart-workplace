package com.workplace.wiki.exception;

public class WikiSpaceNotFoundException extends RuntimeException {
  public WikiSpaceNotFoundException(long spaceId) {
    // 문구에 id 를 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-619)
    super("위키 공간을 찾을 수 없습니다");
  }
}
