package com.workplace.home.repository;

import com.workplace.global.time.CursorInstants;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.function.Function;
import java.util.function.ToLongFunction;

/**
 * 키셋 페이지네이션 커서 인코딩: (createdAt, id) 튜플을 base64 문자열로. id 는 bigint/uuid 공용 String.
 *
 * <p>시각은 마이크로초까지 담는다(WP-1618, 이유·구 커서 호환은 {@link CursorInstants}).
 */
public final class CursorCodec {
  private CursorCodec() {}

  public static String encode(Instant createdAt, String id) {
    String raw = createdAt + ":" + id;
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
  }

  /** 디코드 실패/공백/범위 밖 시각이면 null(첫 페이지). 시각에 콜론이 들어 있어 마지막 콜론으로 가른다(id 는 숫자·UUID 라 콜론이 없다). */
  public static Decoded decode(String cursor) {
    if (cursor == null || cursor.isBlank()) return null;
    try {
      String raw = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
      int i = raw.lastIndexOf(':');
      if (i < 0) return null;
      return new Decoded(CursorInstants.parse(raw.substring(0, i)), raw.substring(i + 1));
    } catch (RuntimeException e) {
      return null;
    }
  }

  /** 키셋 한 묶음 — items 는 최대 size 건, next 는 더 있을 때만 마지막 건의 커서(없으면 null). */
  public record Slice<T>(List<T> items, String next) {}

  /**
   * size+1 건을 읽어 온 결과를 한 묶음으로 자른다 — 더 있으면 마지막 건의 (시각, id) 로 다음 커서를 만든다. 공용 메모리 목록·공간 기록이 같은 모양을 쓴다.
   */
  public static <T> Slice<T> slice(
      List<T> fetched, int size, Function<T, Instant> at, ToLongFunction<T> id) {
    boolean more = fetched.size() > size;
    List<T> items = more ? fetched.subList(0, size) : fetched;
    String next = null;
    if (more) {
      T last = items.get(items.size() - 1);
      next = encode(at.apply(last), String.valueOf(id.applyAsLong(last)));
    }
    return new Slice<>(items, next);
  }

  public record Decoded(Instant createdAt, String id) {

    /** id 를 bigint 로 — 숫자가 아니면(세션 UUID 커서 등) null 이라 호출자가 커서를 무시(첫 페이지)한다(500 방어). */
    public Long longId() {
      try {
        return Long.parseLong(id);
      } catch (NumberFormatException e) {
        return null;
      }
    }
  }
}
