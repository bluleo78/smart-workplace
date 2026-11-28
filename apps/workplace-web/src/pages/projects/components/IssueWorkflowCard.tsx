// 이슈 상세 「AI 작업 단계」 카드(WP-1989·WP-2160) — 실행의 단계를 한 단계 한 줄 타임라인으로 보인다.
// 왜: 워크플로우는 이슈 상태와 별개의 진행축이라 상태 칸과 섞지 않고 따로 둔다. 노드는 사람이 옮기기 전에는 저절로 바뀌지 않는다.
// 단계 계산(본 흐름·방문 순서·질문 접기)은 lib/issueWorkflowSteps 순수 함수가 하고, 카드는 결과를 그리기만 한다 —
// 계산 회귀는 그 모듈의 vitest 로, 화면 결과는 이 파일의 vitest 로 잡는다.
// 워크플로우를 켜지 않은 프로젝트(실행도 없음)면 아무것도 그리지 않아 이슈 상세가 예전과 같다.
import { Bot, Check, MoreHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useWorkflowRun } from '@/hooks/queries/useWorkflowRuns'
import { issueChatPath } from '@/lib/agentWork'
import { buildWorkflowStepRows, type WorkflowStepRow, type WorkflowStepState } from '@/lib/issueWorkflowSteps'
import { cn } from '@/lib/utils'
import {
  isAskWaiting,
  isRunEnded,
  type IssueWorkflowView,
  isWorkflowEnabledProject,
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  type RunStatus,
  startConditionSuffix,
  useAssignPreview,
  useIssueWorkflow,
  useIssueWorkflowCardVisible,
} from '@/lib/workflow'
import { useProjectWorkflows, useWorkflowVersion, type WorkflowModel } from '@/lib/workflows'

import { RecoverDialog } from '../workflow/RecoverDialog'
import { IssuePropertyGroup } from './IssuePropertyGroup'

/** 레일의 「AI 작업 단계」 그룹 — 카드를 보일 때만 그룹 머리째 그린다(숨길 때 레일은 예전과 한 줄도 다르지 않다). */
export function IssueWorkflowGroup(props: IssueWorkflowCardProps) {
  const visible = useIssueWorkflowCardVisible(props.issueId, props.projectId)
  if (!visible) return null
  return (
    <IssuePropertyGroup
      title="AI 작업 단계"
      storageKey="issue-rail:workflow"
      defaultOpen={true}
      testId="property-group-workflow"
    >
      <IssueWorkflowCard {...props} />
    </IssuePropertyGroup>
  )
}

interface IssueWorkflowCardProps {
  issueId: number
  projectKey: string
  projectId: number
  /** 이슈 번호 — 질문 대기 줄의 「챗에서 답하기」 딥링크(issueChatPath)에 쓴다(WP-2160). */
  issueNumber: number
  /** 이슈를 고칠 수 있는 사람(멈춘 실행의 조치 노출). */
  canEdit: boolean
  /** 프로젝트 관리자·소유자 — 멈춘 실행 조치(후속 작업)에서 쓴다. */
  isManager: boolean
  /** 닫힌(완료·취소) 이슈 — 서버가 조치를 409 로 거절하므로 단추를 그리지 않고, 시작 조건 안내도 보이지 않는다. */
  closed?: boolean
  /** 지금 담당자 id — 실행이 없거나 끝났을 때 「이 담당으로 시작되는가」를 서버에 묻는 데 쓴다(WP-2120). */
  assigneeIds: number[]
}

/**
 * 실행이 없거나 끝났을 때의 안내(WP-2120) — 시작 단추 대신, 담당이 시작 조건에 안 맞는 이유와 관리자용 「워크플로우 열기」 링크.
 * 왜: 시작은 담당 지정이 한다(서버가 같은 요청에서 시작). 카드에는 시작 단추가 없고 조건만 알린다.
 */
