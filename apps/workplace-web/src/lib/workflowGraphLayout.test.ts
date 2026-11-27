import { describe, expect, it } from 'vitest'

import { mkAskModel, mkModel } from '@/test/kits/projects/workflowRunFixtures'

import { layoutCompactRunGraph, layoutWorkflowGraph } from './workflowGraphLayout'
import type { WorkflowModel, WorkflowModelNode } from './workflows'

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

// ---- compact 실행 그래프(WP-2157) ----
const mkNode = (key: string, type: string, extra: Partial<WorkflowModelNode> = {}): WorkflowModelNode => ({
  key, type, use: [], requires: [], outputs: [], outcomes: [], conditions: [], ...extra,
})
const oc = (key: string, to: string) => ({ key, to, requireComment: false })

/** DFB 데모 모델: start→dev(done→review, ask→dev_ask), review(merged→end, rework→dev, ask→review_ask). */
function dfbModel(): WorkflowModel {
  return {
    nodes: [
      mkNode('start', 'start', { outcomes: [oc('go', 'dev')] }),
      mkNode('dev', 'human_task', { name: '개발', outcomes: [oc('done', 'review'), oc('ask', 'dev_ask')] }),
      mkNode('dev_ask', 'human_task', { returnTo: 'dev', outcomes: [oc('answered', 'dev')] }),
      mkNode('review', 'human_task', { name: '리뷰', outcomes: [oc('merged', 'end'), oc('rework', 'dev'), oc('ask', 'review_ask')] }),
      mkNode('review_ask', 'human_task', { returnTo: 'review', outcomes: [oc('answered', 'review')] }),
      mkNode('end', 'end'),
    ],
  } as unknown as WorkflowModel
}

type Box = { x: number; y: number; width: number; height: number }
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

