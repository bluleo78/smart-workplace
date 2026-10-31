// 이슈 목록 정렬(WP-1238) — 정렬 칩·메뉴·열 머리 클릭이 같이 쓰는 문구와 전환 규칙.
// 정렬 값 자체(URL sort·direction ↔ IssueFilters)는 issueFilters 의 parseFilters·filtersToParams 가 맡는다.

import type { IssueFilters, IssueSortDirection, IssueSortKey } from '../types/issue';
import { ISSUE_SORT_KEYS } from '../types/issue';
import {
  carryViewOptions,
  DEFAULT_SORT,
  filtersToParams,
  type IssueSortValue,
  normalizeSort,
  parseFilters,
  parseGroupParam,
  parseView,
  withoutSort,
} from './issueFilters';

// 정렬 값 모양·기본 정렬·정규화는 파싱과 같은 곳(issueFilters)에 둔다 — 그쪽이 이 파일을 부르면 순환이 생겨서. 화면은 여기서 가져다 쓴다.
export { DEFAULT_SORT, type IssueSortValue, normalizeSort };

/** 기준 이름 — 메뉴 항목·칩 문구. 메뉴 순서도 이 순서(기본인 수정일이 맨 위). */
export const ISSUE_SORT_LABEL: Record<IssueSortKey, string> = {
  updatedAt: '수정일',
  dueDate: '마감일',
  priority: '우선순위',
  createdAt: '생성일',
  status: '상태',
  assignee: '담당자',
};

/** 방향 — 메뉴·시트의 표시 순서. */
export const ISSUE_SORT_DIRECTIONS: readonly IssueSortDirection[] = ['asc', 'desc'];

export const ISSUE_SORT_DIRECTION_LABEL: Record<IssueSortDirection, string> = {
  asc: '오름차순',
  desc: '내림차순',
};

/** 필터에서 고른 정렬을 꺼낸다 — sort·direction 은 parseFilters·applySort 가 늘 함께 세팅한다. */
export function sortOf(f: Pick<IssueFilters, 'sort' | 'direction'>): IssueSortValue | null {
  return f.sort && f.direction ? { key: f.sort, direction: f.direction } : null;
}

/** 필터에 정렬을 입힌다 — null(또는 기본과 같은 정렬)이면 정렬 필드를 지워 기본 정렬로(키를 아예 보내지 않는다). */
export function applySort(f: IssueFilters, s: IssueSortValue | null): IssueFilters {
  const base = withoutSort(f);
  const n = normalizeSort(s);
  return n ? { ...base, sort: n.key, direction: n.direction } : base;
}

/**
 * 정렬만 바꾼 새 쿼리 — 정렬 칩(useIssueFilterControls.setSort)과 열 머리 클릭(useSetIssueSort)이 함께 쓰는 단 하나의 쓰기 경로.
 * 필터 쓰기와 같은 길(parseFilters → filtersToParams → carryViewOptions)을 거쳐, 같은 정렬이 어디서 골라도 같은 주소가 된다.
 * group 은 URL 원값(parseGroupParam)을 그대로 보존한다 — 명시한 「없음」이 기본 그룹으로 되돌지 않게.
 */
export function withSortParams(prev: URLSearchParams, s: IssueSortValue | null): URLSearchParams {
  return carryViewOptions(
    filtersToParams(applySort(parseFilters(prev), s), parseView(prev), parseGroupParam(prev)),
    prev,
  );
}

/**
 * 메뉴에서 기준을 고를 때 — 정렬을 고른 상태면 지금 방향을 지킨다.
 * 기본(정렬 없음)에서 처음 고르면 오름차순으로 시작한다 — 열 머리 첫 클릭(cycleHeaderSort)과 같은 출발점이라 두 입구가 같게 동작한다.
 * 단 기본 상태에서 수정일을 다시 고르면 지금(수정일 내림차순 = 기본) 그대로 둔다. 결과는 normalizeSort 를 거쳐 기본과 같으면 null.
 */
export function pickSortKey(current: IssueSortValue | null, key: IssueSortKey): IssueSortValue | null {
  if (!current && key === DEFAULT_SORT.key) return null;
  return normalizeSort({ key, direction: current?.direction ?? 'asc' });
}

/** 메뉴·시트에 체크해 보일 값 — 기본(정렬 없음)은 실제 순서인 수정일·내림차순으로 보인다. */
export function displayedSort(s: IssueSortValue | null): IssueSortValue {
  return s ?? DEFAULT_SORT;
}

