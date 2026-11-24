// 워크플로우 실행 상세(WP-1991) — 머리·사람 차례/조치 필요 배너·그래프(지나온 노드 칠하기)·이동 기록.
// 왜: 어느 이슈가 어느 단계에서 누구를 기다리는지 한 화면에서 보고, 막힌 실행은 여기서 바로 조치하게 한다.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useWorkflowRun } from '@/hooks/queries/useWorkflowRuns'
import { isNotFoundError } from '@/lib/api-error'
import { issuePath } from '@/lib/appUrl'
import { formatDateTimeMinute } from '@/lib/formatters'
import { RUN_STATUS_LABEL } from '@/lib/workflow'
import { nodeDurationsMs, paintRun, pendingQuestion, runMoveRows, type WorkflowRunDetail as RunDetail } from '@/lib/workflowRuns'
import { IssueWorkflowBanner } from '@/pages/projects/components/IssueWorkflowBanner'

import { RecoverDialog } from './RecoverDialog'
import { WorkflowGraphView } from './WorkflowGraphView'

interface Props {
  runId: number
  /** 지금 열어 둔 워크플로우 정의 — 실행이 다른 정의의 것이면 상세 대신 안내만 보인다. */
  workflowId: number
  projectKey: string
  canManage: boolean
  /**
   * 조치를 할 수 있는 사람 — 서버 조치는 이슈 쓰기 + 프로젝트 구성원이 필요하다(viewerIsMember).
   * 닫힌 이슈는 서버가 409 로 거절한다(실행 응답에 이슈 상태가 없어 단추는 막지 않고 서버 메시지로 알린다).
   */
  canRecover: boolean
  meId: number
}

