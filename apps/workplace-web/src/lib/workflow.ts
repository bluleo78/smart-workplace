// 이슈의 워크플로우 실행 API — 「AI 작업 단계」 카드·시작 창·이동 창이 함께 쓰는 조회·시작·이동·조치 훅(WP-1989).
// 정의(편집·게시)는 lib/workflows.ts, 여기는 이슈 하나에 걸린 실행이다. 응답 모양은 서버 IssueWorkflowView 와 같다.
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { client } from '@/api/client'
import { issueWorkflowKeys } from '@/hooks/queries/issueWorkflowKeys'
import { issueKeys } from '@/hooks/queries/useIssues'
import { workflowRunKeys } from '@/hooks/queries/workflowRunKeys'
import { extractApiError, extractApiErrorCode } from '@/lib/api-error'

import { useProjectWorkflows, type WorkflowSummary } from './workflows'

export type RunStatus = 'RUNNING' | 'WAITING' | 'SUSPENDED' | 'COMPLETED' | 'CANCELED'

export interface WorkflowUser {
  id: number
  username: string
  name: string
  kind?: 'HUMAN' | 'AGENT'
}

export interface WorkflowNodeView {
  key: string
  name: string | null
  type: string
  roleKey: string | null
  assignees: WorkflowUser[]
  enteredAt: string | null
  nodeRunStatus: 'ACTIVE' | 'BLOCKED' | 'COMPLETED' | 'FAILED'
  instructions: string | null
  /** 질문 경로 노드(returnTo 가 있는 사람 노드)면 돌아갈 노드 키 — 이 노드는 결과 단추 대신 이슈 챗에서 답한다(WP-2093) */
  returnTo?: string | null
}

export interface WorkflowOutcomeView {
  key: string
  /** 표시 이름(WP-2158) — 서버가 name → 기본 이름 → key 로 풀어 준다. */
  name: string
  toNode: string
  requiredOutputs: { key: string; type: 'string' | 'url' | 'number' | 'boolean'; name: string }[]
  requireComment: boolean
  assignTo: string | null
  candidateAssignees: WorkflowUser[]
  assigneeRequired: boolean | null
}

export interface WorkflowPathStep {
  key: string
  name: string | null
  outcome: string | null
  /** 고른 결과의 표시 이름(WP-2158) — 결과가 없으면 null. */
  outcomeName?: string | null
  actor: WorkflowUser | null
  enteredAt: string
  leftAt: string | null
}

/** 실행이 없으면 runId 등이 null 이고 목록은 비어 있다(200). */
export interface IssueWorkflowView {
  runId: number | null
  status: RunStatus | null
  /** 실행이 끝난 시각(진행 중·실행 없음이면 null) */
  endedAt: string | null
  revision: number
  workflowId: number | null
  versionNo: number | null
  currentNode: WorkflowNodeView | null
  outcomes: WorkflowOutcomeView[]
  path: WorkflowPathStep[]
  remainingNodeKeys: string[]
  context: Record<string, unknown>
}

/** 실행 상태 칩 문구 — 쉬운 우리말로 통일. */
export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  RUNNING: 'AI 작업 중',
  WAITING: '사람 차례',
  SUSPENDED: '조치 필요',
  COMPLETED: '완료',
  CANCELED: '취소됨',
}

/**
 * 상태 칩·배지 색 — 같은 상태는 모든 화면에서 같은 색(WP-2049). 시맨틱 토큰만 쓴다.
 * 사람 차례는 내가 처리할 일이라 warning. 작은 글자라 완료는 대비를 맞춘 success-text, 취소는 outline 기본 테두리를 그대로 둔다.
 * 카드 칩은 테두리 폭이 없어 border 색은 보이지 않고, 목록·상세 Badge(outline)에서만 보인다.
 */
export const RUN_STATUS_TONE: Record<RunStatus, string> = {
  RUNNING: 'border-ai-accent/40 bg-ai-accent-subtle text-ai-accent',
  WAITING: 'border-warning/40 bg-warning-subtle text-warning-text',
  SUSPENDED: 'border-destructive/40 bg-destructive/10 text-destructive',
  COMPLETED: 'border-success/40 bg-success/10 text-success-text',
  CANCELED: 'bg-muted text-muted-foreground',
}

