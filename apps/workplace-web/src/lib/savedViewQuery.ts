// 저장된 뷰 쿼리스트링 정규화 — 활성 칩 판정용.
// 이슈 필터 직렬화를 한 번 통과시켜 키 순서/미지정 파라미터를 제거한 canonical 문자열을 만든다.

import {
  filtersToParams,
  parseFilters,
  parseGroupBy,
  parseView,
} from './issueFilters';

// 쿼리스트링 → canonical 쿼리스트링(이슈 필터로 round-trip).
// group 도 포함해야 활성 칩 판정/저장 뷰 비교에서 그룹 차이가 반영된다.
export function normalizeIssueQuery(query: string): string {
  const params = new URLSearchParams(query);
  return filtersToParams(
    parseFilters(params),
    parseView(params),
    parseGroupBy(params),
  ).toString();
}

// 두 이슈 필터 쿼리스트링이 (정규화 후) 동등한가.
export function queriesEqual(a: string, b: string): boolean {
  return normalizeIssueQuery(a) === normalizeIssueQuery(b);
}

// normalizeIssueQuery 와 동일하되 view(list/board) 는 비교 대상에서 제외한다.
// 리스트/보드 전환은 뷰칩(전체/저장뷰) 활성 판정과 독립적인 축으로 취급해야 한다 (#599) —
// 그렇지 않으면 view=board 만 있는 URL 이 우연히 "필터 없이 보드뷰만 저장된 뷰"의
// 쿼리와 일치해 전체 대신 그 저장뷰가 활성으로 표시된다.
export function normalizeIssueQueryIgnoringView(query: string): string {
  const params = new URLSearchParams(query);
  // view 를 고정값으로 덮어써 filtersToParams 가 view 키를 항상 생략하게 만든다.
  return filtersToParams(
    parseFilters(params),
    'list',
    parseGroupBy(params),
  ).toString();
}

// 두 이슈 필터 쿼리스트링이 view 를 무시하고 (정규화 후) 동등한가.
export function queriesEqualIgnoringView(a: string, b: string): boolean {
  return normalizeIssueQueryIgnoringView(a) === normalizeIssueQueryIgnoringView(b);
}
