// 이슈 상세 「AI 작업 단계」 카드(WP-1989) — 지나온 단계·지금 단계·남은 단계를 한눈에 보인다.
// 왜: 워크플로우는 이슈 상태와 별개의 진행축이라 상태 칸과 섞지 않고 따로 둔다. 노드는 사람이 옮기기 전에는 저절로 바뀌지 않는다.
// 워크플로우를 켜지 않은 프로젝트(실행도 없음)면 아무것도 그리지 않아 이슈 상세가 예전과 같다.
import { MoreHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { AgentBadge } from '@/components/users/AgentBadge'
import { elapsedLabel } from '@/lib/aiRoster'
import { cn } from '@/lib/utils'
import {
  isRunEnded,
  type IssueWorkflowView,
  isWorkflowEnabledProject,
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  startConditionSuffix,
  useAssignPreview,
  useIssueWorkflow,
  useIssueWorkflowCardVisible,
} from '@/lib/workflow'
import { useProjectWorkflows, useWorkflowVersion, type WorkflowModel } from '@/lib/workflows'

import { RecoverDialog } from '../workflow/RecoverDialog'
import { IssuePropertyGroup } from './IssuePropertyGroup'

/** 사람 이름을 쉼표로 잇고 AI 는 이름 옆에 AI 표식 — 카드의 행위자·담당과 시작 창의 담당 줄이 함께 쓴다. */
export function UserNames({ users }: { users: { id: number; name: string; kind?: 'HUMAN' | 'AGENT' }[] }) {
  return (
    <>
      {users.map((u, i) => (
        <span key={u.id}>
          {i > 0 && ', '}
          {u.name}
          {u.kind === 'AGENT' && <AgentBadge size="xs" className="ml-1 align-middle" />}
        </span>
      ))}
    </>
  )
}

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
  // 담당이 없으면 미리보기를 묻지 않고 「담당을 지정하면 시작돼요」만 알린다.
  const noAssignee = assigneeIds.length === 0
  // 지금 담당 기준(current)으로 묻는다 — 새로 더한 사람 기준이면 늘 「시작 안 함」이 나와 맞는 담당이 있어도 조건 문구를 냈다(코드 리뷰).
  const preview = useAssignPreview(issueId, assigneeIds, show && !noAssignee, true)
  // 지금 담당으로 시작될 수 있는데 아직 안 시작된 경우(담당 지정 전 켠 워크플로우 등)에는 조건 문구를 내지 않는다.
  const note = !show
    ? null
    : noAssignee
      ? '담당을 지정하면 워크플로우가 시작돼요'
      : preview.data && !preview.data.start
        ? `이 담당으로는 시작하지 않아요${startConditionSuffix(preview.data.startRoles)}`
        : null
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

export function IssueWorkflowCard({ issueId, projectKey, projectId, canEdit, isManager, closed = false, assigneeIds }: IssueWorkflowCardProps) {
  const view = useIssueWorkflow(issueId)
  const list = useProjectWorkflows(projectId)
  const run = view.data
  // 시작·조치를 그릴 수 있는가 — 닫힌 이슈는 서버가 둘 다 409 로 거절한다.
  const editable = canEdit && !closed
  const workflowId = run?.workflowId ?? null
  const versionNo = run?.versionNo ?? null
  // 남은 단계 이름 — 실행이 고정한 버전(run.versionNo)의 모델의 노드 이름. 못 읽으면 키 그대로 보인다.
  const version = useWorkflowVersion(workflowId ?? 0, workflowId != null ? versionNo : null)
  // 실행이 고정한 버전(run.versionNo)의 모델의 노드(키·이름) — 남은 단계 이름과 「옮기기」 후보에 쓴다. 모델이 바뀔 때만 다시 만든다.
  const nodes = useMemo(
    () => (version.data?.model.nodes ?? []).map((n) => ({ key: n.key, name: n.name ?? n.key })),
    [version.data],
  )
  const names = useMemo(() => new Map(nodes.map((n) => [n.key, n.name])), [nodes])
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

  const remaining = run.remainingNodeKeys.map((k) => names.get(k) ?? k).join(' → ')
  const defName = (list.data ?? []).find((w) => w.id === workflowId)?.name
  const status = run.status
  const cur = run.currentNode
  const stayed = cur?.enteredAt ? elapsedLabel(cur.enteredAt) : ''
  const ended = isRunEnded(run)

  return (
    <div className="space-y-2 text-sm" data-testid="issue-workflow-card">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium">
          {defName ?? '워크플로우'} v{versionNo}
        </span>
        {status && (
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', RUN_STATUS_TONE[status])}>
            {RUN_STATUS_LABEL[status]}
          </span>
        )}
        {editable && status === 'SUSPENDED' && (
          <RecoverActions
            issueId={issueId}
            projectKey={projectKey}
            run={run}
            isManager={isManager}
            model={version.data?.model}
          />
        )}
      </div>
      <ul className="space-y-0.5 text-muted-foreground">
        {run.path.map((p, i) => (
          <li key={`${p.key}-${i}`}>
            <span>✓ {p.name ?? p.key}</span>
            {/* 그 단계를 한 행위자 — 서버가 못 채운 단계(null)는 이름만 보인다. */}
            {p.actor && (
              <>
                {' · '}
                <UserNames users={[p.actor]} />
              </>
            )}
          </li>
        ))}
      </ul>
      {cur && !ended && (
        <div className="rounded-md border bg-muted/40 p-2">
          <div className="font-medium">● {cur.name ?? cur.key}</div>
          <div className="text-xs text-muted-foreground">
            {cur.assignees.length > 0 && (
              <>
                <UserNames users={cur.assignees} /> ·{' '}
              </>
            )}
            {/* elapsedLabel 이 1분 미만이면 「방금」 — 「방금째」가 되지 않게 그때는 「째」를 붙이지 않는다. */}
            {stayed === '' || stayed === '방금' ? stayed : `${stayed}째`}
          </div>
        </div>
      )}
      {remaining && !ended && <p className="text-xs text-muted-foreground">{remaining}</p>}
      <div className="flex items-center justify-between gap-2">
        <Link className="text-xs text-primary hover:underline" to={`/projects/${projectKey}/workflow${run.runId != null ? `?view=runs&workflow=${run.workflowId}&run=${run.runId}` : ''}`}>
          실행 보기 ↗
        </Link>
      </div>
      {ended && enabled && (
        <StartConditionNote projectKey={projectKey} issueId={issueId} assigneeIds={assigneeIds} isManager={isManager} show={askStartNote} />
      )}
    </div>
  )
}
