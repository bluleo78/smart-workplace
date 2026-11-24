import { describe, expect, it } from 'vitest'

import { mkModel } from '@/test/kits/projects/workflowRunFixtures'

import { layoutWorkflowGraph } from './workflowGraphLayout'

describe('layoutWorkflowGraph', () => {
  it('layout_placesEveryNodeAndEdge', () => {
    const g = layoutWorkflowGraph(mkModel())
    expect(g.nodes).toHaveLength(4)
    for (const n of g.nodes) {
      expect(Number.isFinite(n.x)).toBe(true)
      expect(Number.isFinite(n.y)).toBe(true)
    }
    // start→a, a→b, b→end, b.onError→a. 없는 노드(ghost)로 가는 outcome 은 뺀다.
    expect(g.edges).toHaveLength(4)
    expect(g.edges.map((e) => e.label)).toContain('오류')
    expect(g.edges.some((e) => e.to === 'ghost')).toBe(false)
  })
})
