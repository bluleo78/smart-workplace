// 이슈 상세 「AI 작업 단계」 카드(WP-1989) — 지나온 단계·지금 단계·남은 단계를 한눈에 보인다.
// 왜: 워크플로우는 이슈 상태와 별개의 진행축이라 상태 칸과 섞지 않고 따로 둔다. 노드는 사람이 옮기기 전에는 저절로 바뀌지 않는다.
// 워크플로우를 켜지 않은 프로젝트(실행도 없음)면 아무것도 그리지 않아 이슈 상세가 예전과 같다.
import { MoreHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/overlay/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { AgentBadge } from '@/components/users/AgentBadge'
import { elapsedLabel } from '@/lib/aiRoster'
import { extractApiErrorCode } from '@/lib/api-error'
import { cn } from '@/lib/utils'
import {
  isRunEnded,
  type IssueWorkflowView,
  isWorkflowEnabledProject,
  type RecoverAction,
  RUN_STATUS_LABEL,
  type RunStatus,
  useIssueWorkflow,
  useIssueWorkflowCardVisible,
  useRecoverIssueWorkflow,
  workflowErrorMessage,
} from '@/lib/workflow'
import { useProjectWorkflows, useWorkflowVersion } from '@/lib/workflows'

import { IssuePropertyGroup } from './IssuePropertyGroup'

/** 상태 칩 색 — 시맨틱 토큰만(조치 필요는 경고, 완료는 성공, AI 작업 중은 AI 강조색). */
const CHIP_CLASS: Record<RunStatus, string> = {
  RUNNING: 'bg-ai-accent-subtle text-ai-accent',
  WAITING: 'bg-info/10 text-info-text',
  SUSPENDED: 'bg-destructive/10 text-destructive',
  COMPLETED: 'bg-success/10 text-success',
  CANCELED: 'bg-muted text-muted-foreground',
}

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
  /** 이슈를 고칠 수 있는 사람(시작 버튼 노출). */
  canEdit: boolean
  /** 프로젝트 관리자·소유자 — 멈춘 실행 조치(후속 작업)에서 쓴다. */
  isManager: boolean
  /** 닫힌(완료·취소) 이슈 — 서버가 시작·조치를 409 로 거절하므로 두 단추를 그리지 않는다. */
  closed?: boolean
  /** 「워크플로우 시작」 — 시작 창은 페이지가 연다. */
  onStart: () => void
}

/** 조치 종류별 문구 — 확인 창 제목·메뉴에 쓴다. */
const ACTION_LABEL: Record<RecoverAction, string> = {
  RETRY: '다시 시도',
  ON_ERROR: '오류 경로로 보내기',
  MOVE_TO: '다른 노드로 옮기기',
  CANCEL: '실행 취소',
}

/**
 * 「⋯ 조치」 메뉴와 확인 창 — 멈춘(조치 필요) 실행에만 — 다시 시도·오류 경로·취소(관리자는 옮기기까지).
 * 왜: 노드는 사람이 바로잡기 전에는 저절로 풀리지 않는다. 누르면 곧바로 실행하지 않고 남길 말과 함께 한 번 확인한다.
 */
