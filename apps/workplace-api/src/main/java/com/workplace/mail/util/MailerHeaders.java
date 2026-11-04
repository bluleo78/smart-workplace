package com.workplace.mail.util;

import java.util.List;

/** WP-1364: 받은 메일의 X-Mailer 헤더로 우리 앱(Gen:iA Works)이 보낸 메일인지 판정한다. */
public final class MailerHeaders {

  /** X-Mailer 의 제품 이름 — 보낼 때 `<이름> <버전>` 으로 붙이고(MailMimeBuilder), 받을 때 이 이름으로 가린다. */
  public static final String PRODUCT = "Gen:iA Works";

  private MailerHeaders() {}

  /**
   * X-Mailer 값 중 하나라도 앞뒤 공백을 뗀 뒤 {@link #PRODUCT} 이거나 `{@link #PRODUCT} ` (뒤에 버전)로 시작하면 true(대소문자
   * 구분). `Gen:iA WorksBot` 처럼 이름이 이어지는 값은 다른 제품이라 false. null·빈 목록은 false.
   */
  public static boolean isSentByGeniaWorks(List<String> xMailerValues) {
    if (xMailerValues == null) {
      return false;
    }
    return xMailerValues.stream().anyMatch(v -> v != null && isProduct(v.trim()));
  }

  private static boolean isProduct(String v) {
    return v.equals(PRODUCT) || v.startsWith(PRODUCT + " ");
  }
}
