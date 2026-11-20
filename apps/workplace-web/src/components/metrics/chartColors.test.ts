import { describe, expect, it } from 'vitest'

import { buildChartConfig, chartColorVar, groupTopN, safeColorKey } from './chartColors'

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

describe('safeColorKey / buildChartConfig (WP-1822 후속)', () => {
  it('CSS 식별자로 안전한 키는 그대로, 점·공백 등은 _ 로 바꾼다', () => {
    expect(safeColorKey('a')).toBe('a')
    expect(safeColorKey('ai.tokens')).toBe('ai_tokens')
    expect(safeColorKey('a b@c')).toBe('a_b_c')
  })

  it('안전하지 않은 키는 색 변수 이름이 안전한 항목에 실리고, 원래 키는 라벨 조회용으로 남는다', () => {
    const cfg = buildChartConfig([{ key: 'ai.tokens', label: 'AI', colorIndex: 1 }])
    expect(cfg.ai_tokens).toEqual({ label: 'AI', color: 'var(--chart-1)' })
    expect(cfg['ai.tokens']).toEqual({ label: 'AI' })
  })

  it('안전한 키는 항목이 하나', () => {
    expect(Object.keys(buildChartConfig([{ key: 'a', label: 'A', colorIndex: 2 }]))).toEqual(['a'])
  })
})
