package com.workplace.home.repository;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;

/** 키셋 페이지네이션 커서 인코딩: (createdAt, id) 튜플을 base64 문자열로. id 는 bigint/uuid 공용 String. */
public final class CursorCodec {
  private CursorCodec() {}

  public static String encode(Instant createdAt, String id) {
    String raw = createdAt.toEpochMilli() + ":" + id;
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
  }

  /** 디코드 실패/공백 시 null. */
  public static Decoded decode(String cursor) {
    if (cursor == null || cursor.isBlank()) return null;
    try {
      String raw = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
      int i = raw.indexOf(':');
      if (i < 0) return null;
      return new Decoded(
          Instant.ofEpochMilli(Long.parseLong(raw.substring(0, i))), raw.substring(i + 1));
    } catch (RuntimeException e) {
      return null;
    }
  }

  public record Decoded(Instant createdAt, String id) {}
}
