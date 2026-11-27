// 워크플로우 실행 조회 — 응답 타입과 화면용 순수 함수(WP-1991). 서버 상태 훅은 hooks/queries/useWorkflowRuns.ts.
// 이슈 하나에 걸린 실행의 시작·이동·조치는 lib/workflow.ts, 정의 편집·게시는 lib/workflows.ts. 응답 모양은 서버 WorkflowRunPage·WorkflowRunDetail·MyWorkflowTurn 과 같다.
import { MENTION_TOKEN } from '@/components/mentions/chatMarkdown'

import { ACTIVE_RUN_STATUSES, isQuestionPathNode, type RunStatus, type WorkflowUser } from './workflow'
import type { WorkflowModel } from './workflows'

/** 실행 목록 한 줄. */
export interface WorkflowRunItem {
  runId: number
  issueId: number
  issueKey: string
  title: string
  status: RunStatus
  currentNode: string
  currentNodeName: string | null
  assignees: WorkflowUser[]
  enteredAt: string
  startedAt: string
  versionNo: number
}

export interface WorkflowRunPage {
  items: WorkflowRunItem[]
  nextCursor: string | null
}

/** 노드 방문 하나. */
export interface WorkflowNodeRun {
  id: number
  nodeKey: string
  nodeName: string | null
  visitNo: number
  status: 'ACTIVE' | 'BLOCKED' | 'COMPLETED' | 'FAILED' | 'CANCELED'
  assignees: WorkflowUser[]
  workflowAssigned: WorkflowUser[]
  outcome: string | null
  outputs: unknown
  commentId: number | null
  waitingReason: string | null
  error: string | null
  actor: WorkflowUser | null
  enteredAt: string
  leftAt: string | null
  viaReturn: boolean
}

export interface WorkflowRunDetail {
  run: {
    runId: number
    workflowId: number
    versionNo: number
    issueId: number
    issueNumber: number
    issueKey: string
    title: string
    status: RunStatus
    revision: number
    currentNode: string
    startedBy: WorkflowUser | null
    startedAt: string
    endedAt: string | null
    context: Record<string, unknown>
  }
  nodeRuns: WorkflowNodeRun[]
  events: unknown[]
  model: WorkflowModel
}

/** 내 작업 「내 차례」 한 줄. */
export interface MyWorkflowTurn {
  runId: number
  issueId: number
  issueNumber: number
  issueKey: string
  title: string
  projectId: number
  projectKey: string
  workflowId: number
  workflowName: string
  versionNo: number
  nodeKey: string
  nodeName: string | null
  enteredAt: string
  handedBy: WorkflowUser | null
  /** 지금 노드의 미답 질문의 첫 줄 */
  question: string | null
  /** 지금 노드가 질문 경로(returnTo 있음)인가 — 이면 이슈 챗에서 답한다(WP-2093) */
  asking: boolean
}

/** 실행 목록 필터 — 서버가 상태는 값 하나만 받는다. */
export interface RunFilters {
  status?: RunStatus | 'ACTIVE'
  node?: string
  assigneeId?: number
}

/** run-counts 응답(GET /workflows/{id}/run-counts) — 노드별 진행 중 수와 상태별 실행 수(WP-2157). */
export interface WorkflowRunCounts {
  counts: Record<string, number>
  byStatus: Record<RunStatus, number>
}

/** 내 차례 응답(GET /me/workflow-turns). */
export interface MyWorkflowTurnList {
  items: MyWorkflowTurn[]
}

export type NodePaint = 'passed' | 'failed' | 'current' | 'unvisited'

/** 실행이 아직 어딘가에서 기다리거나 도는 중인가(끝난 실행에는 「지금 노드」가 없다). */
export function isRunActive(status: RunStatus): boolean {
  return ACTIVE_RUN_STATUSES.includes(status)
}

/** 그 노드의 마지막 방문(id 가 가장 큰)이 실패·차단으로 멈췄는지 — 멈춘(SUSPENDED) 실행의 지금 노드를 실패로 칠할지 가린다. */
function stoppedAt(nodeRuns: WorkflowRunDetail['nodeRuns'], nodeKey: string): boolean {
  let last: WorkflowRunDetail['nodeRuns'][number] | undefined
  for (const v of nodeRuns) if (v.nodeKey === nodeKey && (!last || v.id > last.id)) last = v
  return last?.status === 'FAILED' || last?.status === 'BLOCKED'
}