export const issueWorkflowKey = issueWorkflowKeys.detail

/** 멈춘 실행의 조치 종류 — 서버 recover 의 action. 카드의 메뉴·확인 창과 훅이 함께 쓴다. */
export type RecoverAction = 'RETRY' | 'ON_ERROR' | 'MOVE_TO' | 'CANCEL'

/** 실행 상태가 끝(완료·취소)인가 — 끝났다고 보는 상태 집합의 단일 정의. */
export function isRunStatusEnded(status: RunStatus): boolean {
  return status === 'COMPLETED' || status === 'CANCELED'
}

/** 실행이 없거나 끝났는가(완료·취소) — 새로 시작을 권해도 되는 때. */
export function isRunEnded(run: Pick<IssueWorkflowView, 'runId' | 'status'>): boolean {
  return run.runId == null || (run.status != null && isRunStatusEnded(run.status))
}

/** 질문 대기 노드에서 질문한 AI 노드로 돌아가는 결과 키 — 서버 WorkflowRunService.ANSWERED 와 같다(WP-2093). 사람 챗 글이 이 결과로 옮긴다. */
export const ANSWERED_OUTCOME = 'answered'

/** 배너에 보일 결과 — 질문 노드(returnTo 있음)의 `answered` 는 이슈 챗 답으로만 고르므로 뺀다(WP-2093). */
export function bannerOutcomes<T extends { key: string }>(returnTo: string | null | undefined, outcomes: readonly T[]): T[] {
  return returnTo ? outcomes.filter((o) => o.key !== ANSWERED_OUTCOME) : [...outcomes]
}

/**
 * 지금 AI 의 질문에 사람 답만 기다리는가(WP-2093) — 사람 차례(WAITING)이고 지금 노드가 결과가 `answered` 뿐인 질문 노드일 때.
 * 이때는 결과 단추 대신 이슈 챗에서 답하고, 사람 챗 글이 실행을 `answered` 로 움직인다.
 */
export function isAskWaiting(view: IssueWorkflowView): boolean {
  const cur = view.currentNode
  return view.runId != null && !!cur && isAskWaitingState(view.status, cur.type, cur.returnTo, view.outcomes.map((o) => o.key))
}

/**
 * 질문 대기 판정의 낮은 층 — 실행 상태·노드 종류·returnTo·결과 키만으로 가른다(WP-2093). 실행 상세(WorkflowRunDetail)도 같은 조건을 쓴다.
 * 사람 차례(WAITING)의 human_task 이고 returnTo 가 있으며 결과가 `answered` 뿐인 노드 — 표준 질문 경로(expandAsk)가 만드는 모양이다.
 * 이 노드는 챗 답 글이 실행을 움직이므로 결과 단추가 필요 없어 배너를 그리지 않는다. 다른 결과가 있으면 배너는 보이되 `answered` 만 뺀다.
 */
export function isAskWaitingState(
  status: string | null | undefined,
  nodeType: string | null | undefined,
  returnTo: string | null | undefined,
  outcomeKeys: readonly string[],
): boolean {
  return status === 'WAITING' && nodeType === 'human_task' && !!returnTo && outcomeKeys.every((k) => k === ANSWERED_OUTCOME)
}

export function useIssueWorkflow(issueId: number | undefined) {
  return useQuery({
    // 이슈 id 가 아직 없으면 조회하지 않는다(skipToken) — 키도 가짜 id 대신 그대로 비워 둔다.
    queryKey: [...issueWorkflowKeys.all, issueId],
    queryFn:
      issueId == null
        ? skipToken
        : ({ signal }) => client.get<IssueWorkflowView>(`/issues/${issueId}/workflow`, { signal }).then((r) => r.data),
  })
}

/**
 * 시작·이동·조치가 끝난 뒤 새로 읽기 — 워크플로우 카드·배너와 이슈 상세(활동 등)를 함께 무효화한다.
 * refreshIfStale 은 「그사이 단계가 바뀜(WORKFLOW_STALE)」 오류일 때만 새로 읽는다(낡은 화면을 바로잡게).
 */
