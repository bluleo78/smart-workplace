// 편집 그래프 배치(WP-2089) 검증 — 겹침 없음, 공통 오류 목적지, 질문 경로 접기, 되돌아가는 선 표시.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  commonErrorTarget,
  computeGraphLayout,
  drawnEdge,
  flowHandles,
  type GraphLayoutResult,
  isAtLayoutPosition,
  isShapeNode,
  labelWidth,
  nodeSize,
  pickHandles,
  questionNodeKeys,
  routedPoints,
  SHAPE_SIZE,
  visibleGraph,
} from './graphLayout'
import { addAskPath, autoLayout, type GraphEdge, type GraphNode, parseWorkflowGraph, placeNodes, type WorkflowGraph } from './graphYaml'

const yaml = readFileSync(new URL('../../../../../../docs/workflows/ai-dev-flow.yaml', import.meta.url), 'utf8')

function aiDevGraph(): WorkflowGraph {
  const r = parseWorkflowGraph(yaml)
  if ('error' in r) throw new Error(r.error)
  return r.graph
}

interface Rect { x: number; y: number; w: number; h: number }

/** 두 사각형이 1px 이상 떨어져 있지 않으면 겹친 것으로 본다. */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w + 1 && b.x < a.x + a.w + 1 && a.y < b.y + b.h + 1 && b.y < a.y + a.h + 1
}

/** 노드끼리, 그리고 간선 라벨과 노드가 겹치는 곳을 모두 모아 돌려준다(비어 있어야 통과). */
function findOverlaps(layout: GraphLayoutResult): string[] {
  const found: string[] = []
  const nodes = [...layout.positions].map(([key, p]) => {
    const s = layout.sizes.get(key)!
    return { key, rect: { x: p.x, y: p.y, w: s.width, h: s.height } }
  })
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (overlaps(nodes[i].rect, nodes[j].rect)) found.push(`node ${nodes[i].key} x ${nodes[j].key}`)
    }
  }
  for (const e of layout.edges) {
    if (!e.labelPos) continue
    const w = labelWidth(e.label)
    const lr = { x: e.labelPos.x - w / 2, y: e.labelPos.y - 9, w, h: 18 }
    for (const n of nodes) if (overlaps(lr, n.rect)) found.push(`label "${e.label}" x ${n.key}`)
  }
  return found
}

/** 선분이 사각형 안쪽(경계에서 0.5px 들어간 곳)을 지나는지 — Liang–Barsky 로 잘라 남는 길이가 있으면 지난다. */
function segmentEntersRect(p: { x: number; y: number }, q: { x: number; y: number }, r: Rect): boolean {
  const x0 = r.x + 0.5
  const x1 = r.x + r.w - 0.5
  const y0 = r.y + 0.5
  const y1 = r.y + r.h - 0.5
  const dx = q.x - p.x
  const dy = q.y - p.y
  let t0 = 0
  let t1 = 1
  const clip = (pp: number, qq: number) => {
    if (pp === 0) return qq >= 0
    const t = qq / pp
    if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t } else { if (t < t0) return false; if (t < t1) t1 = t }
    return true
  }
  if (!clip(-dx, p.x - x0) || !clip(dx, x1 - p.x) || !clip(-dy, p.y - y0) || !clip(dy, y1 - p.y)) return false
  return t1 - t0 > 1e-6
}

/** 그릴 점(routedPoints)이 양 끝 노드 안을 지나거나, 마지막 선분이 도착 노드 쪽을 향하지 않는 간선을 모은다. */
function findCrossingEdges(g: WorkflowGraph, showAsk: boolean): string[] {
  const view = visibleGraph(g, { showAsk })
  const layout = computeGraphLayout(view)
  const shapeKeys = new Set(view.nodes.filter(isShapeNode).map((n) => n.key))
  const rectOf = (key: string): Rect => {
    const p = layout.positions.get(key)!
    const s = layout.sizes.get(key)!
    return { x: p.x, y: p.y, w: s.width, h: s.height }
  }
  const bad: string[] = []
  for (const e of layout.edges) {
    if (e.from === e.to) continue
    const pts = routedPoints(e, layout, shapeKeys)
    for (let i = 0; i + 1 < pts.length; i++) {
      for (const key of [e.from, e.to]) {
        if (segmentEntersRect(pts[i], pts[i + 1], rectOf(key))) bad.push(`${e.from}→${e.to} 선분 ${i} 이 ${key} 를 지남`)
      }
    }
    // 화살표 방향 — 마지막 선분이 도착 노드(마름모·원이면 도형) 가운데 쪽으로 간다
    const last = pts[pts.length - 1]
    const prev = pts[pts.length - 2]
    const r = rectOf(e.to)
    const cx = shapeKeys.has(e.to) ? r.x + SHAPE_SIZE / 2 : r.x + r.w / 2
    const toCenter = { x: cx - last.x, y: r.y + r.h / 2 - last.y }
    if ((last.x - prev.x) * toCenter.x + (last.y - prev.y) * toCenter.y <= 0) bad.push(`${e.from}→${e.to} 화살표가 도착 노드를 향하지 않음`)
  }
  return bad
}

