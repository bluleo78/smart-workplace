package com.workplace.issue.dto;

import com.workplace.issue.exception.InvalidCursorException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;

/**
 * AI 위임 작업 목록의 복합 커서(WP-377, WP-375 에서 에픽 묶음 정렬로 확장). 정렬 키 7개 (묶음 순위, 묶음 최근 시각, 묶음 키, 머리 순서, 순위, 정렬
 * 시각, 이슈 id) 를 그대로 담아 같은 값 행이 페이지 경계에 걸려도 중복·누락이 없다.
 *
 * <p>직렬화는 base64url(`7개를 |`). 시각은 {@link Instant#toString()} 으로 마이크로초(DB timestamptz 정밀도)까지 보존한다 —
 * 기존 {@link IssueCursor} 처럼 밀리초로 자르면 같은 시각 행의 동률 비교가 어긋난다. 이전 3부분 커서는 400 — 배포 직후 스크롤 중이던 화면은
 * 새로고침으로 복구한다(스펙 §3.6).
 */
public record AiTaskCursor(
    int groupRank,
    Instant groupSortAt,
    long groupKey,
    int headOrder,
    int rank,
    Instant sortAt,
    long id) {

  private static final String SEP = "|";

  /** 커서를 이루는 부분 수 — 정렬 키 수와 같다. */
  private static final int PARTS = 7;

  /** 커서 문자열로 직렬화한다. */
  public String encode() {
    String raw =
        String.join(
            SEP,
            String.valueOf(groupRank),
            groupSortAt.toString(),
            String.valueOf(groupKey),
            String.valueOf(headOrder),
            String.valueOf(rank),
            sortAt.toString(),
            String.valueOf(id));
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
  }

  /** 커서 문자열을 해석한다. 형식이 틀리면(이전 3부분 커서·다른 목록의 커서 포함) {@link InvalidCursorException}(400). */
  public static AiTaskCursor decode(String cursor) {
    try {
      String raw = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
      // 정확히 일곱 부분이어야 한다 — 임의 바이트로 풀린 문자열·기존 이슈 커서("ms:id")·이전 3부분 커서를 여기서 걸러낸다.
      String[] p = raw.split("\\|", -1);
      if (p.length != PARTS) {
        throw new InvalidCursorException("cursor 형식 오류");
      }
      return new AiTaskCursor(
          Integer.parseInt(p[0]),
          Instant.parse(p[1]),
          Long.parseLong(p[2]),
          Integer.parseInt(p[3]),
          Integer.parseInt(p[4]),
          Instant.parse(p[5]),
          Long.parseLong(p[6]));
    } catch (InvalidCursorException e) {
      throw e;
    } catch (Exception e) {
      throw new InvalidCursorException("cursor 디코딩 실패");
    }
  }
}
