package com.workplace.issue.dto;

import com.workplace.issue.exception.InvalidIssueFilterException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 이슈 목록 사용자 지정 정렬(WP-1238, {@code sort=dueDate,priority&direction=asc,desc}). 목록·보드 컬럼·/me/issues 가
 * 같은 규칙으로 정렬 키를 고른다. sort 가 없으면 null — 기존 (updated_at DESC, id DESC) 정렬과 {@link IssueCursor} 그대로다.
 *
 * <p>방향 파라미터 이름은 {@code direction} 이다 — {@code order} 는 이미 체크리스트 정렬({@link ChecklistOrder}, {@code
 * order=checklist})이 쓰고 있어 겹치지 않게 했다.
 *
 * @param keys 사용자가 고른 정렬 키(순서대로, 중복 없음). 동률 깨기(updatedAt DESC → id DESC)는 리포지토리가 덧붙인다.
 */
public record IssueSort(List<Key> keys) {

  /** 정렬할 수 있는 키 — {@code param} 은 쿼리 파라미터 표기. */
  public enum Field {
    DUE_DATE("dueDate"),
    PRIORITY("priority"),
    CREATED_AT("createdAt"),
    UPDATED_AT("updatedAt"),
    STATUS("status"),
    ASSIGNEE("assignee");

    private final String param;

    Field(String param) {
      this.param = param;
    }

    public String param() {
      return param;
    }

    /** 파라미터 표기(대소문자 무시) → 키. 없으면 null. */
    static Field of(String raw) {
      for (Field f : values()) {
        if (f.param.equalsIgnoreCase(raw)) return f;
      }
      return null;
    }
  }

  /** 정렬 키 하나와 방향. */
  public record Key(Field field, boolean desc) {}

  /** 이 키를 골랐는지 — updatedAt 을 고르면 동률 깨기에서 updatedAt 을 다시 붙이지 않는다. */
  public boolean has(Field f) {
    return keys.stream().anyMatch(k -> k.field() == f);
  }

  /**
   * 커서에 싣는 정렬 서명(예: {@code dueDate:asc,priority:desc}) — 다른 정렬에서 나온 커서를 알아보려고 쓴다(정렬 키가 다르면 커서 값의 뜻도
   * 달라 이어 읽을 수 없다).
   */
  public String signature() {
    return keys.stream()
        .map(k -> k.field().param() + ":" + (k.desc() ? "desc" : "asc"))
        .collect(Collectors.joining(","));
  }

  /**
   * 파라미터 해석. sort 가 없으면 null(direction 만 오면 400). 규칙:
   *
   * <ul>
   *   <li>sort: 쉼표 구분 키 목록. 없는 키·중복 키는 400.
   *   <li>direction: 쉼표 구분 {@code asc|desc}. 없으면 모든 키 desc(기본 정렬이 최근 수정 desc 라 같은 감각). 값이 하나면 모든
   *       키에, 여럿이면 키와 자리별로 짝지으며 개수가 다르면 400.
   * </ul>
   *
   * 오류는 {@link InvalidIssueFilterException}(400, 필드별 사유) — 다른 검색 필터 오류와 같은 모양.
   */
  public static IssueSort parse(String sort, String direction) {
    List<String> sortTokens = csv(sort);
    List<String> dirTokens = csv(direction);
    if (sortTokens.isEmpty()) {
      if (!dirTokens.isEmpty()) {
        throw new InvalidIssueFilterException("direction", "direction 에는 sort 가 필요합니다");
      }
      return null;
    }
    if (dirTokens.size() > 1 && dirTokens.size() != sortTokens.size()) {
      throw new InvalidIssueFilterException(
          "direction",
          "direction 개수(" + dirTokens.size() + ")가 sort 개수(" + sortTokens.size() + ")와 다릅니다");
    }
    List<Key> keys = new ArrayList<>(sortTokens.size());
    Set<Field> seen = new HashSet<>();
    for (int i = 0; i < sortTokens.size(); i++) {
      String token = sortTokens.get(i);
      Field f = Field.of(token);
      if (f == null) {
        throw new InvalidIssueFilterException(
            "sort",
            "sort '"
                + token
                + "' 은(는) 없는 키입니다. 사용 가능: "
                + Arrays.stream(Field.values())
                    .map(Field::param)
                    .collect(Collectors.joining(", ")));
      }
      if (!seen.add(f)) {
        throw new InvalidIssueFilterException("sort", "sort 키가 중복됐습니다: " + f.param());
      }
      String dir =
          dirTokens.isEmpty()
              ? "desc"
              : dirTokens.size() == 1 ? dirTokens.get(0) : dirTokens.get(i);
      keys.add(new Key(f, parseDirection(dir)));
    }
    return new IssueSort(List.copyOf(keys));
  }

  private static boolean parseDirection(String raw) {
    return switch (raw.toLowerCase(Locale.ROOT)) {
      case "asc" -> false;
      case "desc" -> true;
      default ->
          throw new InvalidIssueFilterException(
              "direction", "direction 은 asc·desc 중 하나여야 합니다: " + raw);
    };
  }

  private static List<String> csv(String s) {
    if (s == null || s.isBlank()) return List.of();
    return Arrays.stream(s.split(",")).map(String::trim).filter(x -> !x.isEmpty()).toList();
  }
}
