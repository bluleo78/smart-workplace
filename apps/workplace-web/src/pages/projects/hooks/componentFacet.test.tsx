// 「구성요소」 facet(WP-933) — 사용 중 구성요소가 없으면 facet 자체가 없고, 「구성요소 없음」·「보관됨」 묶음 순서를 지킨다.
import { describe, expect, it } from 'vitest'

import type { ComponentResponse } from '../../../types/component'
import { buildComponentFacet, componentFacetValue, componentFilterFromFacet } from './componentFacet'

const comp = (id: number, name: string, archived = false): ComponentResponse => ({
  id, name, description: null, defaultAssignee: null, defaultAssigneeValid: true, archived, issueCount: 0,
})

describe('buildComponentFacet', () => {
  it('사용 중 구성요소가 없으면 null — 필터 바에 구성요소가 보이지 않는다', () => {
    expect(buildComponentFacet([])).toBeNull()
    expect(buildComponentFacet([comp(1, 'Old', true)])).toBeNull()
  })

  it('사용 중 구성요소가 없어도 구성요소 필터가 걸려 있으면 남긴다(풀 수 있게)', () => {
    const facet = buildComponentFacet([comp(1, 'Old', true)], true)!
    expect(facet.options.map((o) => o.value)).toEqual(['none', 1])
  })

  it('사용 중(목록 순서) → 「구성요소 없음」 → 「보관됨」 묶음', () => {
    const facet = buildComponentFacet([comp(1, 'A'), comp(2, 'Old', true), comp(3, 'B')])!
    expect(facet.options.map((o) => [o.value, o.label, o.group])).toEqual([
      [1, 'A', undefined],
      [3, 'B', undefined],
      ['none', '구성요소 없음', undefined],
      [2, 'Old', '보관됨'],
    ])
  })
})

describe('구성요소 facet 값 왕복', () => {
  it('id 와 「구성요소 없음」이 facet 값으로 오가며 유지된다', () => {
    const v = componentFacetValue([3, 5], true)
    expect(v).toEqual([3, 5, 'none'])
    expect(componentFilterFromFacet(v)).toEqual({ componentIds: [3, 5], componentNone: true })
    expect(componentFilterFromFacet(undefined)).toEqual({ componentIds: [], componentNone: false })
  })
})
