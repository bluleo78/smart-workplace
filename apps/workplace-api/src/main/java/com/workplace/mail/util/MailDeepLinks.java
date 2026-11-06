// MailDeepLinks.java — 메일 화면 딥링크 경로(WP-1392)
package com.workplace.mail.util;

/**
 * 웹 메일 화면으로 가는 앱 내부 경로. 홈 우선순위(회신 필요)·드라이브 「첨부 모아보기」의 메일 첨부가 같은 형식을 쓰도록 한 곳에 둔다 — 웹 라우트 {@code
 * /mail/:accountId?messageId=} 와 짝이라 한쪽만 바꾸면 링크가 메일을 열지 못한다.
 */
public final class MailDeepLinks {

  private MailDeepLinks() {}

  /** 계정 accountId 의 메일함에서 메일 messageId 를 연 화면. */
  public static String message(long accountId, long messageId) {
    return "/mail/" + accountId + "?messageId=" + messageId;
  }
}
