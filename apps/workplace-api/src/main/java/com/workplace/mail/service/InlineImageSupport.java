package com.workplace.mail.service;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * 메일 인라인 이미지(cid:) 판정 공용 규칙(WP-68/69). IMAP·Graph 적재, 열람 시 백필 판정, 발송 검증이 같은 규칙을 쓰도록 한 곳에 둔다 — 저장된
 * Content-ID 표기가 공급자마다 달라지면 프론트의 cid → 첨부 매칭이 조용히 깨진다.
 */
public final class InlineImageSupport {

  /** 본문 cid: 참조 탐지 — HTML 전체를 소문자로 복사하지 않도록 대소문자 무시 정규식으로 찾는다. */
  private static final Pattern CID_REF = Pattern.compile("cid:", Pattern.CASE_INSENSITIVE);

  private InlineImageSupport() {}

  /**
   * Content-ID 저장 표기 — 꺾쇠 제거 + trim, 빈 값은 null. Message-ID 정규화(바깥 꺾쇠만 제거)와 달리 값 안의 꺾쇠까지 제거한다 — 헤더
   * 파서가 {@code <<id>>} 같은 비표준 표기를 그대로 넘기는 경우를 흡수하기 위함.
   */
  public static String normalizeContentId(String raw) {
    if (raw == null) {
      return null;
    }
    String v = raw.replaceAll("[<>]", "").trim();
    return v.isEmpty() ? null : v;
  }

  /** 본문 HTML 이 cid: 를 참조하는지. */
  public static boolean refsCid(String html) {
    return html != null && CID_REF.matcher(html).find();
  }

  /** image/* MIME 타입인지(null 안전·대소문자 무시). */
  public static boolean isImage(String contentType) {
    return contentType != null && contentType.toLowerCase(Locale.ROOT).startsWith("image/");
  }
}
