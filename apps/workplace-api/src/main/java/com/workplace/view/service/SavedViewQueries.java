package com.workplace.view.service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.regex.Pattern;

/**
 * 저장된 뷰 쿼리 문자열에서 프로젝트 상태 id 를 다루는 순수 함수(WP-809). 상태를 지우면 그 id 를 가리키던 뷰의 필터(statusId)와 모바일 보드 선택
 * 탭(boardTab)을 옮길 상태로 바꾸거나 빼야 한다 — 그대로 두면 뷰를 열 때 없는 상태로 거른 빈 목록이 나온다.
 *
 * <p>웹은 URLSearchParams 로 저장해 statusId 의 쉼표가 {@code %2C} 로 인코딩돼 있을 수 있다. 상태 id 파라미터만 쉼표·{@code
 * %2C}·{@code %2c} 를 풀어 다루고, 그 밖의 파라미터는 원문 그대로 남긴다(URLDecoder 는 「+」를 공백으로 바꿔 다른 값을 망가뜨린다).
 */
public final class SavedViewQueries {

  /** 상태 필터 파라미터 — 상태 id CSV. */
  static final String STATUS_ID = "statusId";

  /** 모바일 보드 선택 탭 — 상태 id 하나(WP-808). */
  static final String BOARD_TAB = "boardTab";

  /**
   * 파라미터를 다 지워 쿼리가 비었을 때 대신 쓰는 중립 쿼리 — 저장된 뷰 query 는 비면 안 되는데(SaveViewRequest @NotBlank, 비면 뒤에 이름만
   * 바꿔도 400), 웹은 group 이 없는 저장된 뷰를 「그룹 없음」으로 읽고(savedViewQuery.ts savedGroup) 필터 없는 목록 뷰를 저장할 때도 바로
   * 이 값을 쓴다(useSavedViewState currentQuery). 그래서 빈 쿼리와 뜻이 같다.
   */
  static final String NEUTRAL_QUERY = "group=none";

  /** statusId 값의 구분자 — 쉼표와 인코딩된 쉼표(대소문자). */
  private static final Pattern SEPARATOR = Pattern.compile(",|%2[cC]");

  private SavedViewQueries() {}

  /**
   * fromId 를 toId 로 바꾼(toId 가 null 이면 뺀) 쿼리. statusId 는 바꾼 뒤 중복을 없애(순서 유지) {@code %2C} 로 다시 쓰고, 비면
   * 파라미터를 지운다. boardTab 이 fromId 면 toId 로(null 이면 삭제). fromId 를 담지 않은 파라미터와 다른 파라미터는 원문 그대로라, 바뀐 것이
   * 없으면 입력과 같은 문자열이 나온다(호출부가 같으면 쓰지 않는다). 지운 결과 쿼리가 통째로 비면 빈 문자열 대신 {@link #NEUTRAL_QUERY}.
   */
  public static String replaceStatus(String query, long fromId, Long toId) {
    if (query == null || query.isEmpty()) return query;
    String from = String.valueOf(fromId);
    String to = toId == null ? null : String.valueOf(toId);
    List<String> out = new ArrayList<>();
    for (String part : query.split("&", -1)) {
      String key = keyOf(part);
      if (STATUS_ID.equals(key)) {
        List<String> ids = ids(part);
        if (!ids.contains(from)) {
          out.add(part);
          continue;
        }
        var replaced = new LinkedHashSet<String>();
        for (String id : ids) {
          if (id.equals(from)) {
            if (to != null) replaced.add(to);
          } else {
            replaced.add(id);
          }
        }
        if (!replaced.isEmpty()) out.add(STATUS_ID + "=" + String.join("%2C", replaced));
      } else if (BOARD_TAB.equals(key) && from.equals(valueOf(part))) {
        if (to != null) out.add(BOARD_TAB + "=" + to);
      } else {
        out.add(part);
      }
    }
    String result = String.join("&", out);
    return result.isEmpty() ? NEUTRAL_QUERY : result;
  }

  /** 쿼리의 statusId 또는 boardTab 이 이 상태를 가리키는가 — 삭제 영향(고칠 저장된 뷰 수)을 세는 데 쓴다. */
  public static boolean references(String query, long statusId) {
    if (query == null || query.isEmpty()) return false;
    String id = String.valueOf(statusId);
    for (String part : query.split("&", -1)) {
      String key = keyOf(part);
      if (STATUS_ID.equals(key) && ids(part).contains(id)) return true;
      if (BOARD_TAB.equals(key) && id.equals(valueOf(part))) return true;
    }
    return false;
  }

  /**
   * 이 상태를 빼면 statusId 필터가 통째로 비는가 — 옮길 대상 없이(이슈 0개) 지울 때 「필터가 빠지는」 뷰를 미리 알리기 위해. boardTab 은 필터가 아니라
   * 선택 탭이라 세지 않는다.
   */
  public static boolean emptiesStatusFilter(String query, long statusId) {
    if (query == null || query.isEmpty()) return false;
    String id = String.valueOf(statusId);
    for (String part : query.split("&", -1)) {
      if (!STATUS_ID.equals(keyOf(part))) continue;
      List<String> ids = ids(part);
      if (ids.contains(id) && ids.stream().allMatch(id::equals)) return true;
    }
    return false;
  }

  /** "k=v" 의 k(= 가 없으면 전체). */
  private static String keyOf(String part) {
    int eq = part.indexOf('=');
    return eq < 0 ? part : part.substring(0, eq);
  }

  /** "k=v" 의 v(= 가 없으면 빈 문자열). */
  private static String valueOf(String part) {
    int eq = part.indexOf('=');
    return eq < 0 ? "" : part.substring(eq + 1);
  }

  /** statusId 값을 쉼표·인코딩된 쉼표로 나눈 id 들(빈 칸 제외, 앞뒤 공백 제거). */
  private static List<String> ids(String part) {
    List<String> ids = new ArrayList<>();
    for (String token : SEPARATOR.split(valueOf(part))) {
      String t = token.strip();
      if (!t.isEmpty()) ids.add(t);
    }
    return ids;
  }
}
