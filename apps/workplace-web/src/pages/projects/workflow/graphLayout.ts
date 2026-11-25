// 워크플로우 편집 그래프 자리 계산(WP-2089) — dagre 위→아래(TB)로 노드 위치·간선 꺾임점·라벨 자리를 구하는 순수 함수 모음.
// 왜: 저장된 position 에 의존하던 배치를 자동 배치로 바꾸고, 그리기와 분리해 vitest(node)에서 겹침을 수치로 검증하기 위해서다.
// 최종 상수: nodesep 48 · ranksep 64 · edgesep 16 · margin 16 · 간선 라벨 높이 18 (ai-dev-flow 접힘·펼침에서 겹침 없음 확인).
import dagre from '@dagrejs/dagre'
import { type NodeHandle, Position } from '@xyflow/react'

import { groupByEndpoints, joinEdgeLabels } from '../../../lib/parallelEdges'
import type { GraphEdge, GraphEdgeKind, GraphNode, WorkflowGraph } from './graphYaml'

/** 카드형 노드(작업 노드)의 크기. */
export const CARD_WIDTH = 200
export const CARD_HEIGHT = 64
/** 마름모·원 모양 노드의 한 변, 그리고 모양과 옆 라벨 사이 간격. */
export const SHAPE_SIZE = 40
export const SHAPE_LABEL_GAP = 8
/** 간선 라벨 사각형의 높이. */
const EDGE_LABEL_HEIGHT = 18

/** 글자 폭 추정용 — 한글·CJK 는 13px, 그 밖은 7.5px, 좌우 여백 합 8px, 올림. */
const CJK = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
export function labelWidth(text: string): number {
  let w = 0
  for (const ch of text) w += CJK.test(ch) ? 13 : 7.5
  return Math.ceil(w + 8)
}

/** 노드 크기 — 분기·시작·종료는 모양 옆에 이름을 붙여 가로로 길고, 나머지는 고정 카드. */
export function nodeSize(node: GraphNode): { width: number; height: number } {
  if (isShapeNode(node)) {
    return { width: SHAPE_SIZE + SHAPE_LABEL_GAP + labelWidth(node.name ?? node.key), height: SHAPE_SIZE }
  }
  return { width: CARD_WIDTH, height: CARD_HEIGHT }
}

/**
 * 「+ 노드」가 놓을 빈 자리 — 주어진 모든 노드 자리(저장 좌표와 자동 배치 좌표가 섞인 것)의 맨 아래 밑, 가장 왼쪽 x.
 * 왜: 노드 높이는 카드(CARD_HEIGHT)가 가장 크므로 바닥을 그 높이로 잡으면 어떤 모양과도 겹치지 않는다. 자리가 없으면 원점.
 */
export function findFreeSpot(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 }
  return { x: Math.min(...points.map((p) => p.x)), y: Math.max(...points.map((p) => p.y)) + CARD_HEIGHT + 64 }
}

/**
 * 거의 모든 노드가 같은 곳으로 오류를 보낼 때 그 목적지(공통 오류 처리 노드). 선을 다 그리면 한 곳으로 모여 지저분하므로 숨기는 기준이다.
 * 최빈 목적지가 2개 이상이고 onError 간선 수의 절반 이상일 때만 인정하며, 동률이면 먼저 나온 것을 고른다.
 */
