package com.workplace.issue.dto;

import com.workplace.issue.exception.InvalidCursorException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;

/** updated_at + id 복합키를 base64url 로 인코딩한 검색 cursor. */
public record IssueCursor(Instant updatedAt, Long id) {

  /** Instant 밀리초 epoch + ":" + id 를 base64url 로 직렬화. */
  public static String encode(Instant updatedAt, Long id) {
    String raw = updatedAt.toEpochMilli() + ":" + id;
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
  }

  /** 잘못된 입력은 InvalidCursorException. */
  public static IssueCursor decode(String cursor) {
    try {
      byte[] decoded = Base64.getUrlDecoder().decode(cursor);
      String raw = new String(decoded, StandardCharsets.UTF_8);
      int colon = raw.indexOf(':');
      if (colon <= 0) {
        throw new InvalidCursorException("cursor 형식 오류");
      }
      long millis = Long.parseLong(raw.substring(0, colon));
      long id = Long.parseLong(raw.substring(colon + 1));
      return new IssueCursor(Instant.ofEpochMilli(millis), id);
    } catch (InvalidCursorException e) {
      throw e;
    } catch (Exception e) {
      throw new InvalidCursorException("cursor 디코딩 실패");
    }
  }
}
