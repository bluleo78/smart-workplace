package com.workplace.wiki.exception;

/** 개인(PERSONAL) 노트 공간의 멤버 추가·역할 변경·제거 시도 — TEAM 공간만 허용(WP-495). HTTP 409. */
public class WikiSpaceTypeNotEditableException extends RuntimeException {
  public WikiSpaceTypeNotEditableException(long spaceId, String type) {
    super("팀 공간만 멤버를 바꿀 수 있습니다 (spaceId: " + spaceId + ", type: " + type + ")");
  }
}
