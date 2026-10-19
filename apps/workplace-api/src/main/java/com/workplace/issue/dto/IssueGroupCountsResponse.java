package com.workplace.issue.dto;

import java.util.List;

/**
 * 목록 그룹별 이슈 총계(WP-472) — 검색과 같은 필터로 센 정확한 수. 목록은 30개씩 불러오므로 화면이 센 수는 「불러온 행 수」일 뿐이라 헤더는 이 값을 쓴다.
 *
 * @param groupBy status · priority · assignee
 * @param groups 0건이 아닌 그룹만. key 는 상태·우선순위 값, assignee 면 담당자 user id(담당자 없음은 null)
 */
public record IssueGroupCountsResponse(String groupBy, List<GroupCount> groups) {

  /** 그룹 하나의 총계. */
  public record GroupCount(String key, int count) {}
}
