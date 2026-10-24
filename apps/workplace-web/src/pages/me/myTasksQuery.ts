// 내 작업 탭·URL → /me/issues 쿼리 파라미터(WP-916). 컴포넌트와 분리(react-refresh) — 페이지와 필터 바가 같은 판정을 쓴다.
import { parseFilters } from '../../lib/issueFilters'
import type { IssueFilters } from '../../types/issue'
import { meFacetParams } from './meFacetParams'

export type MyTasksTab = 'assigned' | 'reported' | 'watched'

/**
 * 할당 탭에서 완료·취소를 숨기는 중인지 — 「완료 모두 보기」 토글 표시와 빈 상태 안내가 같은 판정을 쓴다.
 * 프로젝트 목록과 같은 URL 키(closed=all)로 켜고, 상태 범주 facet 을 고르면 사용자가 상태를 직접 골랐으므로 숨기지 않는다
 * (상태=완료 필터가 숨김에 막혀 빈 목록이 되지 않게).
 */
export function isHidingClosed(params: URLSearchParams): boolean {
  const f = parseFilters(params)
  return !f.showAllClosed && !overridesMyTasksClosedHiding(f)
}

/**
 * 완료 숨김을 무력화하는 명시 필터 — 내 작업은 상태 범주 facet 만 해당한다(프로젝트 목록 issueFilters.overridesClosedHiding 과 같은 구조).
 * 숨김 판정(isHidingClosed)·필터 바 토글(눌림·비활성)·빈 상태 안내가 이 한 곳의 판정을 쓴다 — 손으로 다시 적으면 서로 어긋난다.
 */
export function overridesMyTasksClosedHiding(f: IssueFilters): boolean {
  return f.statuses.length > 0
}

/**
 * 결과를 좁히는 필터가 걸려 있는지 — 빈 결과를 「데이터 없음」이 아니라 「필터 0건 + 필터 초기화」로 보일지 정한다(DS 06 §B).
 * 서버로 보내는 facet(상태·우선순위·마감 범위·오늘 마감·막힘)과 같은 기준이다. closed=all 은 넓히는 쪽이라 필터가 아니다.
 */
export function hasMyTasksFilters(params: URLSearchParams): boolean {
  return Object.keys(meFacetParams(params)).length > 0
}

/** 필터 초기화로 지우는 URL 키 — facet 과 「완료 모두 보기」. 탭은 경로라 그대로 남는다. */
const MY_TASKS_FILTER_KEYS = ['status', 'priority', 'dueFrom', 'dueTo', 'dueDate', 'blocked', 'closed'] as const

/** 필터 초기화 — 필터 키만 지운 새 URLSearchParams(다른 키는 보존). */
export function clearMyTasksFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const key of MY_TASKS_FILTER_KEYS) next.delete(key)
  return next
}

/**
 * 탭·URL → /me/issues 파라미터.
 * 할당: 마감 순 프로젝트 묶음(group=due), 완료 숨김 중이면 hideClosed=true.
 * 내가 만든: 최근 순 프로젝트 묶음(group=recent) — 만든 이력이라 완료도 그대로 보인다.
 * facet(상태·우선순위·마감 범위·막힘)은 meFacetParams 가 그대로 합친다.
 */
export function myTasksQueryParams(tab: 'assigned' | 'reported', params: URLSearchParams): Record<string, string> {
  const facets = meFacetParams(params)
  if (tab === 'reported') return { reporter: 'me', group: 'recent', ...facets }
  return {
    assignee: 'me',
    group: 'due',
    ...(isHidingClosed(params) ? { hideClosed: 'true' } : {}),
    ...facets,
  }
}
