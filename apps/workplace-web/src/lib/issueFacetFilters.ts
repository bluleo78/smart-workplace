// 이슈 목록 facet 필터 판정 — 모바일 필터 배지·「전체 해제」·뷰 칩 「전체」 판정의 순수 규칙(WP-412 에서 훅 밖으로 분리).
import type { FacetValue } from '@/components/filter/types'
import type { IssueFilters } from '@/types/issue'

import { filtersToParams } from './issueFilters'

/**
 * 값이 있는 facet 수(검색어 제외) — 모바일 「필터 N」 배지·「전체 해제」 활성 판정.
 * 담당자 「미지정」(includeUnassigned, URL assignee=null)은 filterValue 에 안 담기므로 담당자 facet 이 활성인 것으로 한 번만 센다.
 */
export function countActiveFacets(filterValue: Record<string, FacetValue[] | undefined>, includeUnassigned: boolean): number {
  return Object.entries(filterValue).filter(([k, v]) => (v?.length ?? 0) > 0 || (k === 'assignee' && includeUnassigned)).length
}

/** facet 값만 비운 필터 — 모바일 필터 시트 「전체 해제」. 검색어·완료 보기·에픽 범위는 유지하고 담당자 미지정도 함께 푼다. */
export function clearFacetFilters(filters: IssueFilters): IssueFilters {
  return { ...filters, statuses: [], statusIds: [], priorities: [], labelIds: [], cycleIds: [], typeIds: [], assigneeIds: [], includeUnassigned: false }
}

/**
 * 모바일 뷰 칩 「전체」 판정(WP-194) — 모바일은 에픽 범위(parent/topLevel)를 옆의 「◆ 에픽」 칩이 따로 보여주므로,
 * 저장 뷰가 활성이 아니면서 에픽 범위만 걸린 상태도 「전체」로 본다. 데스크톱 ViewChipBar·저장 뷰 매칭은 isAllActive 그대로.
 * 데스크톱 판정(isAllActive)이 이미 전체인 경우는 호출부가 OR 로 합친다.
 */
export function isAllIgnoringEpicScope(filters: IssueFilters, hasActiveView: boolean): boolean {
  return !hasActiveView && filtersToParams({ ...filters, parentNumber: null, topLevel: false }, 'list', null).toString() === ''
}