/**
 * 그래프 칠하기 — 정상 끝난(COMPLETED) 방문이 있는 노드는 passed, 실패(FAILED) 방문이 있고 지나온 적이 없으면 failed,
 * 실행이 활성이면 지금 노드는 current, 모델의 나머지는 unvisited. 실패 방문을 지나옴(체크)으로 칠하면 오해를 부른다.
 * 모델에 없는 노드(옛 버전 방문 등)는 키에서 뺀다.
 */
export function paintRun(detail: WorkflowRunDetail): Record<string, NodePaint> {
  const paint: Record<string, NodePaint> = {}
  for (const node of detail.model.nodes) paint[node.key] = 'unvisited'
  for (const visit of detail.nodeRuns) {
    if (!(visit.nodeKey in paint)) continue
    if (visit.status === 'COMPLETED') paint[visit.nodeKey] = 'passed'
    else if (visit.status === 'FAILED' && paint[visit.nodeKey] !== 'passed') paint[visit.nodeKey] = 'failed'
  }
  const current = detail.run.currentNode
  // 멈춘 실행(SUSPENDED)의 지금 노드는 그 방문이 실패·막힘(FAILED·BLOCKED)으로 멈춘 때만 실패로 칠한다 — 질문 단계에서
  // 막혀 멈췄을 때 곁 노드가 사람 차례(주황)로 보이지 않게 한다. 다른 까닭(상태 삭제·방문 상한 등)으로 멈춰 방문이 진행 중이면
  // 그 노드에서 실패한 것이 아니므로 「지금」 그대로 둔다(WP-2157 리뷰 후속).
  if (detail.run.status === 'SUSPENDED' && current in paint && stoppedAt(detail.nodeRuns, current)) paint[current] = 'failed'
  else if (isRunActive(detail.run.status) && current in paint) paint[current] = 'current'
  return paint
}

/** 노드별 머문 시간 합(ms) — 아직 머무는 방문은 now 까지. 같은 노드를 여러 번 방문하면 더한다. */
export function nodeDurationsMs(detail: WorkflowRunDetail, now: Date): Record<string, number> {
  const out: Record<string, number> = {}
  for (const v of detail.nodeRuns) {
    const end = v.leftAt != null ? new Date(v.leftAt).getTime() : now.getTime()
    out[v.nodeKey] = (out[v.nodeKey] ?? 0) + Math.max(0, end - new Date(v.enteredAt).getTime())
  }
  return out
}

export interface RunMoveRow {
  id: string
  from: string | null
  to: string
  actorName: string | null
  outcome: string | null
  at: string
  assigned: string[]
  /** 질문 단계로 들어간 줄의 질문 첫 줄(멘션은 이름으로) — 아니거나 원문이 없으면 null(WP-2157). */
  question: string | null
  /** 방문이 start 노드 하나뿐인 시작 줄 — 화면이 「워크플로우 시작」만 보인다(WP-2157). */
  soleStart: boolean
}

/**
 * 이동 기록 — 방문마다 한 줄(앞 노드 → 이 노드), 시간 역순.
 * 이동을 한 사람·결과는 앞 방문이 가진 값이고, 첫 줄(시작)은 시작한 사람이다. assigned 는 이 방문에서 워크플로우가 담당으로 넣은 사람.
 * WP-2157: 가장 이른 방문이 start 노드이고 다음 방문이 있으면 「시작 → 첫 노드」 두 줄 대신 한 줄(from null, to 첫 노드)로 합친다.
 * 질문 단계로 들어간 줄에는 run.context._qa 의 질문 첫 줄을 붙인다(원래 노드에서 질문해 들어온 방문만, 그 방문 목록 끝과 항목 목록 끝을 맞춰 짝지음).
 */
