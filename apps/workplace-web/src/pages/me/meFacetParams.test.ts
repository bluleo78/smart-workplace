import { afterEach, describe, expect, it, vi } from 'vitest'

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

  describe('dueDate=today 의 "오늘" 은 로컬 날짜(#275)', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('로컬 자정 직후에도 UTC 가 아닌 로컬 yyyy-MM-dd 로 dueFrom=dueTo 를 만든다', () => {
      // 로컬 2026-10-15 00:30 — UTC 보다 앞선 시간대(KST 등)에선 UTC 날짜가 아직 10-14 라 toISOString 이면 하루 어긋난다.
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 9, 15, 0, 30))
      const out = meFacetParams(new URLSearchParams('dueDate=today'))
      expect(out).toMatchObject({ dueFrom: '2026-10-15', dueTo: '2026-10-15' })
    })

    it('직접 준 dueFrom/dueTo 보다 dueDate=today 가 우선한다(딥링크는 오늘만)', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 0, 5, 12, 0))
      const out = meFacetParams(new URLSearchParams('dueDate=today&dueFrom=2025-01-01&dueTo=2025-12-31'))
      expect(out).toMatchObject({ dueFrom: '2026-01-05', dueTo: '2026-01-05' })
    })
  })
})