describe('graphLayout', () => {
  it('layout_aiDevFlow_noOverlap_collapsed', () => {
    const layout = computeGraphLayout(visibleGraph(aiDevGraph(), { showAsk: false }))
    expect(findOverlaps(layout)).toEqual([])
  })

  it('layout_aiDevFlow_noOverlap_expanded', () => {
    const layout = computeGraphLayout(visibleGraph(aiDevGraph(), { showAsk: true }))
    expect(findOverlaps(layout)).toEqual([])
  })

  it('layout_longNames_noOverlap', () => {
    const long = '가'.repeat(40)
    const nodes: GraphNode[] = [
      { key: 'start', type: 'start' },
      { key: 'd', type: 'decision', name: long },
      { key: 'a', type: 'agent_task', name: long },
      { key: 'b', type: 'agent_task', name: long },
      { key: 'end', type: 'end' },
    ]
    const mk = (from: string, to: string, label: string): GraphEdge => ({ id: `${from}->${to}`, from, to, kind: 'outcome', label })
    const edges = [mk('start', 'd', ''), mk('d', 'a', long), mk('d', 'b', long), mk('a', 'end', 'ok'), mk('b', 'end', 'ok')]
    const layout = computeGraphLayout(visibleGraph({ nodes, edges, roles: [], shared: [] }, { showAsk: true }))
    expect(findOverlaps(layout)).toEqual([])
  })

  it('commonErrorTarget_aiDevFlow', () => {
    expect(commonErrorTarget(aiDevGraph())).toBe('triage')
  })

  it('commonErrorTarget_singleOrScattered_null', () => {
    const mk = (from: string, to: string): GraphEdge => ({ id: `${from}->${to}`, from, to, kind: 'onError', label: '오류' })
    const base = { nodes: [], roles: [], shared: [] }
    expect(commonErrorTarget({ ...base, edges: [mk('a', 'x')] })).toBeNull()
    expect(commonErrorTarget({ ...base, edges: [mk('a', 'x'), mk('b', 'y'), mk('c', 'z')] })).toBeNull()
  })

  it('commonErrorTarget_missingNode_null', () => {
    // 오타로 없는 노드를 가리키는 onError 는 공통 목적지가 되지 않는다(숨기면 끊긴 연결이 안 보인다)
    const mk = (from: string, to: string): GraphEdge => ({ id: `${from}->${to}`, from, to, kind: 'onError', label: '오류' })
    const node = (key: string) => ({ key, name: key, type: 'ai_task' }) as GraphNode
    const g = { nodes: [node('a'), node('b'), node('c')], roles: [], shared: [], edges: [mk('a', 'triag'), mk('b', 'triag'), mk('c', 'triag')] }
    expect(commonErrorTarget(g)).toBeNull()
  })

  it('visibleGraph_askToVisibleNode_keepsEdge', () => {
    // 흐름이 있는 노드(review)로 가는 ask 선은 접어도 남기고, 숨는 질문 노드로 가는 ask 선만 뺀다
    const node = (key: string) => ({ key, name: key, type: 'human_task' }) as GraphNode
    const e = (from: string, to: string, kind: GraphEdge['kind']): GraphEdge => ({ id: `${from}-${kind}-${to}`, from, to, kind, label: '' })
    const g = {
      nodes: [node('dev'), node('dev_ask'), node('review'), node('done')], roles: [], shared: [],
      edges: [
        e('dev', 'dev_ask', 'ask'), e('dev_ask', 'dev', 'outcome'),
        e('dev', 'review', 'ask'), e('review', 'done', 'outcome'),
      ],
    }
    const v = visibleGraph(g, { showAsk: false })
    expect(v.nodes.some((n) => n.key === 'review')).toBe(true)
    expect(v.edges.some((x) => x.from === 'dev' && x.to === 'review' && x.kind === 'ask')).toBe(true)
    expect(v.edges.some((x) => x.to === 'dev_ask')).toBe(false)
  })

  it('commonErrorTarget_onlyOnErrorIncoming_null', () => {
    // onError 로만 닿는 목적지를 숨기면 그 노드가 고아가 되므로 공통 목적지로 보지 않는다
    const node = (key: string) => ({ key, name: key, type: 'ai_task' }) as GraphNode
    const e = (from: string, to: string, kind: GraphEdge['kind']): GraphEdge => ({ id: `${from}-${kind}-${to}`, from, to, kind, label: '' })
    const onErr = [e('a', 'rec', 'onError'), e('b', 'rec', 'onError'), e('c', 'rec', 'onError')]
    const base = { nodes: [node('start'), node('a'), node('b'), node('c'), node('rec')], roles: [], shared: [] }
    expect(commonErrorTarget({ ...base, edges: onErr })).toBeNull()
    expect(commonErrorTarget({ ...base, edges: [...onErr, e('start', 'rec', 'outcome')] })).toBe('rec')
  })

  it('commonErrorTarget_onlyAskShorthandReturn_null', () => {
    // ask 줄임 표기의 가상 질문 노드가 되돌아오는 선(returnTo)은 접으면 함께 숨는다 — 그것만으로 닿는 목적지는 공통 처리하면 고아가 된다
    const base = (extra: string) =>
      `nodes:\n  start: { type: start }\n  a: { type: agent_task, onError: { to: triage } }\n  b: { type: agent_task, onError: { to: triage } }\n  c: { type: agent_task, onError: { to: triage } }\n  triage: { type: human_task, ask: { role: x } }\nstart:\n  - { to: a }\n${extra}`
    const graphOf = (y: string) => {
      const r = parseWorkflowGraph(y)
      if ('error' in r) throw new Error(r.error)
      return r.graph
    }
    const g = graphOf(base(''))
    expect(g.edges.some((e) => e.from === 'triage_ask' && e.to === 'triage' && e.kind === 'returnTo')).toBe(true)
    expect(commonErrorTarget(g)).toBeNull()
    const g2 = graphOf(base('').replace('  - { to: a }', '  - { to: a }\n  - { to: triage }'))
    expect(commonErrorTarget(g2)).toBe('triage')
  })

  it('computeGraphLayout_labelOrKindChange_newResult', () => {
    // 캐시 키에 간선 라벨·종류가 들어 있어야 바뀐 선이 옛 배치로 그려지지 않는다
    const v = visibleGraph(aiDevGraph(), { showAsk: false })
    const base = computeGraphLayout(v)
    const withEdge = (patch: Partial<GraphEdge>) => ({ ...v, edges: v.edges.map((e, i) => (i === 0 ? { ...e, ...patch } : e)) })
    expect(computeGraphLayout(withEdge({ label: '완전히 다른 긴 라벨 문구' }))).not.toBe(base)
    expect(computeGraphLayout(withEdge({ kind: v.edges[0].kind === 'onError' ? 'outcome' : 'onError' }))).not.toBe(base)
  })

  it('computeGraphLayout_sameStructure_reusesResult', () => {
    // 같은 구조(이름·크기·간선)면 dagre 를 다시 돌리지 않고 같은 결과 객체를 돌려준다
    const g1 = aiDevGraph()
    const v1 = visibleGraph(g1, { showAsk: false })
    const g2 = { ...g1, nodes: g1.nodes.map((n, i) => (i === 0 ? { ...n, hasDefault: !n.hasDefault } : n)) }
    const v2 = visibleGraph(g2, { showAsk: false })
    expect(computeGraphLayout(v1)).toBe(computeGraphLayout(v2))
    // 크기가 이름 길이를 따르는 도형 노드(분기·시작·종료)의 이름을 바꾼다
    const shape = g1.nodes.find((n) => isShapeNode(n))!.key
    const g3 = { ...g1, nodes: g1.nodes.map((n) => (isShapeNode(n) && n.key === shape ? { ...n, name: `${n.name ?? n.key} 아주 길게 바꾼 이름입니다` } : n)) }
    expect(computeGraphLayout(visibleGraph(g3, { showAsk: false }))).not.toBe(computeGraphLayout(v1))
  })

  it('questionNodeKeys_askOnlyNodeWithOwnFlow_staysVisible', () => {
    // ask 로만 닿아도 나가는 흐름이 따로 있으면 흐름의 일부라 접어도 보인다. 물은 노드로만 돌아가면 숨긴다.
    const node = (key: string) => ({ key, name: key, type: 'human_task' }) as GraphNode
    const e = (from: string, to: string, kind: GraphEdge['kind'], label = ''): GraphEdge => ({ id: `${from}-${kind}-${to}`, from, to, kind, label })
    const g = {
      nodes: [node('dev'), node('dev_ask'), node('review'), node('done')], roles: [], shared: [],
      edges: [
        e('dev', 'dev_ask', 'ask', 'ask'), e('dev_ask', 'dev', 'outcome', 'answered'),
        e('dev', 'review', 'ask', 'ask'), e('review', 'done', 'outcome', 'ok'),
      ],
    }
    const keys = questionNodeKeys(g)
    expect(keys.has('dev_ask')).toBe(true)
    expect(keys.has('review')).toBe(false)
  })

  it('visibleGraph_collapsed_hidesQuestionPathsAndCommonErrors', () => {
    const g = aiDevGraph()
    const v = visibleGraph(g, { showAsk: false })
    expect(v.nodes.some((n) => n.virtual)).toBe(false)
    expect(v.edges.some((e) => e.kind === 'ask')).toBe(false)
    expect(v.commonErrorTo).toBe('triage')
    expect(v.edges.some((e) => e.kind === 'onError' && e.to === 'triage')).toBe(false)
    const hosts = new Set(g.edges.filter((e) => e.kind === 'ask').map((e) => e.from))
    expect(hosts.size).toBeGreaterThan(0)
    expect(v.askHosts.size).toBe(hosts.size)
  })

  it('visibleGraph_expanded_keepsQuestionNodes', () => {
    const g = aiDevGraph()
    const v = visibleGraph(g, { showAsk: true })
    const virtuals = g.nodes.filter((n) => n.virtual)
    expect(virtuals.length).toBeGreaterThan(0)
    for (const n of virtuals) expect(v.nodes.some((x) => x.key === n.key)).toBe(true)
  })

  it.each([false, true])('layout_backEdges_dashedAndMarked (showAsk=%s)', (showAsk) => {
    const layout = computeGraphLayout(visibleGraph(aiDevGraph(), { showAsk }))
    const backs = layout.edges.filter((e) => /revise|changes|rework/.test(e.label))
    expect(backs.length).toBeGreaterThan(0)
    for (const e of backs) {
      expect(e.back).toBe(true)
      expect(e.back || e.kindDashed).toBe(true)
    }
    const first = layout.edges.find((e) => e.from === 'start')
    expect(first).toBeDefined()
    expect(first!.back).toBe(false)
  })

  // 간선 fallback 판정 — 저장 좌표는 반올림 정수라 1px 이내는 같은 자리로 본다. 옮겼거나 자리가 없으면 기본 경로로 그린다.
  it('edge_fallsBackWhenEndpointMoved (isAtLayoutPosition)', () => {
    const laid = { x: 120.4, y: 80.5 }
    expect(isAtLayoutPosition({ x: 120.4, y: 80.5 }, laid)).toBe(true)
    expect(isAtLayoutPosition({ x: 120, y: 81 }, laid)).toBe(true)
    expect(isAtLayoutPosition({ x: 140, y: 81 }, laid)).toBe(false)
    expect(isAtLayoutPosition({ x: 120, y: 95 }, laid)).toBe(false)
    expect(isAtLayoutPosition(undefined, laid)).toBe(false)
    expect(isAtLayoutPosition({ x: 120, y: 81 }, undefined)).toBe(false)
  })

  // 손잡이 — 위(s-top)·아래(s-bottom) 모두 source 형이다(들어옴 형 t-* 는 없다). 카드는 가운데 x, 마름모는 도형 가운데 x 에 맞추고 아래 손잡이는 맨 아랫줄에 둔다(끝점 = x + 0.5)
  it('flowHandles_topBottom_shapeCenter', () => {
    const card = flowHandles({ key: 'a', type: 'agent_task' }).filter((h) => h.id === 's-top' || h.id === 's-bottom')
    expect(card.map((h) => [h.type, h.position, h.x + 0.5, h.y])).toEqual([['source', 'top', 100, 0], ['source', 'bottom', 100, 63]])
    const diamond = flowHandles({ key: 'p', type: 'decision', name: '아주 긴 분기 이름' })
    const tb = diamond.filter((h) => h.id === 's-top' || h.id === 's-bottom')
    expect(tb.map((h) => h.x + 0.5)).toEqual([20, 20])
    expect(tb[1].y + 1).toBe(40)
  })

  // 리뷰 — 되돌림 선이 손잡이로 바꿔 끼운 끝점 때문에 양 끝 노드를 가로지르면 안 된다(dagre 가 방향을 뒤집어 배치한다)
  it.each([false, true])('routedPoints_aiDevFlow_noEdgeCrossesItsEndpoints (showAsk=%s)', (showAsk) => {
    const g = aiDevGraph()
    const layout = computeGraphLayout(visibleGraph(g, { showAsk }))
    expect(layout.edges.some((e) => e.back && /revise|changes|rework/.test(e.label))).toBe(true)
    expect(findCrossingEdges(g, showAsk)).toEqual([])
  })

  it('routedPoints_backEdge_smallChain_staysOutsideNodes', () => {
    const r = parseWorkflowGraph(`nodes:
  start: { type: start }
  a: { type: agent_task, name: 가, outcomes: { next: { to: b } } }
  b: { type: agent_task, name: 나, outcomes: { next: { to: c } } }
  c: { type: agent_task, name: 다, outcomes: { again: { to: a }, done: { to: pick } } }
  pick: { type: decision, name: 고르기, conditions: [{ when: { context: c.ok, equals: true }, to: a }], default: end }
  end: { type: end, name: 끝 }
start:
  - { to: a }
`)
    if ('error' in r) throw new Error(r.error)
    const layout = computeGraphLayout(visibleGraph(r.graph, { showAsk: false }))
    const back = layout.edges.find((e) => e.from === 'c' && e.to === 'a')
    expect(back?.back).toBe(true)
    expect(findCrossingEdges(r.graph, false)).toEqual([])
    // 되돌림 선은 도착 노드의 아래 변으로 들어온다(위로 올라가며 화살표가 노드를 가리킨다)
    const pts = routedPoints(back!, layout, new Set(['start', 'pick', 'end']))
    const a = layout.positions.get('a')!
    expect(pts[pts.length - 1].y).toBeCloseTo(a.y + 64, 0)
  })
})