/** 실행 상세 — 고른 실행 하나를 읽어 그린다. 없으면(404) 안내만 보이고 목록은 그대로 남는다(부모가 따로 그린다). */
export function WorkflowRunDetail({ runId, workflowId, projectKey, canManage, canRecover, meId }: Props) {
  const query = useWorkflowRun(runId)
  const detail = query.data
  // 낮은 곳의 그래프 칠하기·소요 시간 — 상세가 바뀔 때만 다시 계산한다(소요 시간은 그때의 now 까지).
  const paint = useMemo(() => (detail ? paintRun(detail) : undefined), [detail])
  // 지금 노드에 머문 시간이 멈추지 않게 now 를 분마다 갱신해 의존성에 둔다.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  const durations = useMemo(() => (detail ? nodeDurationsMs(detail, now) : undefined), [detail, now])
  const rows = useMemo(() => (detail ? runMoveRows(detail) : []), [detail])

  if (query.isError) {
    if (isNotFoundError(query.error)) return <p role="alert" className="text-sm">실행을 찾을 수 없습니다</p>
    return (
      <p role="alert" className="text-sm">
        실행을 불러오지 못했습니다. <Button variant="link" size="sm" onClick={() => void query.refetch()}>다시 불러오기</Button>
      </p>
    )
  }
  if (!detail || !paint || !durations) return <p className="text-sm text-muted-foreground">실행을 불러오는 중…</p>

  const { run } = detail
  // 주소의 run 이 다른 워크플로우의 실행이면(링크·주소 편집) 이 정의의 화면으로 그리지 않는다.
  if (run.workflowId !== workflowId) return <p role="alert" className="text-sm">이 실행은 다른 워크플로우의 실행입니다</p>
  // 지금 방문 — 지금 노드의 아직 떠나지 않은 가장 늦은 방문.
  const atCurrent = [...detail.nodeRuns].reverse().filter((v) => v.nodeKey === run.currentNode)
  // 열린 방문이 없는 SUSPENDED 실행(연쇄 한도 초과 — 서버가 닫힌 FAILED 방문을 씀)은 가장 늦은 방문이 멈춘 방문(FAILED·BLOCKED)일 때만
  // 거기서 이유를 찾는다 — 정상으로 끝난 앞 회차 방문의 낡은 사유를 이번 멈춤의 이유로 보이지 않게.
  const latest = atCurrent[0]
  const latestStopped = latest?.status === 'FAILED' || latest?.status === 'BLOCKED'
  const visit = atCurrent.find((v) => v.leftAt == null) ?? (run.status === 'SUSPENDED' && latestStopped ? latest : null)

  return (
    <div className="min-w-0 space-y-3" data-testid="run-detail">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{RUN_STATUS_LABEL[run.status]}</Badge>
          <span className="font-medium">{run.issueKey}</span>
          <span className="min-w-0 flex-1 truncate">{run.title}</span>
          <Link className="text-xs text-primary hover:underline" to={issuePath(projectKey, run.issueNumber)}>이슈 열기 ↗</Link>
        </div>
        <p className="text-xs text-muted-foreground">
          {`실행 #${run.runId} · 버전 ${run.versionNo} · ${formatDateTimeMinute(run.startedAt)}${run.startedBy ? ` · ${run.startedBy.name} 시작` : ''}`}
        </p>
      </div>
      <RunBanner detail={detail} visit={visit} projectKey={projectKey} canManage={canManage} canRecover={canRecover} meId={meId} onDone={() => void query.refetch()} />
      <WorkflowGraphView model={detail.model} readOnly paint={paint} durations={durations} />
      <section aria-label="이동 기록" className="space-y-1">
        <h3 className="text-sm font-medium">이동 기록</h3>
        <ul className="space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.id}>
              {r.from === null ? '워크플로우 시작' : `${r.from} → ${r.to}`}
              {r.actorName ? ` · ${r.actorName}` : ''}
              {r.outcome ? ` · 결과 「${r.outcome}」` : ''}
              {` · ${formatDateTimeMinute(r.at)}`}
              {r.assigned.length > 0 ? ` · 담당 → ${r.assigned.join(', ')}` : ''}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/** 상태별 배너 — 사람 차례(주황)·조치 필요(빨강). 그 밖의 상태는 배너가 없다. */
function RunBanner({ detail, visit, projectKey, canManage, canRecover, meId, onDone }: {
  detail: RunDetail
  visit: RunDetail['nodeRuns'][number] | null
  projectKey: string
  canManage: boolean
  canRecover: boolean
  meId: number
  onDone: () => void
}) {
  const { run, model } = detail
  // 창을 열 때의 revision 을 고정한다 — 창이 열린 동안 상세가 새로 고쳐져도 이 값으로 보낸다. null 이면 닫힘.
  const [openRevision, setOpenRevision] = useState<number | null>(null)
  const node = model.nodes.find((n) => n.key === run.currentNode)

  if (run.status === 'WAITING' && node?.type === 'human_task') {
    const assignees = visit?.assignees ?? []
    // 내가 지금 방문의 담당이면 답할 수 있는 배너, 아니면 질문과 담당만 보인다.
    if (assignees.some((a) => a.id === meId)) return <IssueWorkflowBanner issueId={run.issueId} projectKey={projectKey} meId={meId} />
    const q = pendingQuestion(run.context, run.currentNode)
    return (
      <div className="space-y-1 rounded-md border border-warning/40 bg-warning-subtle p-3 text-sm" data-testid="run-waiting-banner">
        <div className="font-medium text-warning-text">{`${node.name ?? node.key} — 사람 차례`}</div>
        {q && <p>{`「${q}」`}</p>}
        <p className="text-xs">{`담당: ${assignees.map((a) => a.name).join(', ')}`}</p>
      </div>
    )
  }

  if (run.status === 'SUSPENDED') {
    const reason = visit?.error ?? visit?.waitingReason ?? '멈춘 이유가 기록되지 않았습니다'
    return (
      <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm" data-testid="run-suspended-banner">
        <div className="font-medium text-destructive">{`${node?.name ?? run.currentNode} — 조치 필요`}</div>
        <p>{reason}</p>
        {canRecover && <Button size="sm" variant="outline" onClick={() => setOpenRevision(run.revision)}>조치 고르기</Button>}
        {canRecover && (
          <RecoverDialog
            open={openRevision !== null} onOpenChange={(o) => { if (!o) setOpenRevision(null) }}
            issueId={run.issueId} projectKey={projectKey} revision={openRevision ?? run.revision}
            currentNode={node} model={model} canManage={canManage} onDone={onDone}
          />
        )}
      </div>
    )
  }
  return null
}