function useIssueWorkflowRefresh(issueId: number, projectKey: string) {
  const qc = useQueryClient()
  const refresh = () => {
    qc.invalidateQueries({ queryKey: issueWorkflowKey(issueId) })
    qc.invalidateQueries({ queryKey: issueKeys.details(projectKey) })
    // 실행 목록·상세·집계와 내 차례도 새로 읽는다(배너·조치로 옮긴 뒤 다른 화면이 낡지 않게).
    qc.invalidateQueries({ queryKey: workflowRunKeys.all })
    qc.invalidateQueries({ queryKey: workflowRunKeys.myTurns() })
    // 워크플로우 탭의 「진행 중인 실행 N개」·탭 수는 버전 요약(activeRuns)의 합계라 실행이 끝나거나 옮겨지면 같이 낡는다.
    // 이슈 화면은 워크플로우 id 를 모를 수 있어 workflowKeys.versions 모양(['workflows','detail',<id>,'versions'], 길이 4)만 고른다.
    // 길이 5 인 버전 본문(workflowKeys.version)과 정의 상세는 불변·무관해 다시 읽지 않는다.
    qc.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey
        return k.length === 4 && k[0] === 'workflows' && k[1] === 'detail' && k[3] === 'versions'
      },
    })
  }
  const refreshIfStale = (e: unknown) => {
    if (extractApiErrorCode(e) === 'WORKFLOW_STALE') refresh()
  }
  return { refresh, refreshIfStale }
}

/** 담당 미리보기 응답(WP-2120) — 이 담당 집합으로 지정하면 시작될 워크플로우(없으면 null)와 시작 조건의 역할 키들. */
export interface AssignPreview {
  start: { workflowId: number; workflowName: string; stageName: string } | null
  /** 시작은 되지만 배정 규칙 위반으로 실패해 저장도 거절될 때의 이유 */
  blocked: { message: string } | null
  /** 이슈에 진행 중인 실행이 있는가 — 있으면 시작 조건 경고를 내지 않는다 */
  active: boolean
  startRoles: string[]
}

/**
 * 담당 미리보기(WP-2120) — 저장하지 않고 이 담당 집합이 워크플로우를 시작할지 서버에 묻는다.
 * 키는 실행 조회와 다른 미리보기 루트(issueWorkflowKeys.preview) 아래라 실시간 실행 무효화마다 POST 가 다시 나가지 않는다 — 담당 id 는 정렬해 같은 집합이 같은 캐시를 쓴다.
 * current 가 참이면 userIds 를 지금 담당으로 보고 「지금 담당으로 시작될 수 있나」를 묻는다(카드), 거짓이면 새로 더한 사람만 본다(팝오버 — 실제 자동 시작과 같은 판정).
 * 실패해도(5xx 등) 화면은 안내 줄만 빼고 그대로 — 재시도하지 않는다.
 */
export function useAssignPreview(issueId: number | undefined, userIds: number[], enabled: boolean, current = false) {
  const ids = [...userIds].sort((x, y) => x - y)
  return useQuery({
    queryKey: [...issueWorkflowKeys.previewAll, issueId, 'assign', current, ids],
    queryFn:
      enabled && issueId != null
        ? ({ signal }) =>
            client
              .post<AssignPreview>(`/issues/${issueId}/workflow/assign-preview`, current ? { userIds: ids, current } : { userIds: ids }, { signal })
              .then((r) => r.data)
        : skipToken,
    retry: false,
  })
}

/**
 * 담당 미리보기 → 안내 줄(WP-2120). 시작이 막히면(blocked) 「⚠ 저장되지 않아요」, 시작되면 「▶」 안내, 안 되는데 새로 더한 AI 가 있으면
 * (활성 실행이 없을 때만) 「⚠」 경고, 아니면 줄 없음.
 * 경고의 이름은 AI username 의 @ 앞부분, 역할은 키를 쉼표로 잇는다.
 */
