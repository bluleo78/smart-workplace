package com.workplace.wiki.exception;

/** 팀 노트 공간의 마지막 OWNER 를 제거·강등하려 함 — 관리자 없는 공간이 남는다(WP-496). HTTP 409. */
public class WikiLastOwnerException extends RuntimeException {
  public WikiLastOwnerException(long spaceId) {
    super("공간에는 OWNER 가 한 명 이상 있어야 합니다. 다른 멤버를 OWNER 로 지정한 뒤 다시 시도하세요 (spaceId: " + spaceId + ")");
  }
}
