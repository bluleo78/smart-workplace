package com.workplace.issue.dto;

import com.workplace.global.util.SingleLineTitles;

/**
 * 이미 유형을 해석하고 주소를 정규화한 외부 링크 한 줄 — 가져오기가 {@code IssueExternalLinkService.insertForImport} 로 넘긴다.
 *
 * @param typeId 관계 유형 id
 * @param issueIsSource 방향 있는 유형에서 이 이슈가 A 쪽인가(방향 없는 유형은 서비스가 true 로 맞춘다)
 * @param url 정규화된 http/https 주소
 * @param key 상대 시스템의 키(없으면 null)
 * @param title 제목 — 만들 때 한 줄로 다듬는다(WP-1171)
 */
public record ResolvedExternalLink(
    long typeId, boolean issueIsSource, String url, String key, String title) {
  /**
   * 저장 직전 값을 한 번 더 같은 기준({@link SingleLineTitles})으로 다듬는 방어선(WP-1171) — 지금 유일한 생성자인 가져오기는 요청 DTO 에서
   * 이미 다듬고 검증하지만, 이 값을 직접 만드는 경로가 생겨도 보이지 않는 글자뿐인 제목·키가 저장되지 않게 한다.
   */
  public ResolvedExternalLink {
    title = SingleLineTitles.normalize(title);
    key = SingleLineTitles.normalizeOptional(key);
    if (title == null || title.isEmpty()) {
      throw new IllegalArgumentException("외부 링크 제목을 입력해 주세요");
    }
  }
}