export function assignHint(
  preview: AssignPreview | undefined,
  addedAgents: { username: string; name: string }[],
): { kind: 'start' | 'warn'; text: string } | null {
  if (!preview) return null
  if (preview.start && preview.blocked) {
    return {
      kind: 'warn',
      text: `⚠ 이 담당으로는 「${preview.start.workflowName}」을 시작할 수 없어 저장되지 않아요 · ${preview.blocked.message}`,
    }
  }
  if (preview.start) {
    return { kind: 'start', text: `▶ 지정하면 「${preview.start.workflowName}」이 ${preview.start.stageName} 단계부터 시작돼요` }
  }
  // 실행 중이면 AI 가 일하지 않는 이유는 시작 조건이 아니라 이미 실행 중이라서다 — 엉뚱한 조건을 대지 않는다.
  if (preview.active || addedAgents.length === 0) return null
  const names = addedAgents.map((u) => u.username.split('@')[0]).join(', ')
  return { kind: 'warn', text: `⚠ 워크플로우가 켜진 프로젝트라 ${names} 는 이 할당으로 일하지 않아요${startConditionSuffix(preview.startRoles)}` }
}

/** 「 · 시작 조건: a, b 역할」 꼬리 — 역할이 없으면 빈 문자열. 팝오버 경고와 카드 안내가 같은 문구를 쓴다(WP-2120). */
export function startConditionSuffix(roles: string[]): string {
  return roles.length > 0 ? ` · 시작 조건: ${roles.join(', ')} 역할` : ''
}

/** 이동 — 멱등 키는 훅이 만든다(같은 노드·revision·결과의 재시도는 서버가 한 번만 넘긴다). 낡은 화면(STALE)이어도 새로 읽는다. */
export function useMoveIssueWorkflow(issueId: number, projectKey: string) {
  const { refresh, refreshIfStale } = useIssueWorkflowRefresh(issueId, projectKey)
  return useMutation({
    mutationFn: (v: {
      fromNode: string
      outcome: string
      outputs?: Record<string, unknown>
      assigneeIds?: number[]
      comment?: string
      expectedRevision: number
      runId: number
    }) =>
      client
        .post<IssueWorkflowView>(`/issues/${issueId}/workflow/move`, {
          ...v,
          idempotencyKey: `web:${issueId}:${v.fromNode}:${v.expectedRevision}:${v.outcome}`,
        })
        .then((r) => r.data),
    onSuccess: refresh,
    onError: refreshIfStale,
  })
}

/** 멈춘 실행의 조치 — 다시 시도·onError·관리자 옮기기·취소. */
export function useRecoverIssueWorkflow(issueId: number, projectKey: string) {
  const { refresh, refreshIfStale } = useIssueWorkflowRefresh(issueId, projectKey)
  return useMutation({
    mutationFn: (v: { action: RecoverAction; toNode?: string; comment?: string; expectedRevision: number }) =>
      client.post<IssueWorkflowView>(`/issues/${issueId}/workflow/recover`, v).then((r) => r.data),
    onSuccess: refresh,
    onError: refreshIfStale,
  })
}

/** 이슈 이력 탭에 섞는 한 줄 — 워크플로우 단계 이동 기록(WP-1989). 이력 줄(IssueHistoryEntry)과 `kind` 로 가른다. */
export interface TimelineRow {
  kind: 'workflow'
  id: string
  actorName: string
  actorKind: 'HUMAN' | 'AGENT'
  createdAt: string
  text: string
}

/** 이력 합친 목록의 원소가 워크플로우 이동 줄인가 — 이력 줄과 가르는 타입 가드. */
export function isWorkflowTimelineRow(e: object): e is TimelineRow {
  return 'kind' in e && e.kind === 'workflow'
}

/**
 * 실행 path 와 지금 단계를 이력 줄로 바꾼다 — 서버 뜻 그대로.
 * 서버 path 는 「지금 단계의 방문을 뺀 지나온 방문」이고, 각 방문의 actor 는 그 방문을 마치게(= 다음 단계로 옮기게) 한 사람이다.
 * 그래서 이동 줄은 「path[i].actor 가 path[i] → 다음 단계(path[i+1], 없으면 지금 단계)」이고 시각은 path[i].leftAt 이다.
 * 시작 줄은 시작한 사람을 path 로 알 수 없으므로 행위자 없이 첫 단계(path[0], 없으면 지금 단계)만 적는다.
 * 앞뒤 단계가 같으면(다시 시도로 같은 노드에 새 방문) 「다시 시작했습니다」, 실행이 끝나 다음이 없으면 「마쳤습니다」.
 */