function RecoverActions({
  issueId, projectKey, run, isManager, nodes,
}: {
  issueId: number
  projectKey: string
  run: IssueWorkflowView
  isManager: boolean
  nodes: { key: string; name: string }[]
}) {
  const recover = useRecoverIssueWorkflow(issueId, projectKey)
  const [action, setAction] = useState<RecoverAction | null>(null)
  const [comment, setComment] = useState('')
  const [toNode, setToNode] = useState<string | null>(null)
  // 서버는 멈춘(조치 필요) 실행에만 조치를 받는다(WORKFLOW_NOT_SUSPENDED) — 이 메뉴는 SUSPENDED 일 때만 그려진다.
  const actions: RecoverAction[] = ['RETRY', 'ON_ERROR', ...(isManager ? (['MOVE_TO'] as const) : []), 'CANCEL']

  function close() {
    setAction(null)
    setComment('')
    setToNode(null)
  }

  async function confirm() {
    if (!action) return
    try {
      await recover.mutateAsync({
        action,
        ...(action === 'MOVE_TO' && toNode ? { toNode } : {}),
        ...(comment.trim() !== '' ? { comment: comment.trim() } : {}),
        expectedRevision: run.revision,
      })
      toast.success(`${ACTION_LABEL[action]} 처리했어요.`)
    } catch (e) {
      toast.error(workflowErrorMessage(e, '조치하지 못했어요.'))
      // STALE 이면 훅이 다시 읽어 오므로 창을 닫고, 그 밖의 오류는 창과 남길 말을 둔다(다시 누를 수 있게).
      if (extractApiErrorCode(e) !== 'WORKFLOW_STALE') return
    }
    close()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="icon" variant="ghost" className="h-6 w-6" aria-label="조치">
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {actions.map((a) => (
            <DropdownMenuItem key={a} onSelect={() => setAction(a)}>
              {ACTION_LABEL[a]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={action != null} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action ? ACTION_LABEL[action] : ''}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {action === 'MOVE_TO' && nodes.length === 0 && (
              <p className="text-xs text-muted-foreground">단계 목록을 불러오지 못했거나 아직 불러오는 중이에요. 잠시 뒤 다시 열어 주세요.</p>
            )}
            {action === 'MOVE_TO' && nodes.length > 0 && (
              <RadioGroup aria-label="옮길 노드" value={toNode ?? ''} onValueChange={setToNode} className="space-y-1">
                {nodes.map((n) => (
                  <label key={n.key} className="flex cursor-pointer items-center gap-2">
                    <RadioGroupItem value={n.key} aria-label={n.name} />
                    {n.name}
                  </label>
                ))}
              </RadioGroup>
            )}
            <Textarea aria-label="남길 말(선택)" placeholder="남길 말(선택)" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>취소</Button>
            <Button type="button" disabled={recover.isPending || (action === 'MOVE_TO' && toNode == null)} onClick={confirm}>
              확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function IssueWorkflowCard({ issueId, projectKey, projectId, canEdit, isManager, closed = false, onStart }: IssueWorkflowCardProps) {
  const view = useIssueWorkflow(issueId)
  const list = useProjectWorkflows(projectId)
  const run = view.data
  // 시작·조치를 그릴 수 있는가 — 닫힌 이슈는 서버가 둘 다 409 로 거절한다.
  const editable = canEdit && !closed
  const workflowId = run?.workflowId ?? null
  const versionNo = run?.versionNo ?? null
  // 남은 단계 이름 — 게시 버전 모델의 노드 이름. 못 읽으면 키 그대로 보인다.
  const version = useWorkflowVersion(workflowId ?? 0, workflowId != null ? versionNo : null)
  // 게시 버전 모델의 노드(키·이름) — 남은 단계 이름과 「옮기기」 후보에 쓴다. 모델이 바뀔 때만 다시 만든다.
  const nodes = useMemo(
    () => (version.data?.model.nodes ?? []).map((n) => ({ key: n.key, name: n.name ?? n.key })),
    [version.data],
  )
  const names = useMemo(() => new Map(nodes.map((n) => [n.key, n.name])), [nodes])
  // 카드는 IssueWorkflowGroup 안에서만 그려진다 — 그룹이 이미 「실행 있음 || 켜진 프로젝트」일 때만 보이므로 여기서 다시 거르지 않는다.
  if (!run) return null
  const enabled = isWorkflowEnabledProject(list.data)

  if (run.runId == null) {
    return (
      <div className="space-y-2" data-testid="issue-workflow-card">
        <p className="text-sm text-muted-foreground">아직 워크플로우가 없어요.</p>
        {editable && (
          <Button type="button" size="sm" variant="outline" onClick={onStart}>
            워크플로우 시작
          </Button>
        )}
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
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', CHIP_CLASS[status])}>
            {RUN_STATUS_LABEL[status]}
          </span>
        )}
        {editable && status === 'SUSPENDED' && (
          <RecoverActions
            issueId={issueId}
            projectKey={projectKey}
            run={run}
            isManager={isManager}
            nodes={nodes}
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
        <Link className="text-xs text-primary hover:underline" to={`/projects/${projectKey}/workflow`}>
          실행 보기 ↗
        </Link>
        {ended && enabled && editable && (
          <Button type="button" size="sm" variant="outline" onClick={onStart}>
            워크플로우 시작
          </Button>
        )}
      </div>
    </div>
  )
}
