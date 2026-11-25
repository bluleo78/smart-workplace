import type { AriaLabelConfig } from '@xyflow/react'

import type { GraphEdge, GraphNode } from './graphYaml'

/** 그래프 편집 영역(React Flow 캔버스)의 접근 이름 */
export const GRAPH_EDITOR_ARIA_LABEL = '워크플로우 그래프 편집'

/** 담당이 없는 노드의 종류 이름 — 화면에 보이는 종류와 맞춘다. 모르는 type 은 그대로 읽힌다. */
const KIND_LABEL: Record<string, string> = {
  start: '시작',
  end: '종료',
  decision: '분기',
}

/**
 * 노드 카드의 담당 줄 — agent_task → AI, human_task → 사람, 역할 이름이 있으면 ` · <역할>`. 담당이 없는 종류는 null.
 * 화면 카드와 접근 이름이 함께 쓰는 한 곳이다.
 */
export function nodeActorLabel(node: GraphNode, roleName?: string): string | null {
  const actor = node.type === 'agent_task' ? 'AI' : node.type === 'human_task' ? '사람' : null
  if (!actor) return null
  return roleName ? `${actor} · ${roleName}` : actor
}

/**
 * 노드의 스크린리더용 접근 이름. 「표시 이름, 담당(또는 종류)」 꼴. 이름이 없으면 key 로 대신한다.
 */
export function nodeAriaLabel(node: GraphNode, roleName?: string): string {
  const title = node.name ?? node.key
  const tail = nodeActorLabel(node, roleName) ?? KIND_LABEL[node.type] ?? node.type
  // 가상 노드(질문 경로)는 YAML 에 없는 노드라 편집할 수 없음을 이름에 밝힌다
  return node.virtual ? `${title}, ${tail}, 질문 경로(편집 불가)` : `${title}, ${tail}`
}

/**
 * 선의 접근 이름. 「출발 → 도착」, 라벨이 있으면 뒤에 괄호로 덧붙인다.
 * names 는 노드 키 → 표시 이름이며, 없는 키는 키 그대로 읽는다.
 */
export function edgeAriaLabel(edge: GraphEdge, names: Map<string, string>): string {
  const from = names.get(edge.from) ?? edge.from
  const to = names.get(edge.to) ?? edge.to
  const base = `${from} → ${to}`
  // 질문 경로 선은 라벨 대신 「질문」으로 읽는다
  if (edge.kind === 'ask') return `${base} (질문)`
  return edge.label ? `${base} (${edge.label})` : base
}

/** 키 입력이 편집 패널에 미치는 동작 — 열기(노드 키) / 닫기 / 없음(null) */
export type PanelAction = { open: string } | { close: true } | null

/**
 * 키 입력으로 편집 패널을 열거나 닫을지 판정한다. nodeId 는 키가 눌린 곳의 노드.
 * Enter·Space 는 실제(가상 아닌) 노드일 때만 그 노드를 연다. Escape 는 노드 위에서만 닫는다 — React Flow 가 Esc 로 선택을 풀므로
 * 패널도 함께 닫아 선택과 패널 상태가 어긋나지 않게 한다. 선택 변경이 아니라 키 입력으로 보는 까닭: 마우스 드래그도
 * 노드를 선택하므로 선택 변경을 패널 열기로 오인하지 않게 하려는 것이다.
 */
export function panelActionFromKeyDown(key: string, nodeId: string | null, realKeys: Set<string>): PanelAction {
  if (nodeId === null) return null
  if (key === 'Escape') return { close: true }
  if (key !== 'Enter' && key !== ' ') return null
  return realKeys.has(nodeId) ? { open: nodeId } : null
}

/** 이동 방향 → 한국어 방향 문구 */
const DIRECTION_LABEL: Record<string, string> = {
  up: '위로',
  down: '아래로',
  left: '왼쪽으로',
  right: '오른쪽으로',
}

/**
 * React Flow 기본(영어) 안내 문구를 한국어로 바꾸는 설정 — ReactFlow 의 ariaLabelConfig 에 넘긴다.
 * 주의: React Flow 의 키 이름은 뜻이 뒤집혀 있다. `node.a11yDescription.keyboardDisabled` 는 disableKeyboardA11y=false(기본)일 때
 * 보이는, 실제 쓰이는 문구이고 `default` 는 disableKeyboardA11y=true 일 때만 쓰이므로 키보드 안내 없이 중립 문구로 둔다.
 */
export const GRAPH_ARIA_LABEL_CONFIG: Partial<AriaLabelConfig> = {
  'node.a11yDescription.default': '워크플로우 노드입니다.',
  'node.a11yDescription.keyboardDisabled':
    'Enter·Space 로 노드를 골라 편집 패널을 엽니다. 고른 뒤 화살표로 노드를 옮기고, Esc 로 선택을 풀고 편집 패널을 닫습니다.',
  'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }) =>
    `고른 노드를 ${DIRECTION_LABEL[direction] ?? direction} 옮겼습니다. 새 위치 x ${x}, y ${y}`,
  'edge.a11yDescription.default': 'Enter·Space 로 선을 고르고 Esc 로 선택을 풉니다.',
}

/** 읽기 전용(저장·게시 중)에는 노드를 옮길 수 없으므로 화살표 이동 안내를 뺀 설정. */
export const GRAPH_ARIA_LABEL_CONFIG_READONLY: Partial<AriaLabelConfig> = {
  ...GRAPH_ARIA_LABEL_CONFIG,
  'node.a11yDescription.keyboardDisabled':
    'Enter·Space 로 노드를 골라 편집 패널을 열고, Esc 로 닫습니다.',
}
