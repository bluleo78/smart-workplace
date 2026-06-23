import { describe, expect, it } from 'vitest'

import { meFacetParams } from './meFacetParams'

// URL SearchParams → /me/issues facet 파라미터 변환. 내 작업 위젯 그룹 딥링크가 의존.
describe('meFacetParams', () => {
  it('status/priority CSV 를 통과시킨다', () => {
    const out = meFacetParams(new URLSearchParams('status=IN_PROGRESS&priority=HIGH'))
    expect(out.status).toBe('IN_PROGRESS')
    expect(out.priority).toBe('HIGH')
  })

  it('blocked=true 를 API blocked 파라미터로 전달한다(막힘 그룹 딥링크)', () => {
    expect(meFacetParams(new URLSearchParams('blocked=true')).blocked).toBe('true')
  })

  it('dueTo/dueFrom 를 직통과시킨다(마감 임박 그룹 딥링크)', () => {
    const out = meFacetParams(new URLSearchParams('dueFrom=2026-06-20&dueTo=2026-06-24'))
    expect(out.dueFrom).toBe('2026-06-20')
    expect(out.dueTo).toBe('2026-06-24')
  })

  it('미지정 필터는 키를 생략한다', () => {
    const out = meFacetParams(new URLSearchParams(''))
    expect(out.blocked).toBeUndefined()
    expect(out.dueTo).toBeUndefined()
    expect(out.status).toBeUndefined()
  })

  it('dueDate=today 특수 토큰은 오늘 범위로 변환한다', () => {
    const out = meFacetParams(new URLSearchParams('dueDate=today'))
    expect(out.dueFrom).toBeDefined()
    expect(out.dueFrom).toBe(out.dueTo)
  })
})
