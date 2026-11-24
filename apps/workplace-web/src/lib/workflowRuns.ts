// 워크플로우 실행 조회 — 응답 타입과 화면용 순수 함수(WP-1991). 서버 상태 훅은 hooks/queries/useWorkflowRuns.ts.
// 이슈 하나에 걸린 실행의 시작·이동·조치는 lib/workflow.ts, 정의 편집·게시는 lib/workflows.ts. 응답 모양은 서버 WorkflowRunPage·WorkflowRunDetail·MyWorkflowTurn 과 같다.
import { isRunStatusEnded, type RunStatus, type WorkflowUser } from './workflow'
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
  question: string | null
}

/** 실행 목록 필터 — 서버가 상태는 값 하나만 받는다. */
export interface RunFilters {
  status?: RunStatus
  node?: string
  assigneeId?: number
}

/** 노드별 진행 중 실행 수 응답(GET /workflows/{id}/run-counts). */
export interface WorkflowRunCounts {
  counts: Record<string, number>
}

/** 내 차례 응답(GET /me/workflow-turns). */
export interface MyWorkflowTurnList {
  items: MyWorkflowTurn[]
}

export type NodePaint = 'passed' | 'failed' | 'current' | 'unvisited'

/** 실행이 아직 어딘가에서 기다리거나 도는 중인가(끝난 실행에는 「지금 노드」가 없다). */
function isRunActive(status: RunStatus): boolean {
  return !isRunStatusEnded(status)
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
  if (isRunActive(detail.run.status) && current in paint) paint[current] = 'current'
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
}

/**
 * 이동 기록 — 방문마다 한 줄(앞 노드 → 이 노드), 시간 역순.
 * 이동을 한 사람·결과는 앞 방문이 가진 값이고, 첫 줄(시작)은 시작한 사람이다. assigned 는 이 방문에서 워크플로우가 담당으로 넣은 사람.
 */
export function runMoveRows(detail: WorkflowRunDetail): RunMoveRow[] {
  const visits = [...detail.nodeRuns].sort((a, b) => a.id - b.id)
  const rows = visits.map((v, i): RunMoveRow => {
    const prev = i > 0 ? visits[i - 1] : null
    return {
      id: String(v.id),
      from: prev ? (prev.nodeName ?? prev.nodeKey) : null,
      to: v.nodeName ?? v.nodeKey,
      actorName: prev ? (prev.actor?.name ?? null) : (detail.run.startedBy?.name ?? null),
      outcome: prev ? prev.outcome : null,
      at: v.enteredAt,
      assigned: v.workflowAssigned.map((u) => u.name),
    }
  })
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