export function commonErrorTarget(graph: WorkflowGraph): string | null {
  const counts = new Map<string, number>()
  const keys = new Set(graph.nodes.map((n) => n.key))
  let total = 0
  for (const e of graph.edges) {
    // 없는 노드(오타)를 가리키는 선은 공통 목적지로 세지 않는다 — 숨기지 않고 끊긴 연결로 보이게 둔다.
    if (e.kind !== 'onError' || !keys.has(e.to)) continue
    total++
    counts.set(e.to, (counts.get(e.to) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [to, n] of counts) {
    if (n > bestCount) {
      best = to
      bestCount = n
    }
  }
  if (best === null || bestCount < 2 || bestCount * 2 < total) return null
  // onError 로만 닿는 목적지는 그 선을 숨기면 어디서도 이어지지 않는 고아 노드가 된다 — 다른 경로로 닿을 때만 공통 목적지로 본다.
  // 단 출발이 접힘에서 숨는 질문 노드(ask 줄임 표기의 가상 노드 등)인 선은 함께 사라지므로 닿는 경로로 세지 않는다.
  const questionKeys = questionNodeKeys(graph)
  return graph.edges.some((e) => e.to === best && e.kind !== 'onError' && !questionKeys.has(e.from)) ? best : null
}

/**
 * 질문 경로에만 속한 노드 — 가상 노드 전부와, 들어오는 간선이 모두 ask 이고 나가는 간선이 모두 물은 노드로 돌아가는 실제 노드.
 * 나가는 흐름이 따로 있는 노드는 ask 로만 닿아도 흐름의 일부라 숨기지 않는다.
 */
export function questionNodeKeys(graph: WorkflowGraph): Set<string> {
  const keys = new Set(graph.nodes.filter((n) => n.virtual).map((n) => n.key))
  const incoming = new Map<string, GraphEdge[]>()
  const outgoing = new Map<string, GraphEdge[]>()
  for (const e of graph.edges) {
    incoming.set(e.to, [...(incoming.get(e.to) ?? []), e])
    outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e])
  }
  for (const n of graph.nodes) {
    const ins = incoming.get(n.key) ?? []
    if (ins.length === 0 || !ins.every((e) => e.kind === 'ask')) continue
    const askers = new Set(ins.map((e) => e.from))
    const outs = outgoing.get(n.key) ?? []
    // 나가는 선이 하나도 없는 노드는 물은 노드로 돌아가는 질문 노드가 아니다(every 는 빈 배열에서 참) — 숨기면 실제 노드가 사라진다
    if (outs.length > 0 && outs.every((e) => askers.has(e.to))) keys.add(n.key)
  }
  return keys
}

export interface VisibleGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** 숨긴 공통 오류 목적지(없으면 null) — 화면이 「모든 오류 → X」 안내를 띄우는 데 쓴다 */
  commonErrorTo: string | null
  askHosts: Set<string>
}

/** 화면에 그릴 노드·간선만 고른다. showAsk=false 면 질문 경로를, 늘 공통 오류 목적지로 가는 onError 선을 뺀다. */
export function visibleGraph(graph: WorkflowGraph, opts: { showAsk: boolean }): VisibleGraph {
  const commonErrorTo = commonErrorTarget(graph)
  const hidden = opts.showAsk ? new Set<string>() : questionNodeKeys(graph)
  const nodes = graph.nodes.filter((n) => !hidden.has(n.key))
  const edges = graph.edges.filter((e) => {
    if (hidden.has(e.from) || hidden.has(e.to)) return false
    // ask 선은 도착이 숨는 질문 노드일 때만 뺀다(위 hidden 검사) — 흐름이 있는 보이는 노드로 가는 ask 선은 접어도 남긴다.
    if (e.kind === 'onError' && commonErrorTo !== null && e.to === commonErrorTo) return false
    return true
  })
  // 💬 는 접힘에서 ask 선이 실제로 숨은(도착이 질문 노드인) 노드에만 단다 — 선이 그대로 그려지는 노드에 달면 같은 정보가 둘이다
  const askHosts = new Set(graph.edges.filter((e) => e.kind === 'ask' && hidden.has(e.to)).map((e) => e.from))
  return { nodes, edges, commonErrorTo, askHosts }
}

export interface LaidEdge {
  id: string
  from: string
  to: string
  label: string
  /** 도착 층이 출발 층보다 위 — 되돌아가는 선 */
  back: boolean
  /** 되돌림 여부와 상관없이 종류(오류·되돌림·질문)만으로 점선인지 — 실제 점선 여부는 drawnEdge 가 되돌림과 합쳐 정한다 */
  kindDashed: boolean
  points: { x: number; y: number }[]
  /** 라벨 중심 좌표(라벨이 없으면 null) */
  labelPos: { x: number; y: number } | null
  /** 묻는 노드 ↔ 옆 질문 노드 왕복 선(WP-2123) — 점을 직접 계산했으므로 routedPoints 가 도형 끝점 보정을 하지 않는다 */
  side?: boolean
}

export interface GraphLayoutResult {
  /** 노드 왼쪽 위 모서리(ReactFlow 기준) */
  positions: Map<string, { x: number; y: number }>
  sizes: Map<string, { width: number; height: number }>
  edges: LaidEdge[]
  /** 노드의 층 번호(0부터, 위→아래) */
  rank: Map<string, number>
}

/** 점선으로 그리는 간선 종류 — 오류·되돌림·질문 경로는 정상 흐름과 구분한다. */
const DASHED_KINDS: ReadonlySet<GraphEdgeKind> = new Set<GraphEdgeKind>(['onError', 'returnTo', 'ask'])

