package com.workplace.issue.dto;

import com.workplace.issue.exception.InvalidCursorException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;

/**
 * AI 위임 작업 목록(WP-377)의 복합 커서 — 정렬 키 (급한 순위, 정렬 시각, 이슈 id) 를 그대로 담는다. 정렬이 rank ASC, sortAt DESC, id
 * DESC 라 세 값이 모두 있어야 같은 순위·같은 시각 행이 페이지 경계에 걸려도 중복·누락이 없다.
 *
 * <p>직렬화는 base64url(`rank|ISO-8601 Instant|id`). 시각은 {@link Instant#toString()} 으로 마이크로초(DB
 * timestamptz 정밀도)까지 보존한다 — 기존 {@link IssueCursor} 처럼 밀리초로 자르면 같은 시각 행의 동률 비교가 어긋난다.
 */
public record AiTaskCursor(int rank, Instant sortAt, long id) {

  private static final String SEP = "|";

  /** 커서 문자열로 직렬화한다. */
  public String encode() {
    String raw = rank + SEP + sortAt + SEP + id;
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
  }

  /** 커서 문자열을 해석한다. 형식이 틀리면(다른 목록의 커서 포함) {@link InvalidCursorException}(400). */
  public static AiTaskCursor decode(String cursor) {
    try {
      String raw = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
      // 정확히 세 부분이어야 한다 — 임의 바이트로 풀린 문자열·기존 이슈 커서("ms:id")를 여기서 걸러낸다.
      String[] parts = raw.split("\\|", -1);
      if (parts.length != 3) {
        throw new InvalidCursorException("cursor 형식 오류");
      }
      return new AiTaskCursor(
          Integer.parseInt(parts[0]), Instant.parse(parts[1]), Long.parseLong(parts[2]));
    } catch (InvalidCursorException e) {
      throw e;
    } catch (Exception e) {
      throw new InvalidCursorException("cursor 디코딩 실패");
    }
  }
}