function StartConditionNote({
  projectKey, issueId, assigneeIds, isManager, show,
}: { projectKey: string; issueId: number; assigneeIds: number[]; isManager: boolean; show: boolean }) {
  // 담당이 없으면 「담당을 지정하면 시작돼요」에 시작 조건 역할을 붙인다 — 누구를 넣어야 시작되는지 알게(리뷰 후속). 역할은 미리보기 응답에서
  // 받으므로 빈 담당으로도 묻는다(서버는 빈 담당이면 시작 없음과 역할만 준다). 응답 전·실패면 역할 없이 기본 문구만 보인다.
  const noAssignee = assigneeIds.length === 0
  // 지금 담당 기준(current)으로 묻는다 — 새로 더한 사람 기준이면 늘 「시작 안 함」이 나와 맞는 담당이 있어도 조건 문구를 냈다(코드 리뷰).
  const preview = useAssignPreview(issueId, assigneeIds, show, true)
  // 지금 담당으로 시작될 수 있는데 아직 안 시작된 경우(담당 지정 전 켠 워크플로우 등)에는 조건 문구를 내지 않는다.
  let note: string | null = null
  if (show) {
    if (noAssignee) note = `담당을 지정하면 워크플로우가 시작돼요${startConditionSuffix(preview.data?.startRoles ?? [])}`
    else if (preview.data && !preview.data.start) note = `이 담당으로는 시작하지 않아요${startConditionSuffix(preview.data.startRoles)}`
  }
  if (!note && !isManager) return null
  return (
    <div className="space-y-1">
      {note && <p className="text-xs text-muted-foreground" data-testid="workflow-start-condition">{note}</p>}
      {isManager && (
        <Link className="text-xs text-primary hover:underline" to={`/projects/${projectKey}/workflow`}>
          워크플로우 열기
        </Link>
      )}
    </div>
  )
}

/**
 * 「조치」 단추와 조치 창 — 멈춘(조치 필요) 실행에만. 창은 실행 상세와 같은 RecoverDialog 를 쓴다(WP-1991).
 * 왜: 노드는 사람이 바로잡기 전에는 저절로 풀리지 않는다. 창을 열 때의 revision 을 고정해 보내므로 창이 열린 동안 쿼리가 새로 고쳐져도 낡은 화면 판정이 유지된다.
 */
function RecoverActions({
  issueId, projectKey, run, isManager, model,
}: {
  issueId: number
  projectKey: string
  run: IssueWorkflowView
  isManager: boolean
  /** 실행이 고정한 버전(run.versionNo)의 모델 — 못 읽었으면 undefined(그래도 다시 시도·실행 취소는 보낼 수 있다). */
  model: WorkflowModel | undefined
}) {
  // 창을 열 때의 revision — null 이면 닫힘.
  const [openRevision, setOpenRevision] = useState<number | null>(null)
  const curKey = run.currentNode?.key
  // 지금 노드 — 모델에 없으면(못 읽음·옛 버전) undefined 로 두어 오류 경로를 내놓지 않는다.
  const current = model?.nodes.find((n) => n.key === curKey)
  return (
    <>
      <Button type="button" size="icon" variant="ghost" className="h-6 w-6" aria-label="조치" onClick={() => setOpenRevision(run.revision)}>
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </Button>
      <RecoverDialog
        open={openRevision !== null} onOpenChange={(o) => { if (!o) setOpenRevision(null) }}
        issueId={issueId} projectKey={projectKey} revision={openRevision ?? run.revision}
        currentNode={current} model={model} canManage={isManager} onDone={() => {}}
      />
    </>
  )
}

/**
 * 단계 행의 점(WP-2160) — 지나온 단계는 ✓, 남은 단계는 흐린 테두리 원, 지금 단계는 실행 상태 색 원
 * (사람 차례=경고, 조치 필요=오류, 그 밖의 지금 상태=AI 강조). 시맨틱 토큰만 쓴다.
 */
function StepDot({ state, status }: { state: WorkflowStepState; status: RunStatus | null }) {
  if (state === 'passed') return <Check className="size-3 text-success" />
  if (state === 'remaining') return <span className="block size-2.5 rounded-full border border-muted-foreground/40" />
  let tone: string
  if (status === 'WAITING') tone = 'bg-warning'
  else if (status === 'SUSPENDED') tone = 'bg-destructive'
  else tone = 'bg-ai-accent'
  return <span className={cn('block size-2.5 rounded-full ring-2 ring-background', tone)} />
}

/** 행의 시간 문구 — 지금은 머문 시간(「방금」은 그대로, 「째」를 붙이지 않는다), 끝 행은 도착 시각, 지난 행은 걸린 시간. */
function rowTimeText(row: WorkflowStepRow): string | null {
  if (row.timeLabel == null) return null
  if (row.isEnd) return `도착 ${row.timeLabel}`
  if (row.state === 'current' && row.timeLabel !== '방금') return `${row.timeLabel}째`
  return row.timeLabel
}

