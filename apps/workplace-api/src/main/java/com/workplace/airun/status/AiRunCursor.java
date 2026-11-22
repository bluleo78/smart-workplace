package com.workplace.airun.status;

import com.workplace.global.time.CursorInstants;
import com.workplace.issue.exception.InvalidCursorException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;

/**
 * AI 실행 이력 목록의 복합 커서(WP-1831). 두 출처(R=AI 실행, W=워커 작업)를 합친 목록을 (시작 시각 내림, 출처, id) 로 정렬하므로 세 값을 모두 담아
 * 같은 시각 행이 페이지 경계에 걸려도 중복·누락이 없게 한다.
 *
 * <p>직렬화는 base64url(패딩 없음) `startedAt|source|id`. 시각은 {@link Instant#toString()} 으로 마이크로초까지 보존한다.
 */
public record AiRunCursor(Instant startedAt, char source, long id) {

  private static final String SEP = "|";

  /** 커서 문자열로 직렬화한다. */
  public String encode() {
    String raw = String.join(SEP, startedAt.toString(), String.valueOf(source), String.valueOf(id));
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
  }

  /** 커서 문자열을 해석한다. 형식·시각 범위·출처 문자가 어긋나면 {@link InvalidCursorException}(400). */
  public static AiRunCursor decode(String cursor) {
    try {
      String raw = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
      String[] p = raw.split("\\|", -1);
      // 세 부분이어야 한다 — 임의 바이트·다른 목록의 커서를 여기서 걸러낸다.
      if (p.length != 3 || p[1].length() != 1 || "RW".indexOf(p[1].charAt(0)) < 0) {
        throw new InvalidCursorException("cursor 형식 오류");
      }
      return new AiRunCursor(
          CursorInstants.checked(Instant.parse(p[0])), p[1].charAt(0), Long.parseLong(p[2]));
    } catch (InvalidCursorException e) {
      throw e;
    } catch (Exception e) {
      throw new InvalidCursorException("cursor 디코딩 실패");
    }
  }
}