/** 방향만 바꿀 때 — 기준은 지금 것(기본이면 수정일). 수정일 내림차순이면 기본(null)으로 정규화된다. */
export function pickSortDirection(current: IssueSortValue | null, direction: IssueSortDirection): IssueSortValue | null {
  return normalizeSort({ key: current?.key ?? DEFAULT_SORT.key, direction });
}

/**
 * 열 머리 클릭 — 같은 열이면 오름차순 → 내림차순 → 기본(정렬 없음) 순으로 돈다. 다른 열(또는 기본)에서 누르면 그 열 오름차순.
 * 승인된 설계(WP-1238)의 「asc → desc → 기본」 순환 그대로.
 */
export function cycleHeaderSort(current: IssueSortValue | null, key: IssueSortKey): IssueSortValue | null {
  if (!current || current.key !== key) return { key, direction: 'asc' };
  // 수정일은 내림차순이 곧 기본이라(normalizeSort) 오름차순 → 기본 두 단계로 돈다.
  return current.direction === 'asc' ? normalizeSort({ key, direction: 'desc' }) : null;
}

/** 칩 문구 — 기본이면 「정렬」, 고르면 「정렬: 마감일 ↑」(↑ 오름차순 · ↓ 내림차순). */
export function sortChipLabel(s: IssueSortValue | null): string {
  if (!s) return '정렬';
  return `정렬: ${ISSUE_SORT_LABEL[s.key]} ${s.direction === 'asc' ? '↑' : '↓'}`;
}

/**
 * 목록 열(열 키 — issueListColumns 의 내장 키, 고정 상태 열은 'status') → 정렬 기준. 여기 있는 여섯 열만 머리를 눌러 정렬한다.
 * 완료일·시작일·보고자 등은 서버 정렬 기준에 없어 누를 수 없다(누르면 아무 일 없는 머리를 만들지 않는다).
 */
export const COLUMN_SORT_KEY: Readonly<Record<string, IssueSortKey>> = {
  status: 'status',
  priority: 'priority',
  assignee: 'assignee',
  due: 'dueDate',
  created: 'createdAt',
  updated: 'updatedAt',
};

/** 열 키의 정렬 기준 — 정렬할 수 없는 열(커스텀 필드 cf<id> 포함)이면 undefined. 프로토타입 이름(constructor 등)에 걸리지 않게 자기 키만 본다. */
export function columnSortKey(columnKey: string): IssueSortKey | undefined {
  return Object.hasOwn(COLUMN_SORT_KEY, columnKey) ? COLUMN_SORT_KEY[columnKey] : undefined;
}

/** 표 머리 칸의 aria-sort — 지금 정렬된 열에만 단다(나머지는 속성 없음 = 정렬 안 됨). */
export function ariaSortOf(current: IssueSortValue | null, key: IssueSortKey): 'ascending' | 'descending' | undefined {
  if (current?.key !== key) return undefined;
  return current.direction === 'asc' ? 'ascending' : 'descending';
}

/** 정렬 메뉴 한 항목 — 데스크톱 메뉴와 모바일 시트가 같은 목록을 각자 마크업으로 그린다. */
export interface SortMenuOption<T extends string> {
  value: T;
  label: string;
  checked: boolean;
  /** 고르면 줄 다음 정렬(기본과 같으면 null). */
  next: IssueSortValue | null;
}

/**
 * 정렬 메뉴 모델(기준 목록·방향 목록) — IssueSortMenu·MobileSortSheet 공용. 체크 표시는 displayedSort(기본 = 수정일·내림차순),
 * 고른 뒤 값은 pickSortKey·pickSortDirection(기본과 같으면 null). 마크업만 화면마다 다르다.
 */
export function sortMenuModel(sort: IssueSortValue | null): {
  keys: SortMenuOption<IssueSortKey>[];
  directions: SortMenuOption<IssueSortDirection>[];
} {
  const shown = displayedSort(sort);
  return {
    keys: ISSUE_SORT_KEYS.map((k) => ({ value: k, label: ISSUE_SORT_LABEL[k], checked: shown.key === k, next: pickSortKey(sort, k) })),
    directions: ISSUE_SORT_DIRECTIONS.map((d) => ({
      value: d,
      label: ISSUE_SORT_DIRECTION_LABEL[d],
      checked: shown.direction === d,
      next: pickSortDirection(sort, d),
    })),
  };
}
