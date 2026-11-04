// 통합 검색(WP-1353)의 최근 검색어 — 맨 앞 추가·중복 제거·5개 상한·지우기.
import { beforeEach, describe, expect, it } from 'vitest'

import { clearRecent, loadRecent, pushRecent } from './recentSearches'

beforeEach(() => clearRecent())

describe('recentSearches', () => {
  it('최신 검색어가 앞에 오고 같은 검색어는 하나로 합쳐 앞으로 올린다', () => {
    pushRecent('a1')
    pushRecent('b2')
    expect(pushRecent('a1')).toEqual(['a1', 'b2'])
    expect(loadRecent()).toEqual(['a1', 'b2'])
  })

  it('5개를 넘으면 오래된 것부터 버린다', () => {
    for (const q of ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']) pushRecent(q)
    expect(loadRecent()).toEqual(['q6', 'q5', 'q4', 'q3', 'q2'])
  })

  it('빈 검색어는 넣지 않고 clearRecent 가 모두 지운다', () => {
    pushRecent('  ')
    expect(loadRecent()).toEqual([])
    pushRecent('x1')
    clearRecent()
    expect(loadRecent()).toEqual([])
  })
})
