// 워크플로우 그래프 자리 계산(WP-1991) — dagre 로 노드 위치·간선 꺾임점만 구하는 순수 함수.
// 왜: 그리기는 SVG·HTML 로 직접 하므로 자리 계산이 순수 함수여야 jsdom(vitest)에서 칠하기·배지를 셀 단위로 검사할 수 있다.
import dagre from '@dagrejs/dagre'

import { groupByEndpoints, joinEdgeLabels } from './parallelEdges'
import { isQuestionPathNode } from './workflow'
import { outcomeDisplayName } from './workflowNames'
import type { WorkflowModel, WorkflowModelNode } from './workflows'

export const GRAPH_NODE_WIDTH = 160
export const GRAPH_NODE_HEIGHT = 56

export interface GraphEdge {
  from: string
  to: string
  label: string
  points: { x: number; y: number }[]
}

export interface WorkflowGraphLayout {
  nodes: { key: string; x: number; y: number; width: number; height: number }[]
  edges: GraphEdge[]
  width: number
  height: number
}

/** 공개 모델에 이미 들어 있는 전이를 읽는다(outcomes·조건·기본·오류·돌아가기). 종료 노드에는 이어지는 단계가 없다. */
export function outgoingEdges(node: WorkflowModelNode, model: WorkflowModel): { label: string; to: string }[] {
  const edges = (node.outcomes ?? []).map((outcome) => ({ label: outcomeDisplayName(outcome.key, outcome.name), to: outcome.to }))
  const conditions = node.type === 'start' ? model.start : node.conditions
  for (const [index, condition] of (conditions ?? []).entries()) {
    edges.push({ label: `조건 ${index + 1}`, to: condition.to })
  }
  if (node.defaultTo) edges.push({ label: '기본', to: node.defaultTo })
  if (node.onError) edges.push({ label: '오류', to: node.onError.to })
  if (node.returnTo) edges.push({ label: '돌아가기', to: node.returnTo })
  return edges
}

/** 위에서 아래(TB)로 흐르게 자리를 잡는다. x·y 는 노드 왼쪽 위 모서리. 모델에 없는 노드로 가는 간선은 뺀다. */
export function layoutWorkflowGraph(model: WorkflowModel): WorkflowGraphLayout {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 56, marginx: 16, marginy: 16 })
  g.setDefaultEdgeLabel(() => ({}))
  const keys = new Set(model.nodes.map((n) => n.key))
  for (const n of model.nodes) g.setNode(n.key, { width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT })

  // 같은 (출발, 도착) 간선은 한 줄로 합친다(WP-2048) — 질문 노드의 returnTo 와 answered outcome 처럼
  // 평행 간선이 같은 자리에 겹쳐 그려지면 라벨이 포개져 읽히지 않기 때문이다. 규칙은 편집 그래프와 같은 groupByEndpoints 를 쓴다.
  const groups = groupByEndpoints(
    model.nodes.flatMap((n) => outgoingEdges(n, model).filter((e) => keys.has(e.to)).map((e) => ({ from: n.key, ...e }))),
  )
  // dagre 에는 묶음마다 한 번만 넣어 평행 간선 자체를 만들지 않는다 — (출발, 도착)이 하나뿐이라 multigraph 이름도 필요 없다.
  for (const group of groups) g.setEdge(group.from, group.to, {})
  dagre.layout(g)

  const nodes = model.nodes.map((n) => {
    const p = g.node(n.key)
    return { key: n.key, x: p.x - GRAPH_NODE_WIDTH / 2, y: p.y - GRAPH_NODE_HEIGHT / 2, width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT }
  })
  const edges = groups.map((e) => ({
    from: e.from,
    to: e.to,
    label: joinEdgeLabels(e.members.map((m) => m.label)),
    points: (g.edge(e.from, e.to)?.points ?? []).map((pt: { x: number; y: number }) => ({ x: pt.x, y: pt.y })),
  }))
  const info = g.graph()
  return { nodes, edges, width: info.width ?? 0, height: info.height ?? 0 }
}

