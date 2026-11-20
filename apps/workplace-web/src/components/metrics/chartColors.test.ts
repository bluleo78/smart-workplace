import { describe, expect, it } from 'vitest'

import { chartColorVar, groupTopN } from './chartColors'

describe('chartColors', () => {
  it('색 인덱스를 CSS 변수 참조로 바꾼다', () => {
    expect(chartColorVar(1)).toBe('var(--chart-1)')
    expect(chartColorVar('other')).toBe('var(--chart-other)')
  })

  const items = [
    { key: 'a', value: 5 },
    { key: 'b', value: 9 },
    { key: 'c', value: 1 },
    { key: 'd', value: 7 },
    { key: 'e', value: 3 },
    { key: 'f', value: 2 },
    { key: 'g', value: 4 },
  ]

  it('상위 n 개와 나머지 합(기타)으로 묶는다', () => {
    const r = groupTopN(items, 5)
    expect(r.top.map((i) => i.key)).toEqual(['b', 'd', 'a', 'g', 'e'])
    expect(r.other).toEqual({ key: 'other', value: 3, count: 2 })
  })

  it('n 개 이하면 기타가 없다', () => {
    expect(groupTopN(items.slice(0, 3), 5).other).toBeNull()
  })

  it('빈 입력', () => {
    expect(groupTopN([], 5)).toEqual({ top: [], other: null })
  })
})
