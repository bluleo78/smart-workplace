// 워크플로우 그래프 자리 계산(WP-1991) — dagre 로 노드 위치·간선 꺾임점만 구하는 순수 함수.
// 왜: 그리기는 SVG·HTML 로 직접 하므로 자리 계산이 순수 함수여야 jsdom(vitest)에서 칠하기·배지를 셀 단위로 검사할 수 있다.
import dagre from '@dagrejs/dagre'

import { groupByEndpoints, joinEdgeLabels } from './parallelEdges'
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