// ---- compact 실행 그래프(WP-2157) ----
// 실행 상세 좌측 칸용 — 본 흐름은 한 줄로 세우고, 질문 단계는 dagre 에서 빼 원래 노드 옆 표식(또는 지금 노드면 곁 노드)으로 보인다.
// 라벨은 되돌아가는 간선에만 단다. 모든 상자가 레이아웃 경계 안에 들어오게 마지막에 한 번 밀어 맞춘다.

export const COMPACT_NODE_WIDTH = 144
export const COMPACT_NODE_HEIGHT = 48
const COMPACT_PAD = 16
const SIDE_GAP = 12
const MARKER_HEIGHT = 20
/** 표식 사이·곁 노드와 표식 사이의 세로 간격. */
const MARKER_GAP = 4
const BACK_LABEL_HEIGHT = 16
const BACK_LABEL_GAP = 8

export interface CompactBox {
  x: number
  y: number
  width: number
  height: number
}

export interface CompactRunGraph {
  nodes: ({ key: string } & CompactBox)[]
  edges: { from: string; to: string; back: boolean; points: { x: number; y: number }[] }[]
  backLabels: ({ from: string; to: string; text: string } & CompactBox)[]
  askMarkers: ({ owner: string; askKey: string; text: string } & CompactBox)[]
  askCurrent: ({ owner: string; askKey: string; outcome: string } & CompactBox) | null
  width: number
  height: number
}

/** 글자 폭 근사 — 글자당 7px + 좌우 여백 16px. */
const textBoxWidth = (text: string) => text.length * 7 + 16

/** 상자와 간선 점을 모두 담는 경계 — 상자가 없고 점도 없으면 min 은 Infinity, max 는 -Infinity. */
function extentOf(boxes: CompactBox[], pts: { x: number; y: number }[]) {
  return {
    minX: Math.min(...boxes.map((b) => b.x), ...pts.map((p) => p.x)),
    minY: Math.min(...boxes.map((b) => b.y), ...pts.map((p) => p.y)),
    maxX: Math.max(...boxes.map((b) => b.x + b.width), ...pts.map((p) => p.x)),
    maxY: Math.max(...boxes.map((b) => b.y + b.height), ...pts.map((p) => p.y)),
  }
}

