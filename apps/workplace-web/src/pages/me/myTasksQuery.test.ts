import { describe, expect, it } from 'vitest'

import { parseFilters } from '../../lib/issueFilters'
import {
  clearMyTasksFilters,
  hasMyTasksFilters,
  isHidingClosed,
  myTasksQueryParams,
  overridesMyTasksClosedHiding,
} from './myTasksQuery'

// 내 작업 탭·URL → /me/issues 파라미터(WP-916). 할당 탭은 마감 순 묶음 + 완료 숨김, 내가 만든 탭은 최근 순 묶음.
describe('myTasksQueryParams', () => {
  it('할당 기본은 group=due·hideClosed=true', () => {
    expect(myTasksQueryParams('assigned', new URLSearchParams(''))).toEqual({
      assignee: 'me',
      group: 'due',
      hideClosed: 'true',
    })
  })

  it('closed=all 이면 hideClosed 없음', () => {
    const out = myTasksQueryParams('assigned', new URLSearchParams('closed=all'))
    expect(out).toEqual({ assignee: 'me', group: 'due' })
  })

  it('상태 범주 facet 이 있으면 hideClosed 없음', () => {
    const out = myTasksQueryParams('assigned', new URLSearchParams('status=DONE'))
    expect(out.hideClosed).toBeUndefined()
    expect(out.status).toBe('DONE')
  })

  it('내가 만든은 group=recent, hideClosed 없음', () => {
    expect(myTasksQueryParams('reported', new URLSearchParams(''))).toEqual({ reporter: 'me', group: 'recent' })
  })

  it('meFacetParams 의 dueFrom·dueTo·blocked 통과는 유지', () => {
    const out = myTasksQueryParams('assigned', new URLSearchParams('dueFrom=2026-06-20&dueTo=2026-06-24&blocked=true'))
    expect(out.dueFrom).toBe('2026-06-20')
    expect(out.dueTo).toBe('2026-06-24')
    expect(out.blocked).toBe('true')
    expect(out.hideClosed).toBe('true')
  })
})

describe('isHidingClosed', () => {
  it('기본은 숨김, closed=all·상태 범주 선택이면 숨기지 않는다', () => {
    expect(isHidingClosed(new URLSearchParams(''))).toBe(true)
    expect(isHidingClosed(new URLSearchParams('closed=all'))).toBe(false)
    expect(isHidingClosed(new URLSearchParams('status=TODO'))).toBe(false)
  })
})

describe('overridesMyTasksClosedHiding', () => {
  it('상태 범주를 고르면 숨김을 무력화하고, 우선순위·마감 범위는 아니다', () => {
    expect(overridesMyTasksClosedHiding(parseFilters(new URLSearchParams('status=DONE')))).toBe(true)
    expect(overridesMyTasksClosedHiding(parseFilters(new URLSearchParams('priority=HIGH&dueTo=2026-10-30')))).toBe(false)
  })
})

describe('hasMyTasksFilters', () => {
  it('상태·우선순위·마감 범위·오늘 마감·막힘은 필터, closed=all 과 빈 URL 은 아니다', () => {
    for (const q of ['status=TODO', 'priority=HIGH', 'dueFrom=2026-10-01', 'dueTo=2026-10-30', 'dueDate=today', 'blocked=true']) {
      expect(hasMyTasksFilters(new URLSearchParams(q))).toBe(true)
    }
    expect(hasMyTasksFilters(new URLSearchParams(''))).toBe(false)
    expect(hasMyTasksFilters(new URLSearchParams('closed=all'))).toBe(false)
  })
})

describe('clearMyTasksFilters', () => {
  it('필터·완료 보기 키를 지우고 다른 키는 남긴다', () => {
    const out = clearMyTasksFilters(
      new URLSearchParams('status=DONE&priority=HIGH&dueFrom=a&dueTo=b&dueDate=today&blocked=true&closed=all&x=1'),
    )
    expect(out.toString()).toBe('x=1')
  })
})