describe('layoutCompactRunGraph', () => {
  it('compactGraph_dropsAskNodesFromMainFlow', () => {
    const g = layoutCompactRunGraph(dfbModel(), 'dev')
    expect(g.nodes.map((n) => n.key)).toEqual(['start', 'dev', 'review', 'end'])
    expect(new Set(g.nodes.map((n) => n.x)).size).toBe(1)
  })
  it('compactGraph_askMarkerBesideOwner', () => {
    const g = layoutCompactRunGraph(dfbModel(), 'dev')
    expect(g.askMarkers).toHaveLength(2)
    expect(g.askCurrent).toBeNull()
    for (const m of g.askMarkers) {
      expect(m.text).toBe('ask → 사람 차례')
      const owner = g.nodes.find((n) => n.key === m.owner)!
      expect(m.x).toBeGreaterThanOrEqual(owner.x + owner.width)
    }
    expect(g.askMarkers.map((m) => m.owner).sort()).toEqual(['dev', 'review'])
  })
  it('compactGraph_currentAskShowsSideNode', () => {
    const g = layoutCompactRunGraph(dfbModel(), 'dev_ask')
    expect(g.askCurrent).toMatchObject({ owner: 'dev', askKey: 'dev_ask', outcome: 'ask' })
    expect(g.askMarkers.map((m) => m.owner)).toEqual(['review'])
  })
  it('compactGraph_questionWaitingDropsEmptyMargin', () => {
    // WP-2157 I1: 대칭 예약이 남기는 빈 여백을 버려 1280 그래프 칸(약 404px)에 들어가야 한다.
    const g = layoutCompactRunGraph(dfbModel(), 'dev_ask')
    expect(g.width).toBeLessThanOrEqual(404)
    const boxes = [...g.nodes, ...g.backLabels, ...g.askMarkers, ...(g.askCurrent ? [g.askCurrent] : [])]
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width).toBeLessThanOrEqual(g.width)
      expect(b.y + b.height).toBeLessThanOrEqual(g.height)
    }
  })
  it('compactGraph_onlyBackEdgeLabeled', () => {
    const g = layoutCompactRunGraph(dfbModel(), null)
    expect(g.backLabels).toHaveLength(1)
    expect(g.backLabels[0].text).toBe('rework → 개발 ↺')
    const backs = g.edges.filter((e) => e.back)
    expect(backs.map((e) => `${e.from}>${e.to}`)).toEqual(['review>dev'])
  })
  it('compactGraph_allBoxesInsideAndNoOverlap', () => {
    for (const cur of [null, 'dev', 'dev_ask']) {
      const g = layoutCompactRunGraph(dfbModel(), cur)
      const boxes: Box[] = [...g.nodes, ...g.backLabels, ...g.askMarkers, ...(g.askCurrent ? [g.askCurrent] : [])]
      for (const b of boxes) {
        expect(b.x).toBeGreaterThanOrEqual(0)
        expect(b.y).toBeGreaterThanOrEqual(0)
        expect(b.x + b.width).toBeLessThanOrEqual(g.width)
        expect(b.y + b.height).toBeLessThanOrEqual(g.height)
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false)
    }
  })
  it('nonStandardAskNodeStaysInMainFlow', () => {
    const m = dfbModel()
    m.nodes.find((n) => n.key === 'dev_ask')!.outcomes.push(oc('skip', 'end'))
    const g = layoutCompactRunGraph(m, null)
    expect(g.nodes.map((n) => n.key)).toContain('dev_ask')
  })
  it('noBackEdgesNoMarkers_minimalGutters', () => {
    const m = { nodes: [mkNode('start', 'start', { outcomes: [oc('go', 'a')] }), mkNode('a', 'human_task', { outcomes: [oc('done', 'end')] }), mkNode('end', 'end')] } as unknown as WorkflowModel
    const g = layoutCompactRunGraph(m, null)
    expect(g.backLabels).toEqual([])
    expect(g.askMarkers).toEqual([])
    expect(g.nodes[0].x).toBe(16)
  })
  const inBoundsNoOverlap = (g: ReturnType<typeof layoutCompactRunGraph>) => {
    const boxes: Box[] = [...g.nodes, ...g.backLabels, ...g.askMarkers, ...(g.askCurrent ? [g.askCurrent] : [])]
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width).toBeLessThanOrEqual(g.width)
      expect(b.y + b.height).toBeLessThanOrEqual(g.height)
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false)
  }
  it('compactGraph_branchingSiblingDoesNotOverlapMarker', () => {
    const m = {
      nodes: [
        mkNode('start', 'start', { outcomes: [oc('go', 'sel')] }),
        mkNode('sel', 'agent', { outcomes: [oc('left', 'l'), oc('right', 'r')] }),
        mkNode('l', 'human_task', { outcomes: [oc('done', 'end'), oc('ask', 'l_ask')] }),
        mkNode('l_ask', 'human_task', { returnTo: 'l', outcomes: [oc('answered', 'l')] }),
        mkNode('r', 'human_task', { outcomes: [oc('done', 'end')] }),
        mkNode('end', 'end'),
      ],
    } as unknown as WorkflowModel
    for (const cur of ['l', 'l_ask']) inBoundsNoOverlap(layoutCompactRunGraph(m, cur))
  })
  it('compactGraph_multiRankBackEdgeLabelClear', () => {
    const m = {
      nodes: [
        mkNode('a', 'human_task', { name: '가', outcomes: [oc('next', 'b')] }),
        mkNode('b', 'human_task', { outcomes: [oc('next', 'c')] }),
        mkNode('c', 'human_task', { outcomes: [oc('next', 'd')] }),
        mkNode('d', 'human_task', { outcomes: [oc('rework', 'a')] }),
      ],
    } as unknown as WorkflowModel
    const g = layoutCompactRunGraph(m, null)
    expect(g.backLabels).toHaveLength(1)
    inBoundsNoOverlap(g)
  })
  // WP-2157 리뷰: 같은 원래 노드에 질문 결과가 둘이고 하나가 지금이면, 다른 표식은 곁 노드 아래부터 쌓여 겹치지 않는다.
  it('compactGraph_currentSideNodeAndOtherMarkerDoNotOverlap', () => {
    const m = {
      nodes: [
        mkNode('start', 'start', { outcomes: [oc('go', 'w')] }),
        mkNode('w', 'human_task', { outcomes: [oc('done', 'end'), oc('ask', 'a_ask'), oc('clarify', 'a_clarify')] }),
        mkNode('a_ask', 'human_task', { returnTo: 'w', outcomes: [oc('answered', 'w')] }),
        mkNode('a_clarify', 'human_task', { returnTo: 'w', outcomes: [oc('answered', 'w')] }),
        mkNode('end', 'end'),
      ],
    } as unknown as WorkflowModel
    const g = layoutCompactRunGraph(m, 'a_ask')
    expect(g.askCurrent).not.toBeNull()
    expect(g.askMarkers).toHaveLength(1)
    expect(g.askMarkers[0].y).toBeGreaterThanOrEqual(g.askCurrent!.y + g.askCurrent!.height)
    inBoundsNoOverlap(g)
  })
  // WP-2157 리뷰: 질문 모양이어도 returnTo 가 다른 질문 노드면 곁에 붙일 곳이 없어 본 흐름에 남는다(사라지지 않는다).
  it('compactGraph_askNodeReturningToAskNodeStaysInMainFlow', () => {
    const m = {
      nodes: [
        mkNode('start', 'start', { outcomes: [oc('go', 'w')] }),
        mkNode('w', 'human_task', { outcomes: [oc('done', 'end'), oc('ask', 'q1')] }),
        mkNode('q1', 'human_task', { returnTo: 'w', outcomes: [oc('answered', 'w'), ] }),
        mkNode('q2', 'human_task', { returnTo: 'q1', outcomes: [oc('answered', 'q1')] }),
        mkNode('end', 'end'),
      ],
    } as unknown as WorkflowModel
    const g = layoutCompactRunGraph(m, 'q2')
    expect(g.nodes.map((n) => n.key)).toContain('q2')
    expect(g.nodes.map((n) => n.key)).not.toContain('q1')
  })
})
