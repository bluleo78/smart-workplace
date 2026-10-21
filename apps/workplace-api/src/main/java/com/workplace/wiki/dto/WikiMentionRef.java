package com.workplace.wiki.dto;

/**
 * 본문 토큰 1개의 하이드레이션 결과(칩 라벨/링크용). 멤버 경로에서 비가시 대상은 목록에서 제외한다. 공유 링크로 들어온 사람(WP-579)에게는 볼 수 없는 대상도 빼지
 * 않고 {@code label=null, inaccessible=true} 로 돌려 칩이 「접근 권한 없음」으로 보이게 한다(제목·소속은 싣지 않는다).
 */
public record WikiMentionRef(
    String type, // USER | PAGE | ISSUE
    long id, // 대상 전역 id
    String label, // 유저 name / 페이지 title / 이슈 title (inaccessible 이면 null)
    Long spaceId, // PAGE 전용 라우트(그 외 null)
    String projectKey, // ISSUE 전용(그 외 null)
    Integer number, // ISSUE 전용(그 외 null)
    boolean inaccessible) { // 공유로 들어온 사람이 볼 수 없는 대상

  /** 볼 수 있는 대상 — 기존 호출부 호환용(inaccessible=false). */
  public WikiMentionRef(
      String type, long id, String label, Long spaceId, String projectKey, Integer number) {
    this(type, id, label, spaceId, projectKey, number, false);
  }

  /** 공유로 들어온 사람이 볼 수 없는 대상 — 종류와 id 만 남긴다. */
  public static WikiMentionRef inaccessible(String type, long id) {
    return new WikiMentionRef(type, id, null, null, null, null, true);
  }
}
