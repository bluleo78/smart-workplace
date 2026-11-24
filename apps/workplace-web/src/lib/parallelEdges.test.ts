import { describe, expect, it } from 'vitest'

import { groupByEndpoints, joinEdgeLabels } from './parallelEdges'

describe('groupByEndpoints', () => {
  it('같은 출발·도착 간선을 처음 나온 순서로 묶고 반대 방향은 따로 둔다', () => {
    const groups = groupByEndpoints([
      { from: 'a', to: 'b', label: 'answered' },
      { from: 'b', to: 'a', label: '돌아가기' },
      { from: 'a', to: 'b', label: '오류' },
    ])
    expect(groups.map((g) => [g.from, g.to, joinEdgeLabels(g.members.map((m) => m.label))])).toEqual([
      ['a', 'b', 'answered · 오류'],
      ['b', 'a', '돌아가기'],
    ])
  })
})
