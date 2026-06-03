package com.workplace.contacts.repository;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * 통합 디렉토리 키셋 커서: (name, type, id) 튜플을 base64url 로 인코딩. name 은 임의 텍스트라 Postgres 가 저장 못하는
 * NUL('\u0000') 을 구분자로 써 충돌을 막는다. SEP 는 반드시 escape 리터럴로 둘 것 — 가시문자로 바꾸면 공백 포함 name 에서 split 이 깨진다.
 */
public final class ContactCursorCodec {
  // NUL(U+0000) 구분자 — Postgres text 가 저장 못하는 문자.
  private static final char SEP = '\u0000';

  private ContactCursorCodec() {}

  public static String encode(String name, String type, long id) {
    String raw = name + SEP + type + SEP + id;
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
  }

  /** 디코드 실패/공백/형식오류 시 null. */
  public static Decoded decode(String cursor) {
    if (cursor == null || cursor.isBlank()) return null;
    try {
      String raw = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
      String[] parts = raw.split(String.valueOf(SEP), -1);
      if (parts.length != 3) return null;
      return new Decoded(parts[0], parts[1], Long.parseLong(parts[2]));
    } catch (RuntimeException e) {
      return null;
    }
  }

  public record Decoded(String name, String type, long id) {}
}