export function runMoveRows(detail: WorkflowRunDetail): RunMoveRow[] {
  const visits = [...detail.nodeRuns].sort((a, b) => a.id - b.id)
  const nodeByKey = new Map(detail.model.nodes.map((n) => [n.key, n]))
  const names = runUserNames(detail)
  const qa = detail.run.context['_qa']
  const entries = Array.isArray(qa) ? (qa as { answerNode?: string; question?: unknown }[]) : []
  // WP-2157: 질문과 짝지을 수 있는 방문 = 앞 방문이 이 질문 단계의 returnTo 노드이고, 그 방문의 결과가 이 질문 단계로 가는 결과인 방문
  // (원래 노드에서 질문 결과로 들어온 방문 — 서버가 _qa 항목을 남기는 경우와 같다). recover MOVE_TO 로 들어온 방문은 결과 이동이
  // 아니라 _qa 항목이 없으므로 짝에서 뺀다(같은 returnTo 노드에서 옮겨 와도 — 끼면 질문이 한 칸씩 밀린다).
  const askVisitsOfNode = new Map<string, number[]>()
  // 첫 방문은 앞 방문이 없어 질문으로 들어온 방문일 수 없다 — 1부터 본다.
  for (let i = 1; i < visits.length; i++) {
    const v = visits[i]
    const prev = visits[i - 1]
    const node = nodeByKey.get(v.nodeKey)
    if (!node || !isQuestionPathNode(node.type, node.returnTo, node.outcomes.map((o) => o.key))) continue
    if (prev.nodeKey !== node.returnTo || prev.outcome == null) continue
    const owner = nodeByKey.get(prev.nodeKey)
    if (!owner?.outcomes.some((o) => o.key === prev.outcome && o.to === v.nodeKey)) continue
    const ids = askVisitsOfNode.get(v.nodeKey)
    if (ids) ids.push(v.id)
    else askVisitsOfNode.set(v.nodeKey, [v.id])
  }
  // 질문 항목을 답할 노드별로 한 번 묶어 둔다(방문마다 다시 거르지 않게).
  const entriesOfNode = new Map<string, { question?: unknown }[]>()
  for (const x of entries) {
    if (!x || x.answerNode === undefined) continue
    const list = entriesOfNode.get(x.answerNode)
    if (list) list.push(x)
    else entriesOfNode.set(x.answerNode, [x])
  }
  const questionOf = (v: WorkflowNodeRun): string | null => {
    const ids = askVisitsOfNode.get(v.nodeKey)
    if (!ids || !ids.includes(v.id)) return null
    const mine = entriesOfNode.get(v.nodeKey) ?? []
    // 서버는 최근 QA_MAX 개만 남기므로 앞이 잘릴 수 있다 — 짝지을 방문 목록의 끝과 항목 목록의 끝을 맞춘다. 항목이 더 적으면 앞 방문은 null.
    const e = mine[mine.length - (ids.length - ids.indexOf(v.id))]
    if (!e || typeof e.question !== 'string') return null
    const line = questionFirstLine(e.question)
    return line == null ? null : mentionTokensAsNames(line, names)
  }
  const startedBy = detail.run.startedBy?.name ?? null
  // 방문마다 한 줄(앞 방문 → 이 방문). 첫 방문은 시작 줄(시작한 사람).
  const rows: RunMoveRow[] = visits.map((v, i) => {
    const prev = i > 0 ? visits[i - 1] : null
    return {
      id: String(v.id),
      from: prev ? (prev.nodeName ?? prev.nodeKey) : null,
      to: v.nodeName ?? v.nodeKey,
      actorName: prev ? (prev.actor?.name ?? null) : startedBy,
      outcome: prev ? prev.outcome : null,
      at: v.enteredAt,
      assigned: v.workflowAssigned.map((u) => u.name),
      question: questionOf(v),
      soleStart: false,
    }
  })
  if (visits.length > 1 && nodeByKey.get(visits[0].nodeKey)?.type === 'start') {
    // 시작 줄을 다음 줄에 합친다 — 0번 줄을 빼고 1번 줄을 「시작 → 첫 노드」(시작자·첫 방문 시각)로 고친다.
    const [start, first] = rows
    rows.splice(0, 2, { ...first, from: null, actorName: start.actorName, outcome: null, at: start.at })
  } else if (visits.length === 1 && nodeByKey.get(visits[0].nodeKey)?.type === 'start') {
    // 방문이 start 하나뿐(다음 단계 전)이면 화면이 「→」 없이 시작만 보이게 표시한다.
    rows[0].soleStart = true
  }
  return rows.reverse()
}

/** 지금 노드에서 아직 답하지 않은 질문 — 서버 _qa 의 마지막 미답 항목(answerNode 가 그 노드). 없으면 null. */
export function pendingQuestion(context: Record<string, unknown>, nodeKey: string): string | null {
  const qa = context['_qa']
  if (!Array.isArray(qa)) return null
  for (let i = qa.length - 1; i >= 0; i--) {
    const e = qa[i] as { answerNode?: string; answer?: unknown; question?: unknown }
    if (e && e.answerNode === nodeKey && e.answer == null && typeof e.question === 'string') return e.question
  }
  return null
}

