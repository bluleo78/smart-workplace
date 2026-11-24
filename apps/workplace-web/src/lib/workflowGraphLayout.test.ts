import { describe, expect, it } from 'vitest'

import { mkAskModel, mkModel } from '@/test/kits/projects/workflowRunFixtures'

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
  it('layout_mergesParallelEdgesIntoOneLabel', () => {
    const g = layoutWorkflowGraph(mkAskModel())
    const back = g.edges.filter((e) => e.from === 'work_ask' && e.to === 'work')
    expect(back).toHaveLength(1)
    expect(back[0].label).toBe('answered · 돌아가기')
    expect(back[0].points.length).toBeGreaterThanOrEqual(2)
  })
  it('layout_mergesThreeParallelEdges', () => {
    const m = mkAskModel()
    const ask = m.nodes.find((n) => n.key === 'work_ask')!
    ask.defaultTo = 'work'
    const back = layoutWorkflowGraph(m).edges.filter((e) => e.from === 'work_ask' && e.to === 'work')
    expect(back.map((e) => e.label)).toEqual(['answered · 기본 · 돌아가기'])
  })
  it('layout_keepsOppositeDirectionEdgesSeparate', () => {
    const g = layoutWorkflowGraph(mkModel())
    expect(g.edges.filter((e) => e.from === 'a' && e.to === 'b')).toHaveLength(1)
    expect(g.edges.filter((e) => e.from === 'b' && e.to === 'a').map((e) => e.label)).toEqual(['오류'])
  })
  it('layout_oppositeAskEdgesPlaceLabelsApart', () => {
    // 질문 경로의 갈 때(ask)·돌아올 때(answered · 돌아가기) 선은 방향이 달라 합치지 않는다 — 라벨 자리(중간 꺾임점)도 겹치면 안 된다.
    const g = layoutWorkflowGraph(mkAskModel())
    const mid = (from: string, to: string) => {
      const pts = g.edges.find((e) => e.from === from && e.to === to)!.points
      return pts[Math.floor(pts.length / 2)]
    }
    const go = mid('work', 'work_ask')
    const back = mid('work_ask', 'work')
    expect(Math.hypot(go.x - back.x, go.y - back.y)).toBeGreaterThan(10)
  })
})
