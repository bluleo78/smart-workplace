package com.workplace.issue.dto;

import com.workplace.issue.exception.InvalidCursorException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.Base64;

/**
 * 개인 작업 목록 체크리스트 정렬(WP-918, {@link ChecklistOrder})의 복합 커서. 정렬 키(섹션 k1, 우선순위 순위, 마감, id)를 그대로 담아 같은
 * 값 행이 페이지 경계에 걸려도 중복·누락이 없다.
 *
 * <p>직렬화는 base64url(`c1|k1|prio|due|id`). 접두 {@code c1} 로 기존 {@link IssueCursor}·다른 목록 커서와 구분한다(부분
 * 수가 다르거나 접두가 틀리면 400). due 는 마감 없음도 센티널 날짜로 채워져 있어 빈 자리가 없다.
 */
public record ChecklistCursor(int k1, int prio, LocalDate due, long id) {

  private static final String PREFIX = "c1";
  private static final String SEP = "|";

  /** 접두를 포함한 부분 수. */
  private static final int PARTS = 5;

  /** 커서 문자열로 직렬화한다. 순서는 레코드 컴포넌트 순서와 같다. */
  public String encode() {
    String raw =
        String.join(
            SEP,
            PREFIX,
            String.valueOf(k1),
            String.valueOf(prio),
            due.toString(),
            String.valueOf(id));
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
  }

  /** 커서 문자열을 해석한다. 형식이 틀리면(기존 IssueCursor·다른 목록 커서 포함) {@link InvalidCursorException}(400). */
  public static ChecklistCursor decode(String cursor) {
    try {
      String raw = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
      String[] p = raw.split("\\|", -1);
      if (p.length != PARTS || !PREFIX.equals(p[0])) {
        throw new InvalidCursorException("cursor 형식 오류");
      }
      return new ChecklistCursor(
          Integer.parseInt(p[1]),
          Integer.parseInt(p[2]),
          LocalDate.parse(p[3]),
          Long.parseLong(p[4]));
    } catch (InvalidCursorException e) {
      throw e;
    } catch (Exception e) {
      throw new InvalidCursorException("cursor 디코딩 실패");
    }
  }
}
