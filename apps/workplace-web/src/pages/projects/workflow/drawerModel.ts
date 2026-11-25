/**
 * 노드·워크플로우 개요 서랍의 순수 모델(WP-2091) — 화면 상태 타입과 지시문 통계, 검사 결과를 노드·탭에 잇는 판정.
 * React 를 모르는 함수만 두어 vitest 로 바로 지킨다.
 */
import type { WorkflowProblem } from '@/lib/workflows'

import { questionNodeKeys } from './graphLayout'
import type { GraphNode, NodeDetail, NodePatch, WorkflowGraph } from './graphYaml'

export type NodeDrawerTab = 'settings' | 'paths' | 'runs'
export type OverviewTab = 'problems' | 'roles' | 'triggers' | 'shared'
/**
 * 그래프 편집기에 내려 주는 검사 결과 묶음(WP-2091) — 탭 머리 배지와 같은 값(목록·검사 중·지난 결과·실패·다시 확인)을
 * 개요 서랍의 「검사 결과」 탭과 노드 배지가 함께 쓴다.
 */
export interface GraphProblems {
  problems: WorkflowProblem[]
  checking: boolean
  failed: boolean
  stale: boolean
  onRetry: () => void
  /** 초안을 고칠 수 없는 때(저장 중·로그아웃·충돌) — 목록의 편집 빠른 조치를 끈다. 헤더 배지와 같은 판정을 쓰게 부모가 준다 */
  readOnly?: boolean
}

/**
 * 노드 서랍의 탭 하나(설정·결과·경로)가 받는 공통 props(WP-2091) — NodeDrawer 가 같은 묶음을 두 탭에 펼쳐 준다.
 */
export interface NodeTabProps {
  yaml: string
  graph: WorkflowGraph
  nodeKey: string
  detail: NodeDetail
  readOnly: boolean
  onChange: (yaml: string) => void
  /** updateNode 로 이 노드를 고쳐 올린다 */
  patch: (p: NodePatch) => void
}

/**
 * 이 노드의 「다음 노드」·「막혔을 때」 도착 후보 — 자기 자신·가상(질문 경로 줄임) 노드는 YAML 에 없는 키라 뺀다.
 * 시작 노드도 뺀다 — 실행의 입구일 뿐 일을 받지 않아 보낼 곳이 아니다. 결과·경로 탭과 설정 탭이 같은 후보를 쓴다.
 */
export function moveTargets(graph: WorkflowGraph, nodeKey: string): GraphNode[] {
  return graph.nodes.filter((n) => !n.virtual && n.key !== nodeKey && n.type !== 'start')
}

/** 서랍이 닫혀 있으면 null */
export type DrawerState = { kind: 'node'; key: string; tab: NodeDrawerTab } | { kind: 'overview'; tab: OverviewTab } | null

/**
 * 지시문 통계 — 글자 수(앞뒤 공백 뺀), 표(`|` 로 시작하는 줄 덩어리) 수, 제목(# 1~6개 + 공백) 줄 수.
 * 코드 울타리 안의 줄은 표·제목으로 세지 않는다(예시 코드의 # 주석이 제목으로 잡히지 않게).
 */
export function instructionStats(text: string): { chars: number; tables: number; headings: number } {
  let tables = 0
  let headings = 0
  let inFence = false
  let inTable = false
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('```') || line.startsWith('~~~')) {
      inFence = !inFence
      inTable = false
      continue
    }
    if (inFence) continue
    if (line.startsWith('|')) {
      if (!inTable) tables += 1
      inTable = true
    } else {
      inTable = false
      if (/^#{1,6}\s/.test(line)) headings += 1
    }
  }
  return { chars: text.trim().length, tables, headings }
}

/** 지시문 미리 보기 — 빈 줄을 빼고 앞 3줄. */
export function instructionPreview(text: string): string {
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .slice(0, 3)
    .join('\n')
}

/**
 * 검사 결과가 가리키는 노드를 서랍이 열 수 있는 노드로 바꾼다 — 숨은 질문 노드는 그 질문을 낸 노드로.
 * showAsk(질문 경로 펼침)면 화면에 보이는 질문 노드는 그대로 두고 가상 노드만 옮긴다.
 * null·그래프에 없는 키는 null.
 */
export function problemTargetNode(graph: WorkflowGraph, nodeKey: string | null, showAsk = false): string | null {
  return targetResolver(graph, showAsk)(nodeKey)
}

/**
 * problemTargetNode 의 본체 — 노드 맵·숨은 질문 노드 집합·「질문 받는 노드 → 질문 낸 노드」 맵을 한 번만 만들어 두고
 * 키마다 O(1) 로 푼다. 문제가 많을 때 단건 함수를 반복 호출하면 그래프를 문제 수만큼 다시 훑으므로(nodeProblemLevels) 나눴다.
 */
function targetResolver(graph: WorkflowGraph, showAsk: boolean): (nodeKey: string | null) => string | null {
  const nodes = new Map(graph.nodes.map((n) => [n.key, n]))
  const questionKeys = showAsk ? null : questionNodeKeys(graph)
  // 같은 도착을 가리키는 ask 간선이 여럿이면 먼저 나온 것을 쓴다(기존 find 와 같다)
  const askerOf = new Map<string, string>()
  for (const e of graph.edges) if (e.kind === 'ask' && !askerOf.has(e.to)) askerOf.set(e.to, e.from)
  return (nodeKey) => {
    const node = nodeKey === null ? undefined : nodes.get(nodeKey)
    if (nodeKey === null || !node) return null
    // 실제로 숨은 노드만 옮긴다 — 접힘이면 질문 노드 전부, 펼침이면 서랍으로 열 수 없는 가상(줄임) 질문 노드만
    const hidden = questionKeys === null ? node.virtual === true : questionKeys.has(nodeKey)
    return (hidden ? askerOf.get(nodeKey) : undefined) ?? nodeKey
  }
}

