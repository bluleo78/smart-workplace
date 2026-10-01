package com.workplace.mail.util;

import com.workplace.mail.dto.ContentSource;
import com.workplace.mail.dto.ParsedMessage;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Locale;

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
    return sha256Hex(norm);
  }

  /**
   * content 공유 지문(WP-130). 같은 테넌트에서 Message-ID 와 이 지문이 모두 같을 때만 content 를 공유한다.
   *
   * <p>재료: 수신 경로 · 발신자(소문자) · Date(초 단위) · 제목 · [IMAP] BODYSTRUCTURE 요약. 모두 본문 다운로드 전(동기화 시점)에 알 수
   * 있는 값이다. Message-ID 만 맞춘 위조 메일은 발신자·Date·제목·파트 구성/크기까지 원본과 같아야 공유되므로 사실상 차단된다.
   *
   * @return lowercase hex SHA-256. IMAP 인데 structure 가 없으면(요약 실패) null — 호출자는 공유하지
   *     않는다(fail-closed).
   */
  public static String fingerprint(ContentSource source, ParsedMessage m) {
    if (source == ContentSource.IMAP && m.structure() == null) {
      return null;
    }
    // 구분자는 헤더 값에 나올 수 없는 NUL 문자 — 필드 경계 모호성(예: 제목 끝과 structure 시작) 제거
    String norm =
        String.join(
            "\u0000",
            source.name(),
            m.fromAddress() == null ? "" : m.fromAddress().trim().toLowerCase(Locale.ROOT),
            m.sentAt() == null ? "" : Long.toString(m.sentAt().getEpochSecond()),
            m.subject() == null ? "" : m.subject(),
            m.structure() == null ? "" : m.structure());
    return sha256Hex(norm);
  }

  private static String sha256Hex(String s) {
    try {
      byte[] digest =
          MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
      // HexFormat.of().formatHex → lowercase hex — Postgres encode(...,'hex') 와 일치
      return HexFormat.of().formatHex(digest);
    } catch (Exception e) {
      throw new IllegalStateException("SHA-256 미지원 환경", e);
    }
  }
}