/**
 * 행의 메타 한 줄 — 질문 대기면 앞에 「질문 대기」, 시작 행은 시작자와 시각(시작자를 아직 못 읽었으면 「시작 시각」,
 * 첫 줄이 지금 단계이면 머문 시간과 함께 「시작 5분째」), 끝 행은 도착 시각뿐.
 * 쓰는 문구는 정해진 것만 쓰고(새 상태 이름·새 단계 이름을 만들지 않는다), 이름은 쉼표로 이어 붙인다.
 */
function rowMetaText(row: WorkflowStepRow): string | null {
  const time = rowTimeText(row)
  if (row.isEnd) return time
  const names = row.actors.map((a) => a.name).join(', ')
  // 시작 표식이 붙는 때 — ① 첫 줄이 지금 단계일 때(「시작 5분째」): 이 실행이 막 시작됐다는 표식이 없으면
  // 첫 줄이 지금인지 지난 줄인지 읽히지 않는다(리뷰 ④). ② 시작자를 아직 못 읽을 때(「시작 13:15」): 시간만 남는다.
  // 이때는 담당 이름을 함께 두지 않는다 — 시작 표식이 목적이므로. 「방금」에는 붙이지 않는다(「시작 방금」이 되어 읽히지 않으므로).
  const startTagged = row.isStart && time != null && time !== '방금' && (row.state === 'current' || names === '')
  const timePart = startTagged ? `시작 ${time}` : time
  const parts = [row.questionWaiting ? '질문 대기' : null, startTagged || names === '' ? null : names, timePart]
  return parts.filter((p): p is string => p != null).join(' · ') || null
}