/**
 * 「결과·경로」 탭에서 고치는 검사 코드 — 결과(다음 노드)와 되돌림 제한(maxVisits)을 다루는 컨트롤이 그 탭에 있다.
 * 사람에게 묻기(ASK_PATH_MISSING·RETURN_TO_WITHOUT_ASK)는 이름에 ASK·RETURN 이 들어가도 「설정」 탭의 컨트롤이라 여기 넣지 않는다.
 */
const PATHS_TAB_CODES: ReadonlySet<string> = new Set(['TASK_OUTCOME_MISSING', 'LOOP_WITHOUT_MAX_VISITS'])

/**
 * 도착 노드(to) 검사 코드 — WorkflowValidator.checkEdges 가 모든 선(outcomes·conditions·onError)에 같은 코드로 낸다.
 * REF_NODE_UNKNOWN(정의 안 된 노드로 이동) · START_INCOMING(start 로 들어오는 연결). returnTo 도 REF_NODE_UNKNOWN 을 낸다. 문제에 경로가 없어 어느 선인지는 줄(line)의 YAML 로 가른다.
 */
const EDGE_TARGET_CODES: ReadonlySet<string> = new Set(['REF_NODE_UNKNOWN', 'START_INCOMING'])

/**
 * 문제 줄이 outcomes 블록 안인지 — 그 줄이나 위로 올라가며 들여쓰기가 더 얕은 조상 줄 중에 `outcomes:` 가 있으면 그렇다.
 * 같은 줄에 흐름 표기(`outcomes: { ok: { to: x } }`)로 쓴 경우도 잡는다. 줄 번호가 문서 밖이라 줄을 못 읽으면 undefined(호출자가 기본값을 정한다).
 * 결과 도착만 「결과·경로」 탭의 컨트롤이 고친다 — decision 의 conditions·default, human_task 의 returnTo, onError, 시작 조건의 to 는 같은 코드여도 여기 걸리지 않는다.
 */
function isOutcomeLine(yaml: string, line: number): boolean | undefined {
  const lines = yaml.split('\n')
  const at = lines[line - 1]
  if (at === undefined) return undefined
  if (/\boutcomes\s*:/.test(at)) return true
  const indent = (l: string) => l.length - l.trimStart().length
  let base = indent(at)
  for (let i = line - 2; i >= 0 && base > 0; i -= 1) {
    const l = lines[i]
    if (l.trim() === '' || l.trim().startsWith('#')) continue
    if (indent(l) < base) {
      if (/^\s*(-\s+)?outcomes\s*:/.test(l)) return true
      base = indent(l)
    }
  }
  return false
}

/**
 * 검사 문제를 실제로 고칠 컨트롤이 있는 서랍 탭으로 잇는다.
 * 결과·경로 탭: 결과 도착이 비었거나(TASK_OUTCOME_MISSING)·되돌림 제한(LOOP_WITHOUT_MAX_VISITS), 그리고 outcomes 의 to 가 가리키는 노드 문제(REF_NODE_UNKNOWN·START_INCOMING, 줄의 YAML 로 판정).
 * 나머지는 모두 「설정」 — onError·decision 조건·default·returnTo·시작 조건의 to 가 같은 코드를 내도 결과 컨트롤로는 못 고친다.
 * 설정 탭에 컨트롤이 없는 것(decision 조건·returnTo)은 설정 탭의 「YAML 에서 고치기」 안내가 맡는다.
 * yaml 을 안 주면(줄을 못 읽으면) 더 흔한 쪽인 결과의 to, 곧 「결과·경로」로 본다.
 */
export function problemTab(problem: Pick<WorkflowProblem, 'code' | 'line'>, yaml?: string): NodeDrawerTab {
  if (PATHS_TAB_CODES.has(problem.code)) return 'paths'
  if (EDGE_TARGET_CODES.has(problem.code)) {
    // 줄을 못 읽으면(yaml 없음·줄 번호가 문서 밖 → undefined) 더 흔한 결과의 to 로 본다 — 못 읽은 것과 outcomes 밖(false)을 구분한다
    const outcome = yaml === undefined ? undefined : isOutcomeLine(yaml, problem.line)
    return outcome === false ? 'settings' : 'paths'
  }
  return 'settings'
}

/** 노드 키별 가장 센 검사 등급(ERROR > WARNING). 노드를 못 찾는 문제는 담지 않는다. */
export function nodeProblemLevels(graph: WorkflowGraph, problems: WorkflowProblem[], showAsk = false): Map<string, 'ERROR' | 'WARNING'> {
  const levels = new Map<string, 'ERROR' | 'WARNING'>()
  const resolve = targetResolver(graph, showAsk)
  for (const p of problems) {
    const key = resolve(p.nodeKey)
    if (key === null) continue
    if (p.severity === 'ERROR' || levels.get(key) !== 'ERROR') levels.set(key, p.severity)
  }
  return levels
}

/** key 에서 나가는 ask 간선의 도착 노드 — 없으면 null. */
export function askTarget(graph: WorkflowGraph, key: string): GraphNode | null {
  const edge = graph.edges.find((e) => e.kind === 'ask' && e.from === key)
  return (edge && graph.nodes.find((n) => n.key === edge.to)) || null
}
