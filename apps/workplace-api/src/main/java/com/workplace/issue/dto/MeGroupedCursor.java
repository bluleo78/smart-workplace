package com.workplace.issue.dto;

import com.workplace.issue.exception.InvalidCursorException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Base64;

/**
 * /me/issues 프로젝트 묶음 정렬(WP-915)의 복합 커서. 정렬 키(묶음 마감 또는 묶음 최근 수정, 프로젝트 id, 닫힘, 행 마감, 수정 시각, id)를 그대로
 * 담아 같은 값 행이 페이지 경계에 걸려도 중복·누락이 없다.
 *
 * <p>직렬화는 base64url(`g1|7부분`). 접두 {@code g1} 로 기존 {@link IssueCursor}·다른 목록 커서와 구분한다(토큰 수가 다르거나 접두가
 * 없으면 400). 묶음 기준이 쓰지 않는 키(DUE 의 groupUpdatedAt, RECENT 의 groupDue·closed·rowDue)는 {@code -} 로 적는다.
 * 시각은 {@link Instant#toString()} 으로 마이크로초까지 보존한다 — {@link AiTaskCursor} 와 같은 이유(밀리초로 자르면 같은 시각 행 동률
 * 비교가 어긋난다).
 */
public record MeGroupedCursor(
    LocalDate groupDue,
    Instant groupUpdatedAt,
    long projectId,
    int closed,
    LocalDate rowDue,
    Instant updatedAt,
    long id) {

  private static final String PREFIX = "g1";
  private static final String SEP = "|";
  private static final String NONE = "-";

  /** 접두를 포함한 부분 수. */
  private static final int PARTS = 8;

  /** DUE 커서인지 — 묶음 마감이 있으면 DUE, 없으면 RECENT. */
  private boolean isDue() {
    return groupDue != null;
  }

  /** 이 커서가 요청한 묶음 기준에서 나온 것인지 — 다른 기준의 커서는 쓰는 키가 비어 있어 seek 할 수 없다. */
  public boolean fits(MeIssueGrouping grouping) {
    return grouping == MeIssueGrouping.DUE
        ? groupDue != null && rowDue != null
        : groupUpdatedAt != null && groupDue == null;
  }

  /** 커서 문자열로 직렬화한다. 순서는 위 레코드 컴포넌트 순서와 같다. */
  public String encode() {
    String raw =
        String.join(
            SEP,
            PREFIX,
            isDue() ? groupDue.toString() : NONE,
            isDue() ? NONE : groupUpdatedAt.toString(),
            String.valueOf(projectId),
            isDue() ? String.valueOf(closed) : NONE,
            isDue() ? rowDue.toString() : NONE,
            updatedAt.toString(),
            String.valueOf(id));
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
  }

  /** 커서 문자열을 해석한다. 형식이 틀리면(기존 IssueCursor·다른 목록 커서 포함) {@link InvalidCursorException}(400). */
  public static MeGroupedCursor decode(String cursor) {
    try {
      String raw = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
      String[] p = raw.split("\\|", -1);
      if (p.length != PARTS || !PREFIX.equals(p[0])) {
        throw new InvalidCursorException("cursor 형식 오류");
      }
      return new MeGroupedCursor(
          NONE.equals(p[1]) ? null : LocalDate.parse(p[1]),
          NONE.equals(p[2]) ? null : Instant.parse(p[2]),
          Long.parseLong(p[3]),
          NONE.equals(p[4]) ? 0 : Integer.parseInt(p[4]),
          NONE.equals(p[5]) ? null : LocalDate.parse(p[5]),
          Instant.parse(p[6]),
          Long.parseLong(p[7]));
    } catch (InvalidCursorException e) {
      throw e;
    } catch (Exception e) {
      throw new InvalidCursorException("cursor 디코딩 실패");
    }
  }
}