export function IssueWorkflowCard({ issueId, projectKey, projectId, issueNumber, canEdit, isManager, closed = false, assigneeIds }: IssueWorkflowCardProps) {
  const view = useIssueWorkflow(issueId)
  const list = useProjectWorkflows(projectId)
  const run = view.data
  // 시작·조치를 그릴 수 있는가 — 닫힌 이슈는 서버가 둘 다 409 로 거절한다.
  const editable = canEdit && !closed
  const workflowId = run?.workflowId ?? null
  const versionNo = run?.versionNo ?? null
  // 실행이 고정한 버전(run.versionNo)의 모델 — 단계 타임라인 행 계산과 「조치」 창의 노드 이름에 쓴다. 못 읽으면 undefined(남은 단계는 키로).
  const version = useWorkflowVersion(workflowId ?? 0, workflowId != null ? versionNo : null)
  // 실행 상세 — 시작자·시각을 얻는 데 쓴다. 실행이 없으면 묻지 않는다(skipToken).
  const runDetail = useWorkflowRun(view.data?.runId ?? null)
  // 시작자·시각·주체 종류 — 실행 상세의 startedBy(name·kind)·startedAt. 아직 못 읽었으면(로딩·실패) 첫 방문 시각으로 시간을 대체하고
  // 시작자는 비워 둔다. kind 를 함께 넘겨야 시작 행의 에이전트 시작자가 Bot 아이콘으로 그려진다(이름·시각만 넘기면 글자만 남는다).
  const start = useMemo(
    () => ({
      name: runDetail.data?.run.startedBy?.name ?? null,
      at: runDetail.data?.run.startedAt ?? view.data?.path[0]?.enteredAt ?? null,
      kind: runDetail.data?.run.startedBy?.kind ?? null,
    }),
    [runDetail.data, view.data],
  )
  // 지금 시각 — 지금 단계 머문 시간의 기준. 경과 시간 표시는 렌더 시각 기준이 맞다(AiAgentsView 와 같은 예외 — 값이 매 렌더 바뀌므로 deps 에 함께 둔다).
  // eslint-disable-next-line react-hooks/purity -- 경과 시간 표시는 렌더 시각 기준이 맞다(재렌더될 때마다 다시 계산)
  const now = Date.now()
  // 단계 타임라인 행 — 방문 먼저 → 지금 → 서버가 준 남은 단계 순, 질문 노드는 질문 대기 여부와 무관하게 원래 단계로 접는다
  // (「질문 대기」 꾸밈·챗 상자는 isAskWaiting 이 true 일 때만, WP-2160).
  const rows = useMemo(
    () =>
      view.data
        ? buildWorkflowStepRows(view.data, version.data?.model, { start, now, askWaiting: isAskWaiting(view.data) })
        : [],
    [view.data, version.data?.model, start, now],
  )
  // 시작 조건 안내를 물을 때 — 실행이 없거나 끝났고 워크플로우를 켠 프로젝트이며 닫힌 이슈가 아닐 때(훅이라 일찍 반환하기 전에 계산).
  const askStartNote = run != null && isRunEnded(run) && isWorkflowEnabledProject(list.data) && !closed
  // 카드는 IssueWorkflowGroup 안에서만 그려진다 — 그룹이 이미 「실행 있음 || 켜진 프로젝트」일 때만 보이므로 여기서 다시 거르지 않는다.
  if (!run) return null
  const enabled = isWorkflowEnabledProject(list.data)

  if (run.runId == null) {
    return (
      <div className="space-y-2" data-testid="issue-workflow-card">
        <p className="text-sm text-muted-foreground">아직 워크플로우가 없어요.</p>
        <StartConditionNote projectKey={projectKey} issueId={issueId} assigneeIds={assigneeIds} isManager={isManager} show={askStartNote} />
      </div>
    )
  }

  const defName = list.data?.find((w) => w.id === workflowId)?.name
  const status = run.status
  const ended = isRunEnded(run)

  return (
    <div className="space-y-2 text-sm" data-testid="issue-workflow-card">
      {/* 머리 줄 — 정의 이름·상태 칩·조치(멈춤일 때)·실행 상세 링크. ↗ 대신 › 로 앱 안 링크 표기를 통일한다(WP-2160). */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-medium">{defName ?? '워크플로우'}</span>
          {status && (
            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', RUN_STATUS_TONE[status])}>
              {RUN_STATUS_LABEL[status]}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {editable && status === 'SUSPENDED' && (
            <RecoverActions
              issueId={issueId}
              projectKey={projectKey}
              run={run}
              isManager={isManager}
              model={version.data?.model}
            />
          )}
          <Link
            className="text-xs text-primary hover:underline"
            to={`/projects/${projectKey}/workflow?view=runs&workflow=${workflowId}&run=${run.runId}`}
          >
            자세히 ›
          </Link>
        </div>
      </div>
      {/* 단계 타임라인 — 한 단계 한 줄. 세로 점선으로 이어 붙이고 지나온 점은 ✓, 지금 점은 상태 색, 남은 점은 흐린 테두리. */}
      <ol className="space-y-0 text-sm">
        {rows.map((row, i) => {
          const meta = rowMetaText(row)
          return (
            <li key={row.key} className="relative flex gap-2 pb-3 pl-5 last:pb-0">
              {/* 세로 점선 — 마지막 행은 이어 그리지 않는다. 점 중심(left-[3.5px])에 맞춘다. */}
              {i < rows.length - 1 && (
                <span aria-hidden className="absolute left-[3.5px] top-4 bottom-0 w-px border-l border-dashed border-muted-foreground/40" />
              )}
              <span aria-hidden className="absolute left-0 top-1.5">
                <StepDot state={row.state} status={status} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1">
                  <span className={cn(row.state === 'remaining' ? 'text-muted-foreground' : 'text-foreground')}>
                    {row.name}
                  </span>
                  {row.repeat && <span className="text-[10px] text-muted-foreground">{row.repeat}</span>}
                  {/* 에이전트 주체 표식 — Bot 아이콘 하나만 쓴다(글자 배지·이모지 금지, WP-2160). */}
                  {row.actors.some((a) => a.kind === 'AGENT') && <Bot className="size-3 shrink-0 text-ai-accent" aria-hidden />}
                </div>
                {meta && (
                  <div className={cn('text-xs', row.questionWaiting ? 'text-warning-text' : 'text-muted-foreground')}>{meta}</div>
                )}
                {/* 답한 질문 수 — 0 이면 줄을 그리지 않는다. */}
                {row.questionAnswered > 0 && (
                  <div className="text-xs text-muted-foreground">{`질문 ${row.questionAnswered}건 · 답변함`}</div>
                )}
                {/* 질문 상자 — 질문 대기에서만: 질문 첫 줄과 이슈 챗 답 링크(결과 단추 대신 챗에서 답한다, WP-2093). */}
                {row.questionWaiting && (
                  <div className="mt-1 space-y-1 rounded-md border border-warning/40 bg-warning-subtle p-2">
                    {row.questionFirstLine && <p className="text-xs">{row.questionFirstLine}</p>}
                    <Link className="text-xs text-primary hover:underline" to={issueChatPath(projectKey, issueNumber)}>
                      챗에서 답하기
                    </Link>
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      {ended && enabled && (
        <StartConditionNote projectKey={projectKey} issueId={issueId} assigneeIds={assigneeIds} isManager={isManager} show={askStartNote} />
      )}
    </div>
  )
}