export function workflowStepsToTimelineRows(
  path: WorkflowPathStep[],
  current: { key: string; name: string | null; enteredAt: string | null } | null = null,
  runStatus?: RunStatus | null,
  endedAt?: string | null,
): TimelineRow[] {
  const first = path[0] ?? current
  if (!first) return []
  // 시작 시각을 모르면(서버가 현재 방문을 못 줄 때 null) 시작 줄을 뺀다 — 정렬 비교가 NaN 이 되지 않게.
  const rows: TimelineRow[] = !first.enteredAt ? [] : [
    {
      kind: 'workflow',
      id: 'workflow-start',
      actorName: '',
      actorKind: 'HUMAN',
      createdAt: first.enteredAt,
      text: `워크플로우를 시작했습니다 — ${first.name ?? first.key}`,
    },
  ]
  path.forEach((s, i) => {
    // 아직 머물러 있는(leftAt 없음) 방문은 이동이 없다.
    if (!s.leftAt) return
    const next = path[i + 1] ?? current
    const name = s.name ?? s.key
    const who = s.actor?.name ?? ''
    const prefix = who ? `${who} ` : ''
    let text: string
    // 다음 단계가 없을 때 — 취소된 실행이면 「마쳤습니다」가 아니라 취소로 쓴다(끝까지 간 것이 아니므로).
    if (!next) text = runStatus === 'CANCELED' ? `${prefix}실행을 취소했습니다` : `${prefix}${name} 단계를 마쳤습니다`
    else if (next.key === s.key) text = `${prefix}${name} 단계를 다시 시작했습니다`
    else text = `${prefix}단계를 ${name} → ${next.name ?? next.key} (으)로 옮겼습니다`
    rows.push({
      kind: 'workflow',
      id: `workflow-${s.key}-${i}`,
      actorName: who,
      actorKind: s.actor?.kind === 'AGENT' ? 'AGENT' : 'HUMAN',
      createdAt: s.leftAt,
      text,
    })
  })
  // 서버는 취소해도 current_node 를 지우지 않아 취소된 실행에도 current 가 있다 — 마지막 방문 뒤에 취소 줄을 더한다.
  // 취소 시각(endedAt)을 모르면 줄을 뺀다(정렬 비교가 NaN 이 되지 않게). 행위자는 path 로 알 수 없어 이름 없이 쓴다.
  if (runStatus === 'CANCELED' && current && endedAt) {
    rows.push({ kind: 'workflow', id: 'workflow-canceled', actorName: '', actorKind: 'HUMAN', createdAt: endedAt, text: '실행을 취소했습니다' })
  }
  return rows
}

/** 오류 문구 — 그사이 단계가 바뀐 경우(WORKFLOW_STALE)는 서버 문구 대신 쉬운 안내. */
export function workflowErrorMessage(e: unknown, fallback: string): string {
  if (extractApiErrorCode(e) === 'WORKFLOW_STALE') return '그사이 단계가 바뀌었어요. 새로 불러왔어요.'
  return extractApiError(e, fallback)
}

/** 시작할 수 있는 워크플로우 — 켜져 있고 게시본이 있는 것만. */
export function startableWorkflows(list: WorkflowSummary[] | undefined): WorkflowSummary[] {
  return (list ?? []).filter((w) => w.enabled && w.activeVersionNo != null)
}

/** 워크플로우를 켠 프로젝트인가 — 시작할 수 있는 워크플로우가 하나라도 있으면. */
export function isWorkflowEnabledProject(list: WorkflowSummary[] | undefined): boolean {
  return startableWorkflows(list).length > 0
}

/**
 * 카드(그룹)를 보일지 — 실행이 있거나 시작할 수 있는 워크플로우가 있을 때만.
 * 이슈 상세 레일이 그룹 머리를 그리기 전에 같은 조회(캐시 공유)로 묻는다. 조회 중에는 숨겨 깜빡임 없이 예전 모습을 지킨다.
 * 조회가 실패(5xx 등)해 view.data 가 없으면 숨긴다 — 실행이 없는 프로젝트와 같게 조용히 숨기는 것이 의도다(화면을 깨지 않는다).
 */
export function useIssueWorkflowCardVisible(issueId: number | undefined, projectId: number | undefined): boolean {
  const view = useIssueWorkflow(issueId)
  const list = useProjectWorkflows(projectId)
  if (!view.data) return false
  return view.data.runId != null || isWorkflowEnabledProject(list.data)
}