/** 최근 배치 결과 캐시의 최대 개수 — 오래된 것부터 버린다. */
const LAYOUT_CACHE_MAX = 8
/**
 * 배치 결과 캐시. YAML 한 글자를 고쳐도 렌더마다 dagre 를 다시 돌리면 큰 그래프에서 입력이 끊기므로,
 * 노드 이름·크기와 간선 구조가 같으면 같은 결과 객체를 돌려준다(Map 은 삽입 순서를 지켜 맨 앞이 가장 오래됐다).
 */
const layoutCache = new Map<string, GraphLayoutResult>()

/**
 * 배치에 영향을 주는 값(노드 키·크기, 간선 출발·도착·라벨·종류)의 캐시 키.
 * JSON 으로 직렬화해 라벨에 구분 기호가 들어 있어도 다른 구조의 키가 겹치지 않게 한다.
 * 캐시된 결과 객체는 호출자들이 공유하므로 읽기 전용으로만 써야 한다(고치면 다른 화면의 배치가 바뀐다).
 */
function layoutKey(view: VisibleGraph): string {
  const nodes = view.nodes.map((n) => {
    const s = nodeSize(n)
    // 가상 여부(질문 노드 판정 — 옆 배치)와 도형 여부(끝점 보정 x)도 배치를 바꾸므로 키에 넣는다(WP-2123 리뷰)
    return [n.key, s.width, s.height, n.virtual === true, isShapeNode(n)]
  })
  const edges = view.edges.map((e) => [e.from, e.to, e.label, e.kind])
  return JSON.stringify([nodes, edges])
}

/** dagre 로 위→아래 배치한다(같은 구조는 캐시를 쓴다). 평행 간선은 (출발, 도착)마다 한 줄·한 라벨로 합쳐 넣는다. */
export function computeGraphLayout(view: VisibleGraph): GraphLayoutResult {
  const key = layoutKey(view)
  const hit = layoutCache.get(key)
  if (hit) return hit
  const result = layoutUncached(view)
  layoutCache.set(key, result)
  if (layoutCache.size > LAYOUT_CACHE_MAX) layoutCache.delete(layoutCache.keys().next().value as string)
  return result
}

/** 옆에 붙인 질문 노드 묶음 사이의 세로 간격(WP-2123). */
const SIDE_STACK_GAP = 24
/** 묻는 노드와 옆 질문 노드 사이 간격 — 두 선의 라벨이 들어갈 폭에 더하는 여유, 그리고 최소값(WP-2123). */
const SIDE_GAP_PADDING = 24
const SIDE_GAP_MIN = 48
/** 왕복하는 두 선이 겹치지 않게 가운데 줄에서 위·아래로 비키는 거리(WP-2123). */
const SIDE_LINE_OFFSET = 6

/**
 * 옆에 붙일 질문 노드 계획(WP-2123) — 묻는 노드 키 → 그 옆에 놓을 질문 노드 키들(입력 순서).
 * 대상: 질문 경로 노드(questionNodeKeys) 중 들어오는 ask 선의 출발이 정확히 하나이고, 그 출발이 보이며 질문 노드가 아닌 것.
 * 왜: 질문 경로를 한 층 아래로 내리면 메인 흐름의 층이 벌어지므로, 묻는 노드 바로 옆 같은 높이에 두어 층을 늘리지 않는다.
 * 여러 노드가 같이 쓰는 질문 노드는 옆에 붙일 곳이 하나로 정해지지 않아 기존 dagre 배치에 맡긴다.
 */
function sideQuestionPlan(view: VisibleGraph): Map<string, string[]> {
  const plan = new Map<string, string[]>()
  const visible = new Set(view.nodes.map((n) => n.key))
  const questionKeys = questionNodeKeys({ nodes: view.nodes, edges: view.edges, roles: [], shared: [] })
  for (const n of view.nodes) {
    if (!questionKeys.has(n.key)) continue
    const askers = new Set(view.edges.filter((e) => e.to === n.key && e.kind === 'ask').map((e) => e.from))
    if (askers.size !== 1) continue
    const asker = [...askers][0]
    if (!visible.has(asker) || questionKeys.has(asker)) continue
    // 묻는 노드 말고 다른 노드와도 이어진 질문 노드는 dagre 에 맡긴다 — 옆에 두면 dagre 에 없는 노드로 선이 이어져 배치가 깨진다
    if (view.edges.some((e) => (e.from === n.key && e.to !== asker) || (e.to === n.key && e.from !== asker))) continue
    plan.set(asker, [...(plan.get(asker) ?? []), n.key])
  }
  return plan
}