/** compact 실행 그래프 자리를 계산한다(순수 함수). */
export function layoutCompactRunGraph(model: WorkflowModel, currentNode: string | null): CompactRunGraph {
  const byKey = new Map(model.nodes.map((n) => [n.key, n]))
  // 질문 단계 = 표준 질문 경로 모양 노드. 그 단계는 본 흐름에서 뺀다.
  // WP-2157: 질문 모양이어도 returnTo 가 본 흐름 노드가 아니면(없음·다른 질문 노드·옛 키) 곁에 붙일 곳이 없어 사라지므로 본 흐름에 남긴다.
  const shapedKeys = new Set(
    model.nodes.filter((n) => isQuestionPathNode(n.type, n.returnTo, (n.outcomes ?? []).map((o) => o.key))).map((n) => n.key),
  )
  // 질문 단계 술어 — returnTo 가 있고 실제 노드이며 그 노드가 질문 모양이 아닐 때(= 본 흐름 노드)만 곁에 붙는다. 한 곳에서만 판정한다.
  const isQuestionNode = (n: WorkflowModel['nodes'][number]) =>
    shapedKeys.has(n.key) && !!n.returnTo && byKey.has(n.returnTo) && !shapedKeys.has(n.returnTo)
  const mainNodes = model.nodes.filter((n) => !isQuestionNode(n))
  const mainKeys = new Set(mainNodes.map((n) => n.key))

  // 질문 단계별 표식/곁 노드 정보 — dagre 에 원래 노드의 옆자리를 미리 예약하려고 배치 전에 구한다.
  const askInfos = model.nodes
    .filter(isQuestionNode)
    .map((q) => {
      const owner = q.returnTo as string
      const outcome = joinEdgeLabels(outgoingEdges(byKey.get(owner)!, model).filter((e) => e.to === q.key).map((e) => e.label))
      const isCurrent = q.key === currentNode
      const text = `${outcome} → 사람 차례`
      return { q, owner, outcome, isCurrent, text, width: isCurrent ? COMPACT_NODE_WIDTH : textBoxWidth(text) }
    })
  // 원래 노드별 한 번에 모으는 예약 정보 — 폭(가장 넓은 표식/곁 노드)·곁 노드 유무·표식 개수.
  const ownerInfo = new Map<string, { sideWidth: number; hasCurrentSide: boolean; markerCount: number }>()
  for (const a of askInfos) {
    const info = ownerInfo.get(a.owner) ?? { sideWidth: 0, hasCurrentSide: false, markerCount: 0 }
    info.sideWidth = Math.max(info.sideWidth, a.width)
    if (a.isCurrent) info.hasCurrentSide = true
    else info.markerCount++
    ownerInfo.set(a.owner, info)
  }
  // WP-2157: 곁 노드(지금 질문)가 있는 원래 노드는 표식을 그 아래(48+간격)부터 쌓는다. 표식이 시작하는 y 오프셋(원래 노드 위 기준).
  const markerStartOffset = (owner: string) =>
    ownerInfo.get(owner)?.hasCurrentSide ? COMPACT_NODE_HEIGHT + MARKER_GAP : (COMPACT_NODE_HEIGHT - MARKER_HEIGHT) / 2
  // 표식 쌓임이 원래 노드 아래로 넘치는 만큼 위아래 대칭으로 높이를 예약해 아래 순위 노드와 겹치지 않게 한다.
  const extraHeight = (owner: string) => {
    const n = ownerInfo.get(owner)?.markerCount ?? 0
    if (n === 0) return 0
    const bottom = markerStartOffset(owner) + n * (MARKER_HEIGHT + MARKER_GAP) - MARKER_GAP
    return Math.max(0, bottom - COMPACT_NODE_HEIGHT)
  }

  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 40, marginx: 0, marginy: 0 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of mainNodes) {
    // 원래 노드의 예약 폭 = 노드 + 양옆 (간격 + 가장 넓은 표식). 좌우 대칭으로 잡아 본 흐름 노드가 한 줄(같은 x)에 서게 한다.
    const side = ownerInfo.get(n.key)?.sideWidth
    g.setNode(n.key, { width: COMPACT_NODE_WIDTH + (side ? 2 * (SIDE_GAP + side) : 0), height: COMPACT_NODE_HEIGHT + 2 * extraHeight(n.key) })
  }

  // 질문 단계로 들어가고 나가는 간선은 제외 — 양 끝이 모두 본 흐름인 간선만 같은 (출발, 도착)끼리 묶어 넣는다.
  const allEdges = model.nodes.flatMap((n) => outgoingEdges(n, model).map((e) => ({ from: n.key, ...e })))
  const groups = groupByEndpoints(allEdges.filter((e) => mainKeys.has(e.from) && mainKeys.has(e.to)))
  for (const group of groups) g.setEdge(group.from, group.to, {})
  dagre.layout(g)

  const nodes = mainNodes.map((n) => {
    const p = g.node(n.key)
    return { key: n.key, x: p.x - COMPACT_NODE_WIDTH / 2, y: p.y - COMPACT_NODE_HEIGHT / 2, width: COMPACT_NODE_WIDTH, height: COMPACT_NODE_HEIGHT }
  })
  const nodeBox = new Map(nodes.map((n) => [n.key, n]))

  const edges = groups.map((e) => ({
    from: e.from,
    to: e.to,
    // 되돌아가는 간선 = 도착이 출발보다 위(y 가 작음)
    back: g.node(e.to).y < g.node(e.from).y,
    points: ((g.edge(e.from, e.to)?.points ?? []) as { x: number; y: number }[]).map((pt) => ({ x: pt.x, y: pt.y })),
    label: joinEdgeLabels(e.members.map((m) => m.label)),
  }))

  // 되돌아가는 간선 라벨 — 꺾임점 중 가장 왼쪽 점의 왼쪽에 둔다.
  const backLabels = edges
    .filter((e) => e.back && e.points.length > 0)
    .map((e) => {
      const text = `${e.label} → ${byKey.get(e.to)?.name || e.to} ↺`
      const width = textBoxWidth(text)
      const mid = e.points[Math.floor(e.points.length / 2)]
      const y = mid.y - BACK_LABEL_HEIGHT / 2
      // 오른쪽 끝 = 간선 최좌측 점과, 라벨 높이 구간에 걸치는 모든 본 흐름 노드의 왼쪽 끝 중 더 왼쪽 − 8
      const limit = Math.min(
        ...e.points.map((pt) => pt.x),
        ...nodes.filter((n) => n.y < y + BACK_LABEL_HEIGHT && y < n.y + n.height).map((n) => n.x),
      )
      return { from: e.from, to: e.to, text, x: limit - BACK_LABEL_GAP - width, y, width, height: BACK_LABEL_HEIGHT }
    })

  // 질문 단계 표식 — 원래 노드(returnTo) 오른쪽, 세로 가운데. 같은 원래 노드에 여럿이면 아래로 쌓는다.
  const askMarkers: CompactRunGraph['askMarkers'] = []
  let askCurrent: CompactRunGraph['askCurrent'] = null
  const stacked = new Map<string, number>()
  for (const a of askInfos) {
    const owner = nodeBox.get(a.owner)!
    const x = owner.x + owner.width + SIDE_GAP
    if (a.isCurrent) {
      askCurrent = { owner: a.owner, askKey: a.q.key, outcome: a.outcome, x, y: owner.y, width: COMPACT_NODE_WIDTH, height: COMPACT_NODE_HEIGHT }
      continue
    }
    const index = stacked.get(a.owner) ?? 0
    stacked.set(a.owner, index + 1)
    askMarkers.push({
      owner: a.owner,
      askKey: a.q.key,
      text: a.text,
      x,
      y: owner.y + markerStartOffset(a.owner) + index * (MARKER_HEIGHT + MARKER_GAP),
      width: a.width,
      height: MARKER_HEIGHT,
    })
  }

  // 모든 상자를 모아 경계를 잡고, 최소 x·y 가 늘 여백(COMPACT_PAD)에 오도록 전체(간선 점 포함)를 평행 이동한다.
  // 작을 때만 밀면 dagre 의 좌우 대칭 예약이 남긴 빈 여백이 그대로 남아 그래프가 칸보다 넓어진다(WP-2157) — 여백 계산은 여기 한 곳.
  const boxes: CompactBox[] = [...nodes, ...backLabels, ...askMarkers, ...(askCurrent ? [askCurrent] : [])]
  const before = extentOf(boxes, edges.flatMap((e) => e.points))
  const dx = COMPACT_PAD - before.minX
  const dy = COMPACT_PAD - before.minY
  for (const b of boxes) {
    b.x += dx
    b.y += dy
  }
  const outEdges = edges.map((e) => ({
    from: e.from,
    to: e.to,
    back: e.back,
    points: e.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })),
  }))
  const after = extentOf(boxes, outEdges.flatMap((e) => e.points))
  const width = boxes.length ? after.maxX + COMPACT_PAD : 0
  const height = boxes.length ? after.maxY + COMPACT_PAD : 0
  return { nodes, edges: outEdges, backLabels, askMarkers, askCurrent, width, height }
}
