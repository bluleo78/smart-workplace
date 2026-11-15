package com.workplace.issue.dto;

import com.workplace.global.time.CursorInstants;
import com.workplace.issue.exception.InvalidCursorException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;

/**
 * updated_at + id 복합키를 base64url 로 인코딩한 검색 cursor.
 *
 * <p>시각은 마이크로초까지 담는다(WP-1618, 이유·구 커서 호환은 {@link CursorInstants}).
 */
public record IssueCursor(Instant updatedAt, Long id) {

  /** {@code <ISO-8601 시각>:<id>} 를 base64url 로 직렬화. */
  public static String encode(Instant updatedAt, Long id) {
    String raw = updatedAt + ":" + id;
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
  }

  /** 잘못된 입력은 InvalidCursorException. 시각에 콜론이 들어 있어 마지막 콜론으로 가른다. */
  public static IssueCursor decode(String cursor) {
    try {
      byte[] decoded = Base64.getUrlDecoder().decode(cursor);
      String raw = new String(decoded, StandardCharsets.UTF_8);
      int colon = raw.lastIndexOf(':');
      if (colon <= 0) {
        throw new InvalidCursorException("cursor 형식 오류");
      }
      Instant at = CursorInstants.parse(raw.substring(0, colon));
      long id = Long.parseLong(raw.substring(colon + 1));
      return new IssueCursor(at, id);
    } catch (InvalidCursorException e) {
      throw e;
    } catch (Exception e) {
      throw new InvalidCursorException("cursor 디코딩 실패");
    }
  }
}