function layoutUncached(view: VisibleGraph): GraphLayoutResult {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 48, ranksep: 64, edgesep: 16, marginx: 16, marginy: 16 })
  g.setDefaultEdgeLabel(() => ({}))

  // 화면에 그릴 실제 크기(sizes)와 dagre 에 넣는 크기를 나눈다 — 옆 질문 노드를 예약한 노드는 dagre 상자만 넓다
  const sizes = new Map<string, { width: number; height: number }>()
  for (const n of view.nodes) sizes.set(n.key, nodeSize(n))
  const shapeKeys = new Set(view.nodes.filter(isShapeNode).map((n) => n.key))

  // 옆 질문 노드(WP-2123) — dagre 에는 넣지 않고, 묻는 노드 상자를 [본체 + 간격 + 질문 열] 만큼 넓혀 자리를 예약한다
  const plan = sideQuestionPlan(view)
  const sideKeys = new Set([...plan.values()].flat())
  const asker = new Map<string, string>()
  for (const [host, qs] of plan) for (const q of qs) asker.set(q, host)
  // 옆 질문 노드와 묻는 노드를 잇는 선 — dagre 에 넣지 않고 아래에서 직접 그린다
  const isSideEdge = (e: { from: string; to: string }) => asker.get(e.to) === e.from || asker.get(e.from) === e.to
  // 양 끝 노드가 그려지지 않는 간선은 뺀다. 같은 두 끝을 잇는 선은 라벨을 합쳐(joinEdgeLabels) 하나로 그린다
  const groups = groupByEndpoints(view.edges.filter((e) => sizes.has(e.from) && sizes.has(e.to)))
  const labels = new Map<(typeof groups)[number], string>()
  // 묻는 노드별 옆 선 라벨 중 가장 넓은 폭(합친 라벨 기준)
  const sideLabelWidth = new Map<string, number>()
  for (const group of groups) {
    const label = joinEdgeLabels(group.members.map((m) => m.label).filter((l) => l !== ''))
    labels.set(group, label)
    if (!isSideEdge(group) || !label) continue
    const host = asker.get(group.to) === group.from ? group.from : group.to
    sideLabelWidth.set(host, Math.max(sideLabelWidth.get(host) ?? 0, labelWidth(label)))
  }
  // 묻는 노드별 간격(WP-2123) — 두 방향 선의 라벨 중 넓은 것이 들어가고 여유가 남게(선 라벨을 이 사이에 둔다)
  const sideGap = new Map<string, number>()
  const stack = new Map<string, { width: number; height: number }>()
  for (const [host, qs] of plan) {
    sideGap.set(host, Math.max(SIDE_GAP_MIN, (sideLabelWidth.get(host) ?? 0) + SIDE_GAP_PADDING))
    const qSizes = qs.map((q) => sizes.get(q)!)
    stack.set(host, {
      width: Math.max(...qSizes.map((z) => z.width)),
      height: qSizes.reduce((sum, z) => sum + z.height, 0) + SIDE_STACK_GAP * (qs.length - 1),
    })
  }
  const dagreSize = new Map<string, { width: number; height: number }>()
  for (const n of view.nodes) {
    if (sideKeys.has(n.key)) continue
    const own = sizes.get(n.key)!
    const st = stack.get(n.key)
    // dagre 가 크기 객체에 x·y 를 덧씌우므로(WP-2123) 실제 크기와 같은 객체를 넘기지 않는다
    const size = st
      ? { width: own.width + sideGap.get(n.key)! + st.width, height: Math.max(own.height, st.height) }
      : { width: own.width, height: own.height }
    dagreSize.set(n.key, size)
    g.setNode(n.key, size)
  }

  for (const group of groups) {
    if (isSideEdge(group)) continue
    const label = labels.get(group)!
    // 라벨이 있는 선만 라벨 자리를 예약한다(없는 선에 8px 짜리 자리를 잡으면 층만 벌어진다)
    g.setEdge(group.from, group.to, label ? { width: labelWidth(label), height: EDGE_LABEL_HEIGHT, labelpos: 'c' } : {})
  }
  dagre.layout(g)

  const positions = new Map<string, { x: number; y: number }>()
  const centersY: { key: string; y: number }[] = []
  for (const key of dagreSize.keys()) {
    const p = g.node(key)
    const size = sizes.get(key)!
    const wide = dagreSize.get(key)!
    // 묻는 노드는 넓힌 상자의 왼쪽·세로 가운데에 둔다(오른쪽은 질문 열 자리)
    positions.set(key, { x: p.x - wide.width / 2, y: p.y - size.height / 2 })
    centersY.push({ key, y: p.y })
  }
  // 옆 질문 노드(WP-2123) — 묻는 노드 오른쪽 간격 뒤에 왼쪽을 맞추고, 쌓은 묶음의 세로 가운데를 묻는 노드 가운데에 맞춘다
  for (const [host, qs] of plan) {
    const hostPos = positions.get(host)!
    const hostSize = sizes.get(host)!
    const cy = hostPos.y + hostSize.height / 2
    const left = hostPos.x + hostSize.width + sideGap.get(host)!
    let top = cy - stack.get(host)!.height / 2
    for (const q of qs) {
      positions.set(q, { x: left, y: top })
      top += sizes.get(q)!.height + SIDE_STACK_GAP
    }
  }

  // 층 번호 — 결과 y 중심이 같은 노드끼리 한 층(부동소수 오차 대비 0.5px 이내를 같은 값으로 본다). 옆 질문 노드는 묻는 노드의 층
  const ys = [...new Set(centersY.map((c) => Math.round(c.y * 2) / 2))].sort((a, b) => a - b)
  const rank = new Map<string, number>()
  for (const c of centersY) rank.set(c.key, ys.indexOf(Math.round(c.y * 2) / 2))
  for (const [q, host] of asker) rank.set(q, rank.get(host) ?? 0)

  // 옆 질문 노드가 여럿 쌓인 묻는 노드(WP-2123) — 질문 노드마다 왕복 두 선(ask·돌아가기)이 가로-세로-가로로 꺾이는데,
  // 서로 다른 질문의 선이 겹치거나 교차하지 않게 선마다 묻는 노드 쪽 높이(세로 가운데 둘레에 촘촘히)와 세로 구간 x(간격을 나눈 칸)를 다르게 준다.
  // 질문 노드 쪽 줄이 묻는 노드 가운데보다 위인 선(위 묶음)은 더 위로 가는 선일수록 묻는 노드 쪽도 더 위, 세로 구간도 더 왼쪽에 두고,
  // 아래 묶음은 더 아래로 가는 선일수록 더 아래·더 왼쪽에 둬 L 자 선이 서로의 세로 구간을 가로지르지 않는 중첩 구조가 된다.
  // 값은 묻는 노드에서 질문 노드 쪽으로 가는 점 목록(키: [묻는 노드, 질문 노드, ask 여부] 의 JSON — 노드 키에 구분 기호가 들어 있어도 겹치지 않게)이고, 돌아가기 선은 그리는 곳에서 뒤집는다.
  // 지금 YAML 은 노드당 ask 선이 하나라(graphYaml 의 ask 결과 키·줄임 표기) 쌓이는 경우가 나오지 않는다 — 설계가 정한 방어용이다.
  const sideRoutes = new Map<string, { x: number; y: number }[]>()
  const sideKey = (host: string, q: string, asking: boolean) => JSON.stringify([host, q, asking])
  for (const [host, qs] of plan) {
    if (qs.length < 2) continue
    const hp = positions.get(host)!
    const hs = sizes.get(host)!
    const hostCy = hp.y + hs.height / 2
    const hostRightX = hp.x + hs.width
    const gap = sideGap.get(host)!
    const lines = qs.flatMap((q) => {
      const qCy = positions.get(q)!.y + sizes.get(q)!.height / 2
      return [true, false].map((asking) => ({ q, asking, qy: qCy + (asking ? -SIDE_LINE_OFFSET : SIDE_LINE_OFFSET) }))
    })
    const upper = lines.filter((l) => l.qy < hostCy).sort((x, y) => x.qy - y.qy)
    const lower = lines.filter((l) => l.qy >= hostCy).sort((x, y) => y.qy - x.qy)
    const total = lines.length
    // 묻는 노드 쪽 높이 간격 — 4px, 묻는 노드 높이 안에 다 들어가게 줄인다
    const step = Math.min(4, Math.max(0, hs.height - 2) / Math.max(1, total - 1))
    const place = (l: (typeof lines)[number], slotY: number, slotX: number) => {
      const vx = hostRightX + (gap * (slotX + 1)) / (total + 1)
      const hy = hostCy + (slotY - (total - 1) / 2) * step
      const qLeftX = positions.get(l.q)!.x
      const pts = [{ x: hostRightX, y: hy }, { x: vx, y: hy }, { x: vx, y: l.qy }, { x: qLeftX, y: l.qy }]
      // 길이 0 인 선분은 뺀다(질문 노드 줄과 묻는 노드 쪽 높이가 같을 때)
      sideRoutes.set(sideKey(host, l.q, l.asking), pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y))
    }
    upper.forEach((l, i) => place(l, i, i))
    lower.forEach((l, i) => place(l, total - 1 - i, upper.length + i))
  }

  const edges: LaidEdge[] = groups.map((group) => {
    const label = labels.get(group) ?? ''
    const kindDashed = group.members.some((m) => DASHED_KINDS.has(m.kind))
    if (isSideEdge(group)) {
      // 묻는 노드 ↔ 옆 질문 노드 왕복 — 한 쌍의 두 선이 겹치지 않게 ask 는 질문 노드 가운데 위 6px, 돌아가기는 아래 6px 줄에 둔다.
      // 질문이 하나면 가로 직선, 여럿이 쌓이면(sideRoutes) 선마다 묻는 노드 쪽 높이·세로 구간 x 가 모두 달라 서로 겹치지 않는다.
      const asking = asker.get(group.to) === group.from
      const q = asking ? group.to : group.from
      const host = asking ? group.from : group.to
      const hp = positions.get(host)!
      const hs = sizes.get(host)!
      const qp = positions.get(q)!
      const qCy = qp.y + sizes.get(q)!.height / 2
      const sign = asking ? -1 : 1
      const hostRightX = hp.x + hs.width
      const qy = qCy + sign * SIDE_LINE_OFFSET
      const midX = (hostRightX + qp.x) / 2
      const hostToQ = sideRoutes.get(sideKey(host, q, asking)) ?? [{ x: hostRightX, y: qy }, { x: qp.x, y: qy }]
      return {
        id: group.members[0].id,
        from: group.from,
        to: group.to,
        label,
        back: false,
        kindDashed,
        points: asking ? hostToQ : [...hostToQ].reverse(),
        // 라벨은 간격 가운데 — ask 는 선 위, 돌아가기는 선 아래(라벨 높이의 절반 9 + 여유 2)
        labelPos: label ? { x: midX, y: qy + sign * (EDGE_LABEL_HEIGHT / 2 + 2) } : null,
        side: true,
      }
    }
    const laid = g.edge(group.from, group.to)
    // WP-2123: 옆 질문 노드를 예약해 넓어진 dagre 상자에 닿은 끝점은 실제 노드 위·아래 변 가운데로 옮긴다(상자 경계는 노드 밖이라 화살표가 어긋난다)
    const pts: { x: number; y: number }[] = (laid?.points ?? []).map((pt: { x: number; y: number }) => ({ x: pt.x, y: pt.y }))
    let labelPos = label && laid?.x !== undefined && laid?.y !== undefined ? { x: laid.x as number, y: laid.y as number } : null
    const snapToReal = (key: string, end: number) => {
      if (!plan.has(key) || pts.length < 2) return
      const pos = positions.get(key)!
      const size = sizes.get(key)!
      const above = pts[end].y < pos.y + size.height / 2
      const oldX = pts[end].x
      const x = pos.x + (shapeKeys.has(key) ? SHAPE_SIZE / 2 : size.width / 2)
      pts[end] = { x, y: above ? pos.y : pos.y + size.height }
      // 끝점에서 이어지는 같은 x(넓힌 상자 가운데)의 점을 모두 같은 dx 로 옮긴다 — 세로 구간이 기울지 않고 꺾은 점이 넓힌 상자 가운데에 남지 않게(WP-2123 리뷰)
      const step = end === 0 ? 1 : -1
      let minY = pts[end].y
      let maxY = pts[end].y
      for (let i = end + step; i >= 0 && i < pts.length && Math.abs(pts[i].x - oldX) < 0.5; i += step) {
        pts[i] = { x, y: pts[i].y }
        minY = Math.min(minY, pts[i].y)
        maxY = Math.max(maxY, pts[i].y)
      }
      // 이웃 점이 넓힌 상자 가운데 x 가 아니면(상자 모서리 쪽에서 닿음) 이웃 점 높이에서 가로로 꺾어 내려온다 —
      // 비스듬히 이으면 묻는 노드보다 높은 질문 묶음 카드를 가로지를 수 있다(이웃 점은 넓힌 상자 밖이라 가로 구간은 카드 위·아래를 지난다)
      const nb = end + step
      if (nb >= 0 && nb < pts.length && Math.abs(pts[nb].x - x) >= 0.5) {
        pts.splice(end === 0 ? 1 : pts.length - 1, 0, { x, y: pts[nb].y })
      }
      // 라벨이 옮긴 세로 구간 위에 있었으면 같은 dx 로 옮겨 선에서 떨어지지 않게 한다
      if (labelPos && Math.abs(labelPos.x - oldX) < 0.5 && labelPos.y >= minY - 0.5 && labelPos.y <= maxY + 0.5) {
        labelPos = { x, y: labelPos.y }
      }
    }
    snapToReal(group.from, 0)
    snapToReal(group.to, pts.length - 1)
    const back = (rank.get(group.to) ?? 0) < (rank.get(group.from) ?? 0)
    return {
      id: group.members[0].id,
      from: group.from,
      to: group.to,
      label,
      back,
      kindDashed,
      points: pts,
      labelPos,
    }
  })
  return { positions, sizes, edges, rank }
}

