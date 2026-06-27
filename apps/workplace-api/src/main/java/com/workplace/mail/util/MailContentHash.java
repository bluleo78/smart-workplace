package com.workplace.mail.util;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

/**
 * 메일 본문 정규화 SHA-256 해시 유틸.
 *
 * <p>body_text 와 body_html 을 {@code \000} (백슬래시+"000", 4글자) 구분자로 연결한 뒤 SHA-256 다이제스트를 lowercase hex
 * 로 반환한다. 구분자는 V93 백필 마이그레이션의 {@code E'\\000'} 와 동일 — Postgres 의 {@code E'\\000'} 는 NUL 바이트가 아니라
 * 리터럴 문자열 {@code \000} 4자이므로 주의.
 *
 * <p>Java 문자열 {@code "\\000"} = 리터럴 {@code \000}(4자) = Postgres {@code E'\\000'} — 상호 일관성 보장.
 */
public final class MailContentHash {

  private MailContentHash() {}

  /**
   * body_text·body_html 로부터 콘텐츠 해시를 계산한다. null 은 빈 문자열로 정규화.
   *
   * @param bodyText 평문 본문 (nullable)
   * @param bodyHtml HTML 본문 (nullable)
   * @return lowercase hex SHA-256, 64글자
   */
  public static String of(String bodyText, String bodyHtml) {
    // V93 백필과 동일: coalesce(body_text,'') || E'\\000' || coalesce(body_html,'')
    // Java "\\000" = 리터럴 \000(4자) ↔ Postgres E'\\000'(4자) — 동일 바이트 시퀀스
    String norm = (bodyText == null ? "" : bodyText) + "\\000" + (bodyHtml == null ? "" : bodyHtml);
    try {
      byte[] digest =
          MessageDigest.getInstance("SHA-256").digest(norm.getBytes(StandardCharsets.UTF_8));
      // HexFormat.of().formatHex → lowercase hex — Postgres encode(...,'hex') 와 일치
      return HexFormat.of().formatHex(digest);
    } catch (Exception e) {
      throw new IllegalStateException("SHA-256 미지원 환경", e);
    }
  }
}
