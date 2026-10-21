package com.workplace.wiki.exception;

/** 팀 노트 공간의 마지막 OWNER 를 제거·강등하려 함 — 관리자 없는 공간이 남는다(WP-496). HTTP 409. */
public class WikiLastOwnerException extends RuntimeException {
  public WikiLastOwnerException(long spaceId) {
    // 문구에 id·영문 값을 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-672, WP-619 후속)
    super("공간에는 소유자가 한 명 이상 있어야 합니다. 다른 멤버를 소유자로 지정한 뒤 다시 시도하세요");
  }
}