/**
 * 노드가 자동 배치 자리에 그대로 있는지 — 그렇다면 간선을 dagre 꺾임점으로, 아니면(끌어 옮겼거나 저장 좌표가 다르면) 기본 경로로 그린다.
 * 저장 좌표는 반올림한 정수라 dagre 의 소수 좌표와 0.5px 까지 어긋나므로 축마다 1px 이내를 같은 자리로 본다.
 */
export function isAtLayoutPosition(
  current: { x: number; y: number } | undefined,
  laid: { x: number; y: number } | undefined,
): boolean {
  if (!current || !laid) return false
  return Math.abs(current.x - laid.x) <= 1 && Math.abs(current.y - laid.y) <= 1
}

/**
 * 노드의 손잡이 자리(노드 왼쪽 위 기준) — 위·아래·왼쪽·오른쪽 네 변마다 s-* 하나씩, 모두 4개(같은 자리에 겹친 손잡이를 두지 않는다 — 느슨한 연결 모드에서 선은 s-* 를 도착 손잡이로도 쓴다).
 * 위·아래는 가운데 x(마름모·원은 도형 가운데 x), 왼쪽·오른쪽은 도형(또는 카드)의 세로 가운데 y 에 둔다.
 * 마름모·원은 이름이 오른쪽에 붙어 상자가 넓으므로 오른쪽 손잡이는 도형 오른쪽 변(SHAPE_SIZE)에 둔다.
 * ReactFlow 에 미리 알려 두면 손잡이를 DOM 에서 재지 않고도 간선 끝점이 정확히 정해진다(측정 전·jsdom 에서도 선이 그려진다).
 * 이 id·자리는 WorkflowGraphShapes 의 Handle 과 같아야 한다.
 * s-* id 는 느슨한 연결 모드에서 출발 손잡이이자 도착 손잡이(targetHandle)로 함께 쓰인다 — 이름을 바꾸거나 t-* 를 더하지 않는다.
 */
