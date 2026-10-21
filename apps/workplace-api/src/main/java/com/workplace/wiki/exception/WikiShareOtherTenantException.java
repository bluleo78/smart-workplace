package com.workplace.wiki.exception;

/**
 * 지금 워크스페이스가 아닌 다른 워크스페이스의 공유 링크를, 그 워크스페이스의 ACTIVE 멤버가 열 때(409, WP-579). 링크의 워크스페이스를 알려 받는 화면이 자동
 * 전환하게 한다. 멤버가 아닌 사람에게는 던지지 않는다 — 링크가 어느 워크스페이스 것인지 드러내지 않으려고 404 로 끝낸다.
 */
public class WikiShareOtherTenantException extends RuntimeException {
  public static final String CODE = "WIKI_SHARE_OTHER_TENANT";

  private final long tenantId;

  public WikiShareOtherTenantException(long tenantId) {
    super("다른 워크스페이스의 공유 링크입니다");
    this.tenantId = tenantId;
  }

  public long tenantId() {
    return tenantId;
  }
}
