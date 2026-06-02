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