export function flowHandles(node: GraphNode): NodeHandle[] {
  const size = nodeSize(node)
  const shape = isShapeNode(node)
  const cx = shape ? SHAPE_SIZE / 2 : size.width / 2
  const right = shape ? SHAPE_SIZE : size.width
  const cy = size.height / 2
  // 손잡이는 1×1 이라 x·y 는 중심에서 0.5 뺀 값이다
  const sides: Array<[string, Position, number, number]> = [
    ['top', Position.Top, cx - 0.5, 0],
    ['bottom', Position.Bottom, cx - 0.5, size.height - 1],
    ['left', Position.Left, -0.5, cy - 0.5],
    ['right', Position.Right, right - 0.5, cy - 0.5],
  ]
  return sides.map(([name, position, x, y]) => (
    { id: `s-${name}`, type: 'source' as const, position, x, y, width: 1, height: 1 }
  ))
}

/** 노드 상자 — 왼쪽 위 좌표와 크기. */
export interface Box { x: number; y: number; width: number; height: number }

/** 상자 가운데 좌표. */
function centreOf(b: Box): { x: number; y: number } {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/**
 * 두 노드의 상대 위치로 선이 이어질 변을 고른다. 두 상자 가운데의 |dx| > |dy| 면 가로(오른쪽→왼쪽·왼쪽→오른쪽), 아니면 세로(아래→위·위→아래).
 * 저장된 좌표가 옛 좌→우 배치여도 선이 노드 옆면에서 나가 옆면으로 들어가게 하려는 것이다(손잡이가 위·아래뿐이면 선이 노드를 가로지른다).
 */
export function pickHandles(from: Box, to: Box): { sourceHandle: string; targetHandle: string } {
  const f = centreOf(from)
  const t = centreOf(to)
  const dx = t.x - f.x
  const dy = t.y - f.y
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0 ? { sourceHandle: 's-right', targetHandle: 's-left' } : { sourceHandle: 's-left', targetHandle: 's-right' }
  }
  return dy >= 0 ? { sourceHandle: 's-bottom', targetHandle: 's-top' } : { sourceHandle: 's-top', targetHandle: 's-bottom' }
}

