// 이슈 목록 facet 판정 단위 테스트(WP-412) — 이전 E2E mobile/issue-list 의
// 「담당자 미지정 → 필터 1·전체 해제로 제거」·「에픽 범위만 걸리면 뷰 칩은 전체」를 대체한다.
import { describe, expect, it } from 'vitest'

import { clearFacetFilters, countActiveFacets, isAllIgnoringEpicScope } from './issueFacetFilters'
import { filtersToParams, parseFilters } from './issueFilters'

const f = (qs: string) => parseFilters(new URLSearchParams(qs))

describe('countActiveFacets', () => {
  it('값이 있는 facet 만 센다', () => {
    expect(countActiveFacets({ status: ['TODO'], priority: [], label: [1, 2] }, false)).toBe(2)
  })
  it('담당자 미지정(assignee=null)은 filterValue 에 없어도 담당자 facet 하나로 센다', () => {
    // 실제 filterValue 는 facet 키를 항상 갖는다(값은 빈 배열)
    expect(countActiveFacets({ status: [], assignee: [] }, true)).toBe(1)
    expect(countActiveFacets({ status: [], assignee: [] }, false)).toBe(0)
    // 담당자 값 + 미지정이 함께 있어도 한 번만
    expect(countActiveFacets({ assignee: [3] }, true)).toBe(1)
  })
})

describe('clearFacetFilters', () => {
  it('담당자 미지정까지 풀어 URL 에서 assignee 가 빠지고, 검색어·에픽 범위는 남는다', () => {
    const cleared = clearFacetFilters(f('assignee=null&status=TODO&q=결제&parent=30'))
    const qs = filtersToParams(cleared, 'list', null)
    expect(qs.has('assignee')).toBe(false)
    expect(qs.has('status')).toBe(false)
    expect(qs.get('q')).toBe('결제')
    expect(qs.get('parent')).toBe('30')
  })
  it('완료일 기간(closedIn)도 facet 이라 함께 풀린다(WP-873), 「완료 모두 보기」는 유지', () => {
    const cleared = clearFacetFilters(f('closedIn=last-week&closed=all'))
    const qs = filtersToParams(cleared, 'list', null)
    expect(qs.has('closedIn')).toBe(false)
    expect(qs.get('closed')).toBe('all')
  })
})

describe('isAllIgnoringEpicScope (WP-194)', () => {
  it('에픽 범위(parent)만 걸리면 저장 뷰가 없을 때 「전체」', () => {
    expect(isAllIgnoringEpicScope(f('parent=30'), false)).toBe(true)
  })
  it('에픽 외 조건이 더해지면 「전체」가 아니다', () => {
    expect(isAllIgnoringEpicScope(f('parent=30&status=TODO'), false)).toBe(false)
  })
  it('저장 뷰가 활성이면 에픽 범위만이어도 「전체」가 아니다', () => {
    expect(isAllIgnoringEpicScope(f('parent=30'), true)).toBe(false)
  })
})

describe('clearFacetFilters — 구성요소(WP-933)', () => {
  it('「필터 모두 지우기」에 구성요소와 「구성요소 없음」이 함께 풀린다', () => {
    const cleared = clearFacetFilters(f('component=3,none&q=x'))
    expect(cleared.componentIds).toEqual([])
    expect(cleared.componentNone).toBe(false)
    expect(filtersToParams(cleared, 'list', null).has('component')).toBe(false)
  })
})

describe('clearFacetFilters — 버전(WP-888)', () => {
  it('「필터 모두 지우기」에 수정·영향 버전과 각 「없음」이 함께 풀린다', () => {
    const cleared = clearFacetFilters(f('fixVersion=3,none&affectsVersion=none&q=x'))
    expect(cleared.fixVersionIds).toEqual([])
    expect(cleared.fixVersionNone).toBe(false)
    expect(cleared.affectsVersionNone).toBe(false)
    const p = filtersToParams(cleared, 'list', null)
    expect(p.has('fixVersion')).toBe(false)
    expect(p.has('affectsVersion')).toBe(false)
  })
})
