package com.workplace.wiki.exception;

/**
 * 공간 멤버가 아닌 사용자의 역할을 바꾸려 함 — 바뀐 것이 없는데 성공으로 응답하지 않게 404 로 거절한다(WP-667, 프로젝트 멤버 역할 변경과 같은 응답). 문구에
 * 내부 id 를 넣지 않는다.
 */
public class WikiSpaceMemberNotFoundException extends RuntimeException {
  public WikiSpaceMemberNotFoundException() {
    super("이 공간의 멤버가 아닙니다. 먼저 멤버로 추가하세요.");
  }
}