/**
 * 편집기가 지금 그리는 간선의 모양 — 되돌림 여부·점선 여부·이을 손잡이를 한 곳에서 정한다.
 * 양 끝이 배치 자리 그대로면 dagre 의 되돌림(e.back)을 믿고, 하나라도 벗어났으면(저장 좌표) 두 노드 가운데 y 를 비교해 다시 센다.
 * 점선은 되돌림이거나 종류가 점선(오류·되돌림·질문)일 때다. 손잡이는 지금 그리는 자리·크기의 상대 위치로 고른다
 * (배치 자리 그대로면 RoutedEdge 가 dagre 점을 쓰므로 손잡이는 저장 좌표로 어긋난 선의 대체 경로에만 영향을 준다).
 */
export function drawnEdge(
  e: LaidEdge,
  positions: Map<string, { x: number; y: number }>,
  layout: Pick<GraphLayoutResult, 'positions' | 'sizes'>,
): { back: boolean; dashed: boolean; sourceHandle: string; targetHandle: string } {
  // layout.sizes 의 값은 dagre 가 같은 객체에 x·y 를 덧씌워 두므로 통째로 펼치지 않고 width·height 만 꺼낸다
  const box = (key: string): Box => {
    const { x, y } = positions.get(key) ?? { x: 0, y: 0 }
    const { width, height } = layout.sizes.get(key) ?? { width: 0, height: 0 }
    return { x, y, width, height }
  }
  const from = box(e.from)
  const to = box(e.to)
  const atLayout = isAtLayoutPosition(positions.get(e.from), layout.positions.get(e.from))
    && isAtLayoutPosition(positions.get(e.to), layout.positions.get(e.to))
  const back = atLayout ? e.back : centreOf(to).y < centreOf(from).y
  return { back, dashed: back || e.kindDashed, ...pickHandles(from, to) }
}