describe('placeNodes 질문 경로 펼침', () => {
  // 자동 정렬 직후(접힘 기준 좌표가 저장된 상태)에 질문 경로를 펼쳐도 노드가 겹치지 않고 펼침 배치 자리를 쓴다
  it('showAsk_usesExpandedLayoutForEveryNode', () => {
    const r = parseWorkflowGraph(autoLayout(yaml))
    if ('error' in r) throw new Error(r.error)
    const placed = placeNodes(r.graph, { showAsk: true })
    for (const [key, p] of placed.positions) expect(p).toEqual(placed.layout.positions.get(key))
    expect(findOverlaps({ ...placed.layout, positions: placed.positions })).toEqual([])
    // 접힘 보기는 저장 좌표를 그대로 쓴다
    const collapsed = placeNodes(r.graph)
    for (const n of collapsed.view.nodes) if (!n.virtual && n.position) expect(collapsed.positions.get(n.key)).toEqual(n.position)
  })

  it('pickHandles_verticalBelow_usesBottomTop', () => {
    expect(pickHandles({ x: 0, y: 0, width: 200, height: 64 }, { x: 0, y: 200, width: 200, height: 64 }))
      .toEqual({ sourceHandle: 's-bottom', targetHandle: 's-top' })
  })

  it('pickHandles_targetAbove_usesTopBottom', () => {
    expect(pickHandles({ x: 0, y: 300, width: 200, height: 64 }, { x: 0, y: 0, width: 200, height: 64 }))
      .toEqual({ sourceHandle: 's-top', targetHandle: 's-bottom' })
  })

  it('pickHandles_horizontalNeighbor_usesRightLeft', () => {
    const a = { x: 0, y: 0, width: 200, height: 64 }
    expect(pickHandles(a, { x: 240, y: 0, width: 200, height: 64 })).toEqual({ sourceHandle: 's-right', targetHandle: 's-left' })
    expect(pickHandles({ x: 240, y: 0, width: 200, height: 64 }, a)).toEqual({ sourceHandle: 's-left', targetHandle: 's-right' })
  })

  it('flowHandles_hasFourSidesEach', () => {
    const ids = ['s-top', 's-bottom', 's-left', 's-right']
    const card = flowHandles({ key: 'a', type: 'agent_task' })
    expect(card.map((h) => h.id).sort()).toEqual([...ids].sort())
    const shape = flowHandles({ key: 'd', type: 'decision' })
    expect(shape.map((h) => h.id).sort()).toEqual([...ids].sort())
    const at = (id: string) => shape.find((h) => h.id === id)!
    // 손잡이는 1×1 이라 x 는 중심 - 0.5
    expect(at('s-top').x + 0.5).toBe(SHAPE_SIZE / 2)
    expect(at('s-bottom').x + 0.5).toBe(SHAPE_SIZE / 2)
    expect(at('s-left').x + 0.5).toBe(0)
    expect(at('s-right').x + 0.5).toBe(SHAPE_SIZE)
  })

  // 같은 자리에 손잡이가 둘이면 느슨한 모드의 가장 가까운 손잡이 고르기가 연결 불가 쪽을 잡는다(WP-2089)
  it.each([{ key: 'a', type: 'agent_task' }, { key: 'd', type: 'decision' }] as const)('flowHandles_noTwoAtSamePosition (%j)', (n) => {
    const spots = flowHandles(n).map((h) => `${h.x},${h.y}`)
    expect(new Set(spots).size).toBe(spots.length)
  })

  it('layout_forwardEdges_doNotCrossOtherNodes', () => {
    const view = visibleGraph(aiDevGraph(), { showAsk: false })
    const layout = computeGraphLayout(view)
    const shapeKeys = new Set(view.nodes.filter(isShapeNode).map((n) => n.key))
    const bad: string[] = []
    for (const e of layout.edges) {
      if (e.back || e.from === e.to) continue
      const pts = routedPoints(e, layout, shapeKeys)
      for (const key of layout.positions.keys()) {
        if (key === e.from || key === e.to) continue
        const p = layout.positions.get(key)!
        const s = layout.sizes.get(key)!
        // 2px 안쪽으로 줄인 상자 — segmentEntersRect 가 0.5px 더 줄이므로 1.5px 를 더 준다
        const r = { x: p.x + 1.5, y: p.y + 1.5, w: s.width - 3, h: s.height - 3 }
        for (let i = 0; i + 1 < pts.length; i++) {
          if (segmentEntersRect(pts[i], pts[i + 1], r)) bad.push(`${e.from}→${e.to} 이 ${key} 를 지남`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('visibleGraph_askHosts_onlyWhenAskEdgeHidden', () => {
    // A→B ask(B 에 자기 흐름) 는 선이 남으므로 💬 대상이 아니고, A→q ask(질문 노드)는 선이 숨으므로 대상이다
    const node = (key: string) => ({ key, name: key, type: 'human_task' }) as GraphNode
    const e = (from: string, to: string, kind: GraphEdge['kind'], label = ''): GraphEdge => ({ id: `${from}-${kind}-${to}`, from, to, kind, label })
    const g1 = { nodes: [node('a'), node('b'), node('c')], roles: [], shared: [], edges: [e('a', 'b', 'ask'), e('b', 'c', 'outcome')] }
    expect(visibleGraph(g1, { showAsk: false }).askHosts.has('a')).toBe(false)
    const g2 = { nodes: [node('a'), node('q')], roles: [], shared: [], edges: [e('a', 'q', 'ask'), e('q', 'a', 'outcome')] }
    expect(visibleGraph(g2, { showAsk: false }).askHosts.has('a')).toBe(true)
  })

  it('questionNodeKeys_noOutgoingEdges_notQuestionNode', () => {
    const node = (key: string) => ({ key, name: key, type: 'human_task' }) as GraphNode
    const g = {
      nodes: [node('a'), node('q')], roles: [], shared: [],
      edges: [{ id: 'a-ask-q', from: 'a', to: 'q', kind: 'ask' as const, label: '' }],
    }
    expect(questionNodeKeys(g).has('q')).toBe(false)
  })
})

describe('computeGraphLayout 평행 간선', () => {
  const node = (key: string) => ({ key, name: key, type: 'human_task' }) as GraphNode
  const e = (id: string, from: string, to: string, kind: GraphEdge['kind'], label: string): GraphEdge => ({ id, from, to, kind, label })
  const lay = (nodes: string[], edges: GraphEdge[]) =>
    computeGraphLayout(visibleGraph({ nodes: nodes.map(node), roles: [], shared: [], edges }, { showAsk: true })).edges

  it('같은 출발·도착은 한 간선·라벨 「 · 」 로 잇고, 하나라도 점선 종류면 점선이다', () => {
    const out = lay(['a', 'b'], [e('1', 'a', 'b', 'outcome', 'x'), e('2', 'a', 'b', 'outcome', 'y'), e('3', 'a', 'b', 'onError', '오류')])
    expect(out).toHaveLength(1)
    expect(out[0].label).toBe('x · y · 오류')
    expect(out[0].kindDashed).toBe(true)
  })

  it('점선 종류가 없으면 점선이 아니고, 빈 라벨은 빼고 잇는다', () => {
    const out = lay(['a', 'b'], [e('1', 'a', 'b', 'outcome', 'y'), e('2', 'a', 'b', 'default', ''), e('3', 'a', 'b', 'outcome', '기본')])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('1')
    expect(out[0].label).toBe('y · 기본')
    expect(out[0].kindDashed).toBe(false)
  })

  it('반대 방향 간선은 합치지 않는다', () => {
    const out = lay(['a', 'b'], [e('1', 'a', 'b', 'ask', 'ask'), e('2', 'b', 'a', 'outcome', 'answered')])
    expect(out.map((x) => [x.from, x.to])).toEqual([['a', 'b'], ['b', 'a']])
  })

  it('한쪽 끝 노드가 없는 간선은 뺀다', () => {
    const out = lay(['a', 'b'], [e('1', 'a', 'zz', 'outcome', 'x'), e('2', 'a', 'b', 'outcome', 'y')])
    expect(out.map((x) => x.id)).toEqual(['2'])
  })

  it('addAskPath 로 만든 질문 노드의 answered + returnTo 는 한 간선이다', () => {
    const g = parseWorkflowGraph(addAskPath(`schema: genia/workflow@1
name: t
roles:
  owner: { name: 확인자 }
nodes:
  dev: { type: agent_task, name: 개발, role: owner, outcomes: { ok: { to: done } } }
  done: { type: end }
`, 'dev'))
    if ('error' in g) throw new Error(g.error)
    const back = computeGraphLayout(visibleGraph(g.graph, { showAsk: true })).edges.filter((x) => x.from === 'dev_ask' && x.to === 'dev')
    expect(back).toHaveLength(1)
    expect(back[0].label).toContain(' · ')
    expect(back[0].kindDashed).toBe(true)
  })
})

describe('질문 노드 옆 배치 (WP-2123)', () => {
  const mk = (from: string, to: string, kind: GraphEdge['kind'], label = ''): GraphEdge => ({ id: `${from}->${to}`, from, to, kind, label })
  const node = (key: string, type = 'agent_task'): GraphNode => ({ key, name: key, type }) as GraphNode
  const graphOf = (nodes: GraphNode[], edges: GraphEdge[]): WorkflowGraph => ({ nodes, edges, roles: [], shared: [] })
  const layoutOf = (g: WorkflowGraph, showAsk = true) => computeGraphLayout(visibleGraph(g, { showAsk }))
  const box = (l: GraphLayoutResult, key: string) => {
    const p = l.positions.get(key)!
    const s = l.sizes.get(key)!
    return { left: p.x, right: p.x + s.width, top: p.y, bottom: p.y + s.height, cy: p.y + s.height / 2 }
  }
  /** start → dev·docs → review → end 흐름에 dev 가 질문 노드 q... 를 갖는 그래프. */
  function askGraph(qs: string[] = ['q'], devType = 'agent_task'): WorkflowGraph {
    const nodes = [node('start', 'start'), node('dev', devType), node('docs'), node('review'), node('end', 'end'), ...qs.map((q) => node(q, 'human_task'))]
    const edges = [
      mk('start', 'dev', 'outcome'), mk('start', 'docs', 'outcome'), mk('dev', 'review', 'outcome'), mk('docs', 'review', 'outcome'), mk('review', 'end', 'outcome'),
      ...qs.flatMap((q) => [mk('dev', q, 'ask', '질문'), mk(q, 'dev', 'returnTo', '돌아가기')]),
    ]
    return graphOf(nodes, edges)
  }

  it('sideAsk_centerYMatchesAsker', () => {
    const l = layoutOf(askGraph())
    expect(Math.abs(box(l, 'q').cy - box(l, 'dev').cy)).toBeLessThan(0.5)
    expect(box(l, 'q').left).toBeGreaterThan(box(l, 'dev').right)
  })

  it('sideAsk_gapAtLeastLabelWidth', () => {
    const l = layoutOf(askGraph())
    const widest = Math.max(labelWidth('돌아가기'), labelWidth('질문'))
    const gap = box(l, 'q').left - box(l, 'dev').right
    expect(gap).toBeGreaterThanOrEqual(widest)
    // 간격 = 가장 넓은 라벨 + 24, 단 최소 48
    expect(gap).toBeCloseTo(Math.max(48, widest + 24), 5)
  })

  it('sideAsk_noOverlapWithSiblings', () => {
    expect(findOverlaps(layoutOf(askGraph()))).toEqual([])
  })

  it('sideAsk_mainRanksStableWhenToggled', () => {
    const g = askGraph()
    const on = layoutOf(g, true)
    const off = layoutOf(g, false)
    for (const key of ['start', 'dev', 'docs', 'review', 'end']) {
      expect(Math.abs(box(on, key).cy - box(off, key).cy)).toBeLessThan(0.5)
    }
  })

  it('sideAsk_sharedQuestionNode_notSide', () => {
    const g = graphOf(
      [node('start', 'start'), node('a'), node('b'), node('end', 'end'), node('q', 'human_task')],
      [
        mk('start', 'a', 'outcome'), mk('start', 'b', 'outcome'), mk('a', 'end', 'outcome'), mk('b', 'end', 'outcome'),
        mk('a', 'q', 'ask', '질문'), mk('b', 'q', 'ask', '질문'), mk('q', 'a', 'returnTo', '돌아가기'), mk('q', 'b', 'returnTo', '돌아가기'),
      ],
    )
    const l = layoutOf(g)
    expect(Math.abs(box(l, 'q').cy - box(l, 'a').cy)).toBeGreaterThan(1)
    expect(Math.abs(box(l, 'q').cy - box(l, 'b').cy)).toBeGreaterThan(1)
    expect(findOverlaps(l)).toEqual([])
  })

  it('sideAsk_multipleStackedVertically', () => {
    const l = layoutOf(askGraph(['q1', 'q2']))
    const [q1, q2, dev] = [box(l, 'q1'), box(l, 'q2'), box(l, 'dev')]
    expect(q1.left).toBeGreaterThan(dev.right)
    expect(q1.left).toBe(q2.left)
    const [upper, lower] = q1.top < q2.top ? [q1, q2] : [q2, q1]
    expect(lower.top - upper.bottom).toBeGreaterThanOrEqual(24)
    expect(Math.abs((upper.top + lower.bottom) / 2 - dev.cy)).toBeLessThan(0.5)
    expect(findOverlaps(l)).toEqual([])
  })

  it('sideAsk_shapeAsker_rightOfLabel', () => {
    const g = askGraph(['q'], 'decision')
    const l = layoutOf(g)
    const dev = g.nodes.find((n) => n.key === 'dev')!
    expect(box(l, 'q').left).toBeGreaterThan(l.positions.get('dev')!.x + nodeSize(dev).width)
  })

  it('sideAsk_shapeAsker_roundTripLeavesFromRightSide', () => {
    // 마름모가 묻는 노드여도 그릴 점(routedPoints)이 도형 위·아래로 옮겨지지 않고 이름 오른쪽에서 나간다(코드 리뷰)
    const g = askGraph(['q'], 'decision')
    const l = layoutOf(g)
    const dev = g.nodes.find((n) => n.key === 'dev')!
    const devRight = l.positions.get('dev')!.x + nodeSize(dev).width
    const shapeKeys = new Set(g.nodes.filter(isShapeNode).map((n) => n.key))
    const side = l.edges.filter((e) => (e.from === 'dev' && e.to === 'q') || (e.from === 'q' && e.to === 'dev'))
    expect(side).toHaveLength(2)
    for (const e of side) {
      const pts = routedPoints(e, l, shapeKeys)
      for (const p of pts) expect(p.x).toBeGreaterThanOrEqual(devRight - 0.5)
      expect(new Set(pts.map((p) => Math.round(p.y))).size).toBe(1)
    }
  })

  it('sideAsk_questionWithOtherEdge_fallsBackToDagre', () => {
    // 질문 노드로 묻는 노드 말고 다른 선도 들어오면 옆에 두지 않고 dagre 에 맡긴다 — 배치가 깨지지 않는다(코드 리뷰)
    const base = askGraph()
    // 가상 질문 노드(ask 줄임 표기)는 들어오는 선 종류와 상관없이 질문 노드로 본다 — 그 경우가 문제였다
    const g = graphOf(base.nodes.map((n) => (n.key === 'q' ? { ...n, virtual: true } : n)), [...base.edges, mk('review', 'q', 'onError', '오류')])
    const l = layoutOf(g)
    for (const p of l.positions.values()) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
    }
    expect(l.positions.has('q')).toBe(true)
    expect(Math.abs(box(l, 'q').cy - box(l, 'dev').cy)).toBeGreaterThan(0.5)
    // 오류 선 끝이 실제 질문 노드 상자에 닿는다(dagre 에 없는 노드로 이으면 엉뚱한 자리에서 끝난다)
    const err = l.edges.find((e) => e.from === 'review' && e.to === 'q')!
    const end = err.points[err.points.length - 1]
    const q = box(l, 'q')
    expect(end.x).toBeGreaterThanOrEqual(q.left - 1)
    expect(end.x).toBeLessThanOrEqual(q.right + 1)
  })

  it('sideAsk_gapFitsMergedParallelLabels', () => {
    // 같은 두 끝을 잇는 선이 여럿이면 합친 라벨 폭으로 간격을 잡는다(코드 리뷰)
    const base = askGraph()
    const g = graphOf(base.nodes, [...base.edges, mk('dev', 'q', 'ask', '추가 확인 요청')])
    const l = layoutOf(g)
    const merged = l.edges.find((e) => e.from === 'dev' && e.to === 'q')!.label
    const gap = box(l, 'q').left - box(l, 'dev').right
    expect(gap).toBeGreaterThanOrEqual(labelWidth(merged))
  })

  it('sideAsk_layoutCacheKeyedByVirtual', () => {
    // 같은 키·크기·간선이라도 가상 질문 노드(옆 배치)와 실제 노드(dagre)는 배치가 다르다 — 캐시가 낡은 배치를 돌려주지 않는다(리뷰)
    const base = [node('start', 'start'), node('dev'), node('end', 'end')]
    const edges = [mk('start', 'dev', 'outcome'), mk('dev', 'end', 'outcome'), mk('dev', 'q', 'ask', '질문')]
    const real = layoutOf(graphOf([...base, node('q', 'human_task')], edges))
    const virt = layoutOf(graphOf([...base, { ...node('q', 'human_task'), virtual: true } as GraphNode], edges))
    expect(Math.abs(box(real, 'q').cy - box(real, 'dev').cy)).toBeGreaterThan(0.5)
    expect(Math.abs(box(virt, 'q').cy - box(virt, 'dev').cy)).toBeLessThan(0.5)
  })

  it('sideAsk_labeledEdgeIntoAsker_labelStaysOnLine', () => {
    // 묻는 노드로 드나드는 라벨 있는 선 — 끝점을 실제 노드로 옮길 때 라벨·꺾은 점도 함께 옮겨 라벨이 선 위에 남는다(리뷰)
    const base = askGraph()
    const g = graphOf(base.nodes, base.edges.map((e) => (e.from === 'start' && e.to === 'dev' ? { ...e, label: '시작 확인' } : e)))
    const l = layoutOf(g)
    const e = l.edges.find((x) => x.from === 'start' && x.to === 'dev')!
    expect(e.labelPos).not.toBeNull()
    const dist = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)))
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
    }
    const nearest = Math.min(...e.points.slice(1).map((b, i) => dist(e.labelPos!, e.points[i], b)))
    expect(nearest).toBeLessThan(1)
    // 들어가는 끝점은 실제 dev 상자 위 변 가운데
    const end = e.points[e.points.length - 1]
    const dev = box(l, 'dev')
    expect(Math.abs(end.x - (dev.left + dev.right) / 2)).toBeLessThan(0.5)
  })

  it('sideAsk_edgesIntoAskerEndVertically', () => {
    // 질문 묶음이 묻는 노드보다 높아도 묻는 노드로 드나드는 다른 선의 끝 구간은 세로 — 비스듬히 질문 카드를 가로지르지 않는다(리뷰)
    // b 는 넓힌 상자 오른쪽(질문 열 위)에서 dev 로 들어온다 — dagre 끝점이 상자 가운데 x 가 아니다
    const qs = ['q1', 'q2', 'q3']
    const g = graphOf(
      [node('start', 'start'), node('a'), node('b'), node('dev'), node('c'), node('end', 'end'), ...qs.map((q) => node(q, 'human_task'))],
      [
        mk('start', 'a', 'outcome'), mk('start', 'b', 'outcome'), mk('start', 'c', 'outcome'), mk('start', 'dev', 'outcome', '진행'),
        mk('a', 'end', 'outcome'), mk('b', 'dev', 'outcome'), mk('c', 'dev', 'outcome'), mk('dev', 'end', 'outcome'),
        ...qs.flatMap((q) => [mk('dev', q, 'ask', '질문'), mk(q, 'dev', 'returnTo', '돌아가기')]),
      ],
    )
    const l = layoutOf(g)
    const others = l.edges.filter((e) => !e.side && (e.from === 'dev' || e.to === 'dev'))
    expect(others.length).toBeGreaterThan(0)
    for (const e of others) {
      const [a, b] = e.to === 'dev' ? [e.points[e.points.length - 2], e.points[e.points.length - 1]] : [e.points[1], e.points[0]]
      expect(Math.abs(a.x - b.x), `${e.from}->${e.to}`).toBeLessThan(0.5)
    }
  })

  it('sideAsk_aiDevFlow_expanded', () => {
    const g = aiDevGraph()
    const l = layoutOf(g)
    const qKeys = questionNodeKeys(g)
    let checked = 0
    for (const q of qKeys) {
      const askers = new Set(g.edges.filter((e) => e.to === q && e.kind === 'ask').map((e) => e.from))
      if (askers.size !== 1) continue
      const asker = [...askers][0]
      if (qKeys.has(asker) || !l.positions.has(asker)) continue
      checked++
      expect(Math.abs(box(l, q).cy - box(l, asker).cy), q).toBeLessThan(0.5)
    }
    expect(checked).toBeGreaterThan(0)
    expect(findOverlaps(l)).toEqual([])
  })
  // --- 왕복 선·다른 선 끝점 보정(WP-2123 Task 2) ---
  type Pt = { x: number; y: number }
  const edgeOf = (l: GraphLayoutResult, from: string, to: string) => l.edges.find((e) => e.from === from && e.to === to)!
  const rectOfKey = (l: GraphLayoutResult, key: string): Rect => {
    const p = l.positions.get(key)!
    const s = l.sizes.get(key)!
    return { x: p.x, y: p.y, w: s.width, h: s.height }
  }
  /** 두 선분이 한 점 이상 겹치거나 교차하는지(끝점만 닿는 경우도 교차로 본다). */
  function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
    const cross = (o: Pt, p: Pt, q: Pt) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x)
    const d1 = cross(c, d, a)
    const d2 = cross(c, d, b)
    const d3 = cross(a, b, c)
    const d4 = cross(a, b, d)
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
    const on = (p: Pt, q: Pt, r: Pt) => cross(p, q, r) === 0 && Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y)
    return on(c, d, a) || on(c, d, b) || on(a, b, c) || on(a, b, d)
  }
  const polylinesCross = (p: Pt[], q: Pt[]) => {
    for (let i = 0; i + 1 < p.length; i++) for (let j = 0; j + 1 < q.length; j++) if (segmentsIntersect(p[i], p[i + 1], q[j], q[j + 1])) return true
    return false
  }
  const labelRect = (e: { label: string; labelPos: Pt | null }): Rect => {
    const w = labelWidth(e.label)
    return { x: e.labelPos!.x - w / 2, y: e.labelPos!.y - 9, w, h: 18 }
  }

  it('sideAsk_edgesUseLeftRightHandles', () => {
    const g = askGraph()
    const l = layoutOf(g)
    const ask = edgeOf(l, 'dev', 'q')
    const ret = edgeOf(l, 'q', 'dev')
    expect(drawnEdge(ask, l.positions, l)).toMatchObject({ sourceHandle: 's-right', targetHandle: 's-left', back: false })
    expect(drawnEdge(ret, l.positions, l)).toMatchObject({ sourceHandle: 's-left', targetHandle: 's-right', back: false })
  })

  it('sideAsk_edgesParallelNotCrossing', () => {
    const l = layoutOf(askGraph())
    const dev = box(l, 'dev')
    const q = box(l, 'q')
    const ask = edgeOf(l, 'dev', 'q').points
    const ret = edgeOf(l, 'q', 'dev').points
    expect(ask[0].x).toBe(dev.right)
    expect(ask[ask.length - 1].x).toBe(q.left)
    expect(ret[0].x).toBe(q.left)
    expect(ret[ret.length - 1].x).toBe(dev.right)
    for (const pts of [ask, ret]) for (let i = 0; i + 1 < pts.length; i++) expect(pts[i].y).toBe(pts[i + 1].y)
    expect(ask[0].y).toBeCloseTo(q.cy - 6, 5)
    expect(ret[0].y).toBeCloseTo(q.cy + 6, 5)
    expect(polylinesCross(ask, ret)).toBe(false)
  })

  it('sideAsk_labelsNotOverlapNodes', () => {
    const l = layoutOf(askGraph())
    expect(findOverlaps(l)).toEqual([])
    const a = labelRect(edgeOf(l, 'dev', 'q'))
    const r = labelRect(edgeOf(l, 'q', 'dev'))
    expect(overlaps(a, r)).toBe(false)
    // ask 라벨은 선 위, 돌아가기 라벨은 선 아래
    expect(edgeOf(l, 'dev', 'q').labelPos!.y).toBeLessThan(edgeOf(l, 'dev', 'q').points[0].y)
    expect(edgeOf(l, 'q', 'dev').labelPos!.y).toBeGreaterThan(edgeOf(l, 'q', 'dev').points[0].y)
  })

  it('sideAsk_otherEdgesSnapToAskerCenter', () => {
    const l = layoutOf(askGraph())
    const cx = (box(l, 'dev').left + box(l, 'dev').right) / 2
    const into = edgeOf(l, 'start', 'dev').points
    const out = edgeOf(l, 'dev', 'review').points
    expect(Math.abs(into[into.length - 1].x - cx)).toBeLessThan(0.5)
    expect(Math.abs(out[0].x - cx)).toBeLessThan(0.5)
    // 끝점과 같은 x 였던 이웃 점도 함께 옮겨 기울어진 선이 생기지 않는다
    if (into.length > 2 && Math.abs(into[into.length - 2].x - cx) < 20) expect(into[into.length - 2].x).toBeCloseTo(cx, 5)
    if (out.length > 2 && Math.abs(out[1].x - cx) < 20) expect(out[1].x).toBeCloseTo(cx, 5)
  })

  /** 모든 간선이 양 끝이 아닌 노드 상자를 지나지 않고, 옆 질문 선은 묻는 노드·질문 노드 상자도 지나지 않는다. */
  function crossingsOf(g: WorkflowGraph): string[] {
    const view = visibleGraph(g, { showAsk: true })
    const l = computeGraphLayout(view)
    const keys = [...l.positions.keys()]
    const bad: string[] = []
    for (const e of l.edges) {
      for (let i = 0; i + 1 < e.points.length; i++) {
        for (const k of keys) {
          // 양 끝 노드는 기존 규칙(routedPoints 검사)에 맡기고, 옆 질문 선은 양 끝도 포함해 검사한다
          const isEnd = k === e.from || k === e.to
          const side = (e.from === 'dev' || e.to === 'dev') && (e.label === '질문' || e.label === '돌아가기')
          if (isEnd && !side) continue
          if (segmentEntersRect(e.points[i], e.points[i + 1], rectOfKey(l, k))) bad.push(`${e.from}→${e.to} 선분 ${i} 이 ${k} 를 지남`)
        }
      }
    }
    return bad
  }

  it('sideAsk_noEdgeCrossesAskerOrQuestion', () => {
    expect(crossingsOf(askGraph())).toEqual([])
    expect(crossingsOf(askGraph(['q1', 'q2']))).toEqual([])
    expect(findCrossingEdges(aiDevGraph(), true)).toEqual([])
  })

  // --- 끝점 맞추기가 긴 선을 옮기거나 카드를 가로지르지 않는다(WP-2123 리뷰 후속) ---
  /** 판정 기준 — 옆 질문 선이 아닌 모든 간선이 양 끝이 아닌 노드(질문 노드 포함, 실제 크기)를 지나지 않고,
   *  묻는 노드(옆 질문을 단 노드)로 드나드는 끝 구간은 실제 노드 가운데 x 의 세로 선이다. */
  function snapViolations(g: WorkflowGraph): string[] {
    const l = layoutOf(g)
    const bad: string[] = []
    const shapes = new Set(g.nodes.filter(isShapeNode).map((n) => n.key))
    const hosts = new Set(l.edges.filter((e) => e.side).map((e) => (g.edges.some((x) => x.kind === 'ask' && x.from === e.from && x.to === e.to) ? e.from : e.to)))
    for (const e of l.edges) {
      if (e.side) continue
      for (let i = 0; i + 1 < e.points.length; i++) {
        for (const k of l.positions.keys()) {
          if (k === e.from || k === e.to) continue
          if (segmentEntersRect(e.points[i], e.points[i + 1], rectOfKey(l, k))) bad.push(`${e.from}→${e.to} 선분 ${i} 이 ${k} 를 지남`)
        }
      }
      for (const [key, end, nb] of [[e.from, 0, 1], [e.to, e.points.length - 1, e.points.length - 2]] as const) {
        if (!hosts.has(key)) continue
        const r = rectOfKey(l, key)
        const cx = r.x + (shapes.has(key) ? SHAPE_SIZE / 2 : r.w / 2)
        if (Math.abs(e.points[end].x - cx) > 0.5 || Math.abs(e.points[nb].x - cx) > 0.5) bad.push(`${e.from}→${e.to} 의 ${key} 쪽 끝 구간이 가운데 세로 선이 아님`)
      }
    }
    return bad
  }
  /** 이름이 곧 키인 노드들과 「출발>도착:라벨」 표기의 흐름 간선, 묻는 노드>질문 노드 쌍으로 그래프를 만든다(질문마다 ask·돌아가기 두 선). */
  function flowGraph(keys: string[], flow: string[], asks: string[]): WorkflowGraph {
    const nodes = [node(keys[0], 'start'), ...keys.slice(1).map((k) => node(k)), ...asks.map((a) => node(a.split('>')[1], 'human_task'))]
    let seq = 0
    const edge = (from: string, to: string, kind: GraphEdge['kind'], label: string): GraphEdge => ({ id: `${from}->${to}#${seq++}`, from, to, kind, label })
    const edges = flow.map((f) => {
      const [ends, label = ''] = f.split(':')
      const [from, to] = ends.split('>')
      return edge(from, to, 'outcome', label)
    })
    for (const a of asks) {
      const [host, q] = a.split('>')
      edges.push(edge(host, q, 'ask', 'q'), edge(q, host, 'returnTo', 'r'))
    }
    return graphOf(nodes, edges)
  }

  it('sideAsk_longEdgeFromAsker_notShiftedOntoOtherCard', () => {
    // n1(묻는 노드)에서 여러 층 아래 n3 로 가는 긴 선 — dagre 가 넓힌 상자 가운데로 곧게 낸 세로 구간을 통째로 실제 가운데 x 로 옮기면
    // 중간 층의 n6 카드를 지난다(리뷰 ①). 끝 구간만 넓힌 상자 바로 바깥에서 꺾어 들어가야 한다.
    const g = flowGraph(
      ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7'],
      ['n0>n1', 'n1>n2:라벨', 'n1>n3', 'n0>n4:라벨', 'n4>n5:라벨', 'n1>n6', 'n5>n7:라벨', 'n2>n3', 'n1>n6'],
      ['n1>q0', 'n1>q1'],
    )
    expect(snapViolations(g)).toEqual([])
  })

  it('sideAsk_longEdgeIntoAsker_notShiftedOntoQuestionCard', () => {
    // n0 에서 묻는 노드 n2 로 내려오는 긴 선 — 세로 구간을 옮기면 옆 묻는 노드 n1 의 질문 카드를 지난다(리뷰 ①)
    const g = flowGraph(
      ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6'],
      ['n0>n1:라벨', 'n0>n2', 'n1>n3:라벨', 'n3>n4', 'n4>n5', 'n4>n6', 'n2>n4', 'n2>n5:긴 라벨', 'n1>n5'],
      ['n2>qa', 'n1>qb'],
    )
    expect(snapViolations(g)).toEqual([])
  })

  it('sideAsk_snappedEndsStayOutsideCards', () => {
    // 꺾는 높이가 넓힌 상자 높이 안이면 가로 구간이 질문 카드·묻는 노드를 가로지른다(리뷰 ②) — 쌓인 질문·도형 묻는 노드·옆에서 들어오는 선 모두 기준을 지킨다
    expect(snapViolations(askGraph())).toEqual([])
    expect(snapViolations(askGraph(['q1', 'q2', 'q3']))).toEqual([])
    expect(snapViolations(askGraph(['q1', 'q2'], 'decision'))).toEqual([])
    expect(snapViolations(flowGraph(
      ['start', 'a', 'b', 'dev', 'c', 'end'],
      ['start>a', 'start>b', 'start>c', 'start>dev:진행', 'a>end', 'b>dev', 'c>dev', 'dev>end'],
      ['dev>q1', 'dev>q2', 'dev>q3'],
    ))).toEqual([])
  })

  it('sideAsk_stackedRoundTripsLeaveAskerWithinItsHeight', () => {
    for (const qs of [['q1', 'q2'], ['q1', 'q2', 'q3']]) {
      const l = layoutOf(askGraph(qs))
      const dev = box(l, 'dev')
      const lines: { name: string; pts: Pt[]; q: string }[] = []
      for (const q of qs) {
        const qb = box(l, q)
        const ask = edgeOf(l, 'dev', q).points
        const ret = edgeOf(l, q, 'dev').points
        lines.push({ name: `ask ${q}`, pts: ask, q }, { name: `ret ${q}`, pts: ret, q })
        // 묻는 노드 오른쪽 변에서 묻는 노드 높이 안으로 나가고 들어온다
        expect(ask[0].x).toBe(dev.right)
        expect(ask[0].y).toBeGreaterThanOrEqual(dev.top)
        expect(ask[0].y).toBeLessThanOrEqual(dev.bottom)
        expect(ret[ret.length - 1].x).toBe(dev.right)
        expect(ret[ret.length - 1].y).toBeGreaterThanOrEqual(dev.top)
        expect(ret[ret.length - 1].y).toBeLessThanOrEqual(dev.bottom)
        expect(ask[ask.length - 1].x).toBe(qb.left)
        expect(ret[0].x).toBe(qb.left)
        // 가로-세로-가로 꺾음 — 모든 선분이 가로 또는 세로
        for (const pts of [ask, ret]) for (let i = 0; i + 1 < pts.length; i++) expect(pts[i].x === pts[i + 1].x || pts[i].y === pts[i + 1].y).toBe(true)
      }
      // 같은 질문의 두 선뿐 아니라 서로 다른 질문의 선끼리도 교차·겹침이 없다
      for (let i = 0; i < lines.length; i++) {
        for (let j = i + 1; j < lines.length; j++) {
          // 같은 노드에서 같은 줄로 시작하는 한 점(묻는 노드 쪽 끝점)은 서로 달라야 한다
          expect(polylinesCross(lines[i].pts, lines[j].pts), `${lines[i].name} x ${lines[j].name}`).toBe(false)
        }
      }
      expect(crossingsOf(askGraph(qs))).toEqual([])
    }
  })
})
