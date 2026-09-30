// 저장된 뷰 쿼리스트링 정규화 — 활성 칩 판정용.
// 이슈 필터 직렬화를 한 번 통과시켜 키 순서/미지정 파라미터를 제거한 canonical 문자열을 만든다.

import type { IssueGroupParam } from '../types/issue';
import {
  filtersToParams,
  parseFilters,
  parseGroupParam,
  parseView,
} from './issueFilters';

// 저장 뷰 쿼리의 group 해석(#878) — 사이클 그룹 기본값 도입 전 저장된 뷰는 group 이 없고 "그룹 없음"으로 열렸다.
// 부재를 'none' 으로 읽어야 기존 뷰가 이전과 같게 열리고, 활성 칩 판정도 명시 저장된 새 뷰와 같은 기준이 된다.
function savedGroup(params: URLSearchParams): IssueGroupParam {
  return parseGroupParam(params) ?? 'none';
}

// 저장 뷰를 적용할 URL 파라미터 — group 이 없으면 'none' 을 명시해 기본(사이클) 그룹으로 바뀌지 않게 한다.
// 뷰 칩 클릭과 사이드바 고정 뷰 링크가 같은 규칙을 쓴다.
export function savedViewQueryToParams(query: string): URLSearchParams {
  const params = new URLSearchParams(query);
  if (!params.has('group')) params.set('group', 'none');
  return params;
}

// 쿼리스트링 → canonical 쿼리스트링(이슈 필터로 round-trip).
// group 도 포함해야 활성 칩 판정/저장 뷰 비교에서 그룹 차이가 반영된다. group 부재는 'none'(저장 뷰 해석, #878).
export function normalizeIssueQuery(query: string): string {
  const params = new URLSearchParams(query);
  return filtersToParams(
    parseFilters(params),
    parseView(params),
    savedGroup(params),
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
    savedGroup(params),
  ).toString();
}

// 두 이슈 필터 쿼리스트링이 view 를 무시하고 (정규화 후) 동등한가.
export function queriesEqualIgnoringView(a: string, b: string): boolean {
  return normalizeIssueQueryIgnoringView(a) === normalizeIssueQueryIgnoringView(b);
}

// normalizeIssueQueryIgnoringView 와 동일하되 group 도 비교 대상에서 제외한다 (#773).
// group 은 필터가 아니라 표시(디스플레이) 옵션이므로 "전체"(필터 없음) 칩의 활성 판정은
// group 변경과 무관해야 한다 — 저장된 뷰 자체의 활성 판정(queriesEqualIgnoringView)은
// 여전히 group 을 포함해 비교한다(#58) — 그룹이 저장 뷰 정의에 없으면 뷰 자체는 비활성이어야
// 하는 기존 동작(view chip 은 그룹 커스터마이즈 상태를 표시하지 않음)을 그대로 둔다.
export function normalizeIssueQueryIgnoringViewAndGroup(query: string): string {
  const params = new URLSearchParams(query);
  return filtersToParams(parseFilters(params), 'list', null).toString();
}
