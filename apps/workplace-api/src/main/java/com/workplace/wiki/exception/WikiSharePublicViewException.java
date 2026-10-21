package com.workplace.wiki.exception;

/**
 * 다른 워크스페이스에 로그인한 사람이, 그 링크의 워크스페이스 멤버가 아닌데 외부(PUBLIC) 링크를 열 때(409, WP-579). 설계 「멤버가 아니면 외부 링크는 외부
 * 보기」에 따라 받는 화면이 비로그인과 같은 외부 보기를 그리게 한다. 외부 보기는 누구나 볼 수 있는 화면이라 이 응답이 더 드러내는 것은 없다 — 링크의
 * 워크스페이스(tenantId)는 싣지 않는다. 외부 공유 꺼짐·만료면 던지지 않고 404 로 끝낸다.
 */
public class WikiSharePublicViewException extends RuntimeException {
  public static final String CODE = "WIKI_SHARE_PUBLIC";

  public WikiSharePublicViewException() {
    super("외부 보기로 여는 공유 링크입니다");
  }
}
