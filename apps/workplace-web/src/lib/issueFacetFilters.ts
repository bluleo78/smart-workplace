// 이슈 목록 facet 필터 판정 — 모바일 뷰 칩 「전체」 판정의 순수 규칙(WP-412 에서 훅 밖으로 분리).
import type { IssueFilters } from '@/types/issue'

import { filterOnlyKey } from './issueFilters'

/**
 * 모바일 뷰 칩 「전체」 판정(WP-194) — 모바일은 에픽 범위(parent/topLevel)를 옆의 「◆ 에픽」 칩이 따로 보여주므로,
 * 저장 뷰가 활성이 아니면서 에픽 범위만 걸린 상태도 「전체」로 본다. 데스크톱 ViewChipBar·저장 뷰 매칭은 isAllActive 그대로.
 * 데스크톱 판정(isAllActive)이 이미 전체인 경우는 호출부가 OR 로 합친다.
 * 정렬(WP-1238)은 필터가 아니라 보지 않는다 — 데스크톱 「전체」 판정(queryHasNoFilters)과 같다.
 */
export function isAllIgnoringEpicScope(filters: IssueFilters, hasActiveView: boolean): boolean {
  return !hasActiveView && filterOnlyKey({ ...filters, parentNumber: null, topLevel: false }) === ''
}
