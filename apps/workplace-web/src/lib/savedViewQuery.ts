// 저장된 뷰 쿼리스트링 정규화 — 활성 칩 판정용.
// 이슈 필터 직렬화를 한 번 통과시켜 키 순서/미지정 파라미터를 제거한 canonical 문자열을 만든다.

import type { IssueGroupParam } from '../types/issue';
import {
  filtersToParams,
  parseFilters,
  parseGroupParam,
  parseView,
} from './issueFilters';
import { COLS_PARAM, parseColumns } from './issueListColumns';

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
// 목록 열 구성(cols, WP-270)은 filtersToParams 가 내보내지 않아 정규형에서 빠진다 — 아래 정규형 비교는 필터만 본다.
// 열까지 보는 저장 뷰 일치는 savedViewMatches(열을 담은 뷰만 열도 비교)가 맡고, 「전체」 판정은 언제나 열을 무시한다.
// 적용(savedViewQueryToParams)은 원문 그대로라 뷰에 실린 cols 는 URL 로 간다.
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

/** 쿼리에 필터가 하나도 없는가(view·group·cols 만) — 「전체」 판정, 필터 없는 저장 뷰 판정(WP-1022). */
export function queryHasNoFilters(query: string): boolean {
  return normalizeIssueQueryIgnoringViewAndGroup(query) === '';
}

/**
 * 필터 없는 저장 뷰가 주소만 보고 저절로 켜져도 되는가 — 그룹(없음 아님)이나 열 구성을 담았을 때만(WP-1022).
 * 보드 전용·그룹 없음 뷰(#599)는 「전체」에서 그룹 「없음」만 골라도 같아져 저절로 켜지면 안 된다. 그런 뷰는 칩을 눌러 고른 동안만 켜진다.
 */
export function savedViewShowsDisplayChoice(query: string): boolean {
  return savedGroup(new URLSearchParams(query)) !== 'none' || savedViewHasColumns(query);
}

/**
 * 저장 뷰를 링크로 열 때 함께 넘기는 history state(WP-1022) — 사이드바 고정 뷰처럼 주소만 바꾸는 링크도
 * 칩을 누른 것과 같이 그 뷰를 「고른 뷰」로 잡게 한다. 주소만으로는 우연히 같아진 화면과 구분되지 않는다.
 */
export interface SavedViewLinkState {
  savedViewId: number;
}

/** location.state 에서 연 저장 뷰 id 를 꺼낸다 — 다른 모양이면 null. */
export function linkedSavedViewId(state: unknown): number | null {
  const id = (state as Partial<SavedViewLinkState> | null)?.savedViewId;
  return typeof id === 'number' ? id : null;
}

// ─── 열을 담은 저장 뷰(WP-270) ───────────────────────────────────────────────
// 저장된 뷰는 저장 창에서 「현재 열 구성도 함께 저장」을 켰을 때만 cols 를 담는다(사용자 결정, 스펙 4.7).
// 담은 뷰는 연 사람 모두 그 열로 보고 열만 바꿔도 「수정됨」이 된다. 안 담은 뷰는 각자 개인 열로 보고 열은 비교하지 않는다.

/** 저장 뷰 쿼리가 열 구성을 담았는가 — `cols=`(선택 열 모두 끔)도 담은 것이다(부재와 구분). */
export function savedViewHasColumns(query: string): boolean {
  return new URLSearchParams(query).has(COLS_PARAM);
}

/** 쿼리에서 cols 만 뺀다 — 열을 담지 않은 뷰에 저장할 쿼리. */
export function withoutColumns(query: string): string {
  const params = new URLSearchParams(query);
  if (!params.has(COLS_PARAM)) return query;
  params.delete(COLS_PARAM);
  return params.toString();
}

/** cols 값 → 비교용 정렬 키 문자열(부재는 null). 순서는 표시 규칙이 정하므로 집합으로 비교한다 — 저장 순서·인코딩 차이로 「수정됨」이 되지 않게. */
function columnSetKey(query: string): string | null {
  const keys = parseColumns(new URLSearchParams(query).get(COLS_PARAM), null);
  return keys == null ? null : [...keys].sort().join(',');
}

/**
 * 현재 화면(필터 + 지금 고른 열 cols)이 저장 뷰와 일치하는가.
 * 필터는 view(목록/보드)를 무시하고 비교하고(#599), 열은 뷰가 열을 담았을 때만 집합으로 비교한다.
 * @param currentQuery 현재 필터 쿼리 + 지금 고른 열(cols) — useSavedViewState 의 열 포함 쿼리.
 */
export function savedViewMatches(currentQuery: string, viewQuery: string): boolean {
  if (!queriesEqualIgnoringView(currentQuery, viewQuery)) return false;
  if (!savedViewHasColumns(viewQuery)) return true;
  return columnSetKey(currentQuery) === columnSetKey(viewQuery);
}

/**
 * 기존 뷰를 현재 화면으로 갱신할 때 저장할 쿼리 — 뷰의 선택을 지킨다.
 * 열을 담은 뷰면 지금 고른 열까지(열 포함 쿼리 그대로), 아니면 열을 빼 각자 개인 열로 보는 뷰로 남긴다.
 */
export function savedViewUpdateQuery(viewQuery: string, currentQueryWithColumns: string): string {
  return savedViewHasColumns(viewQuery) ? currentQueryWithColumns : withoutColumns(currentQueryWithColumns);
}

/**
 * 뷰를 저장·갱신한 직후 URL 의 cols 를 저장된 뷰에 맞춘다 — 화면이 「그 뷰를 연 상태」 와 같아지게.
 * 열을 담은 뷰를 막 만들었는데 URL 에 cols 가 없으면, 다음 열 변경이 뷰(URL)가 아니라 개인 저장값을 바꿔 버린다.
 * 열을 담지 않은 뷰면 cols 를 빼 개인 열로 본다(다른 뷰에서 온 cols 가 남지 않게). 다른 파라미터는 그대로 둔다.
 */
export function syncSavedViewColumns(prev: URLSearchParams, savedQuery: string): URLSearchParams {
  const next = new URLSearchParams(prev);
  const cols = new URLSearchParams(savedQuery).get(COLS_PARAM);
  if (cols === null) next.delete(COLS_PARAM);
  else next.set(COLS_PARAM, cols);
  return next;
}
