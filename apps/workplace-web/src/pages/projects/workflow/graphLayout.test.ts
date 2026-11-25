// 편집 그래프 배치(WP-2089) 검증 — 겹침 없음, 공통 오류 목적지, 질문 경로 접기, 되돌아가는 선 표시.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  commonErrorTarget,
  computeGraphLayout,
  flowHandles,
  type GraphLayoutResult,
  isAtLayoutPosition,
  isShapeNode,
  labelWidth,
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

  // 손잡이 — 들어옴은 위, 나감은 아래. 카드는 가운데, 마름모·원은 도형 가운데 x 에 맞춘다(끝점 = x + 0.5)
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
