// 이슈 목록 facet 판정 단위 테스트(WP-412) — 이전 E2E mobile/issue-list 의
// 「에픽 범위만 걸리면 뷰 칩은 전체」를 대체한다.
import { describe, expect, it } from 'vitest'

import { isAllIgnoringEpicScope } from './issueFacetFilters'
import { parseFilters } from './issueFilters'

const f = (qs: string) => parseFilters(new URLSearchParams(qs))

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
