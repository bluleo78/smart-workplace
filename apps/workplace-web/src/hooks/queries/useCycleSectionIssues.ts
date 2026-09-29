// 사이클 백로그 섹션 쿼리 (#878) — 섹션(사이클 / 사이클 미할당 백로그)마다 독립 무한 스크롤 쿼리.
// 키는 useIssueSearch 의 ['issues','search',projectKey,…] 하위라 이슈 변경·사이클 피커·SSE resource.changed 무효화에 함께 걸린다.

import { useMemo } from 'react';

import { parseFilters } from '../../lib/issueFilters';
import type { IssueFilters } from '../../types/issue';
import type { BoardColumnQuery } from './useIssueBoardColumns';
import { issueSearchKey, useIssueSearch } from './useIssueSearch';

// 섹션당 한 페이지 크기 — 보드 컬럼(BOARD_COLUMN_PAGE_SIZE)과 같은 기준.
const SECTION_PAGE_SIZE = 50;

// 섹션 필터 공통 기반 — 빈 URL 파싱 결과(모든 필터 해제)에서 출발해 섹션 조건만 덧붙인다.
// 범위는 이슈 목록 기본과 같게 SUBTASK·EPIC 을 뺀다(작업 단위만 계획 대상, 하위는 부모 상세에서 본다).
// withDefaultIssueScope 는 쓰지 않는다 — 그 hideInactiveClosed 가 켜지면 예정·완료 사이클의 DONE 이슈가 사라진다.
function baseSectionFilters(): IssueFilters {
  return { ...parseFilters(new URLSearchParams()), excludeSubtasks: true, excludeEpics: true };
}

/** 사이클 섹션 필터 — 해당 사이클 소속 전 상태. */
function cycleSectionFilters(cycleId: number): IssueFilters {
  return { ...baseSectionFilters(), cycleIds: [cycleId] };
}

/** 백로그 섹션 필터 — 사이클 미할당(cycle=null) + 미종료(DONE·CANCELED 제외). */
export function backlogSectionFilters(): IssueFilters {
  return { ...baseSectionFilters(), cycleUnassigned: true, statuses: ['TODO', 'IN_PROGRESS'] };
}

/** 섹션 식별 — 사이클 id, 또는 null=백로그. */
export type SectionCycleId = number | null;

/** 섹션 필터 — null 이면 백로그, 아니면 해당 사이클. */
export function sectionFilters(cycleId: SectionCycleId): IssueFilters {
  return cycleId == null ? backlogSectionFilters() : cycleSectionFilters(cycleId);
}

/** 섹션 쿼리 키 — 드래그 이동의 낙관적 캐시 패치가 섹션을 정확히 짚는 데 쓴다(#881). */
export function sectionQueryKey(projectKey: string, cycleId: SectionCycleId) {
  return issueSearchKey(projectKey, sectionFilters(cycleId), SECTION_PAGE_SIZE);
}

/**
 * 섹션 이슈 쿼리 — 펼친 섹션만 요청한다.
 * 왜 undefined 반환: 접힌 섹션도 훅은 호출되는데, 같은 키의 비활성 observer 는 캐시 data·hasNextPage 를 그대로 돌려준다(#875).
 * 다시 접은 섹션에 옛 건수·행·sentinel 이 새지 않도록 비활성이면 결과를 버린다(useIssueBoardColumns 의 슬롯과 같은 규칙).
 */
export function useSectionIssues(
  projectKey: string,
  cycleId: SectionCycleId,
  expanded: boolean,
): BoardColumnQuery | undefined {
  // 필터는 sectionQueryKey 와 같은 함수로 만든다 — 쿼리와 낙관적 패치 키가 어긋나지 않게.
  const filters = useMemo(() => sectionFilters(cycleId), [cycleId]);
  const query = useIssueSearch(projectKey, filters, SECTION_PAGE_SIZE, expanded);
  return expanded ? query : undefined;
}