/**
 * 질문 글의 첫 줄(WP-2093) — 앞뒤 빈 줄·공백을 건너뛴 첫 줄을 trim, 비면 null. 서버 MyWorkflowTurn.question 과 같은 규칙.
 * 질문 원문(이슈 챗 질문)은 여러 줄·목록일 수 있어 한 줄 자리에는 첫 줄만 보인다.
 */
export function questionFirstLine(q: string | null): string | null {
  if (q == null) return null
  for (const line of q.split(/\r?\n|\r/)) {
    const t = line.trim()
    if (t !== '') return t
  }
  return null
}

/**
 * 실행 상세에 실린 사람의 id → 이름(WP-2093) — 시작한 사람·방문 담당·워크플로우가 넣은 담당·행위자. 질문 글의 멘션 토큰을 이름으로 보이는 데 쓴다
 * (상세 응답에 따로 사람 목록이 없어 이미 실린 사람만 안다).
 */
export function runUserNames(detail: Pick<WorkflowRunDetail, 'run' | 'nodeRuns'>): Map<number, string> {
  const names = new Map<number, string>()
  const add = (u: WorkflowUser | null | undefined) => {
    if (u) names.set(u.id, u.name)
  }
  add(detail.run.startedBy)
  for (const v of detail.nodeRuns) {
    v.assignees.forEach(add)
    v.workflowAssigned.forEach(add)
    add(v.actor)
  }
  return names
}

/**
 * 글의 멘션 토큰(`<@id>`)을 `@이름` 으로 바꾼다(WP-2093) — 서버 MentionParser.replaceWithNames 와 같은 표기라 모르는 id 는 `@사용자`.
 * 질문 원문(_qa.question)은 챗 글 그대로라 토큰이 들어 있고, 한 줄 글자로 보이는 자리에서 숫자 토큰이 드러나지 않게 한다.
 */
export function mentionTokensAsNames(text: string, names: ReadonlyMap<number, string>): string {
  return text.replace(MENTION_TOKEN, (_, id: string) => `@${names.get(Number(id)) ?? '사용자'}`)
}

/** 옛 버전에 걸린 진행 중 실행 수 — 버전 번호별(버전 요약 WorkflowVersionSummary 의 두 칸과 같은 모양이라 그대로 넘겨도 된다). */
export interface OlderVersionRuns {
  versionNo: number
  activeRuns: number
}

/**
 * 게시 버전이 아닌 버전 중 진행 중 실행이 있는 것만 버전 내림차순으로 고른다.
 * 서버 run-counts 는 게시 버전의 실행만 세므로, 다시 게시하면 옛 버전 실행이 그래프에서 빠진다 — 그 몫을 안내하려고 따로 모은다.
 * 게시 버전이 없거나(null) 버전 목록이 아직 없으면 빈 배열.
 */
export function olderVersionRuns(
  versions: readonly OlderVersionRuns[] | undefined,
  activeVersionNo: number | null,
): OlderVersionRuns[] {
  if (activeVersionNo === null || !versions) return []
  return versions
    .filter((v) => v.versionNo !== activeVersionNo && v.activeRuns > 0)
    .sort((a, b) => b.versionNo - a.versionNo)
}

/** 옛 버전 실행이 그래프에 안 보인다는 안내 문구. 게시 버전이 없거나 옛 버전 실행이 없으면 null(안내 안 함). */
export function olderRunsNotice(older: readonly OlderVersionRuns[], activeVersionNo: number | null): string | null {
  if (activeVersionNo === null || older.length === 0) return null
  const total = older.reduce((sum, o) => sum + o.activeRuns, 0)
  const detail = older.map((o) => `v${o.versionNo} ${o.activeRuns}개`).join(', ')
  return `옛 버전 실행 ${total}개는 이 그래프에 표시하지 않습니다 (${detail}) — 게시 버전 v${activeVersionNo}의 실행만 단계에 셉니다.`
}

/** 실행 상세가 열렸을 때 스크린리더에 읽힐 문구(WP-2053) — 어느 이슈의 상세인지 알린다. */
export function runDetailOpenedText(issueKey: string): string {
  return `${issueKey} 실행 상세를 열었습니다`
}

/** 내 차례 상세가 열렸을 때 스크린리더에 읽힐 문구(WP-2053). */
export function turnDetailOpenedText(issueKey: string): string {
  return `${issueKey} 내 차례 상세를 열었습니다`
}