/** 마름모·원 모양 노드인지 — 이름이 오른쪽에 붙어 dagre 상자 가운데가 도형 가운데가 아니다. */
export function isShapeNode(node: GraphNode): boolean {
  return node.type === 'decision' || node.type === 'start' || node.type === 'end'
}

/**
 * 간선을 그릴 점 — dagre 꺾임점을 그대로 쓰되, 마름모·원 쪽 끝점만 도형 가운데 x 의 위·아래 변으로 옮긴다.
 * 왜 dagre 끝점을 쓰나: 되돌림 선은 dagre 가 방향을 뒤집어 배치하므로 출발 노드의 위 변에서 나가 도착 노드의 아래 변으로 들어온다.
 * 손잡이(출발 아래·도착 위)로 바꿔 끼우면 그 선이 양 끝 노드를 가로지른다(WP-2089 리뷰). dagre 끝점은 노드 경계 위이고
 * 다음 점은 그 바깥이라 선이 노드 안으로 들어가지 않으며, 마지막 선분이 도착 노드 쪽을 향하므로 화살표도 노드를 가리킨다.
 * 도형 노드는 dagre 상자 가운데가 이름 위라서, 이웃 점이 노드 가운데보다 위면 위 변, 아니면 아래 변의 도형 가운데로 붙인다.
 */
export function routedPoints(
  edge: Pick<LaidEdge, 'from' | 'to' | 'points' | 'side'>,
  layout: Pick<GraphLayoutResult, 'positions' | 'sizes'>,
  shapeKeys: ReadonlySet<string>,
): { x: number; y: number }[] {
  const pts = edge.points.map((p) => ({ ...p }))
  // 옆 질문 왕복 선(WP-2123)은 묻는 노드 오른쪽 변에서 나가도록 이미 계산했다 — 도형 위·아래로 옮기면 이름 글자를 비스듬히 가로지른다
  if (pts.length < 2 || edge.side) return pts
  const snap = (key: string, end: number, neighbour: number) => {
    if (!shapeKeys.has(key)) return
    const pos = layout.positions.get(key)
    const size = layout.sizes.get(key)
    if (!pos || !size) return
    const above = pts[neighbour].y < pos.y + size.height / 2
    pts[end] = { x: pos.x + SHAPE_SIZE / 2, y: above ? pos.y : pos.y + size.height }
  }
  snap(edge.from, 0, 1)
  snap(edge.to, pts.length - 1, pts.length - 2)
  return pts
}
