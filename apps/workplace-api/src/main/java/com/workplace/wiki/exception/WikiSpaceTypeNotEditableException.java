package com.workplace.wiki.exception;

/** 개인(PERSONAL) 노트 공간의 멤버 추가·역할 변경·제거 시도 — TEAM 공간만 허용(WP-495). HTTP 409. */
public class WikiSpaceTypeNotEditableException extends RuntimeException {
  public WikiSpaceTypeNotEditableException(long spaceId, String type) {
    // 문구에 id·영문 값을 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-672, WP-619 후속)
    super("팀 공간만 멤버를 바꿀 수 있습니다");
  }
}
