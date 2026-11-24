// 워크플로우 탭 › 실행 — 왼쪽 실행 목록(상태·노드·담당 필터, 다음 쪽)과 오른쪽 고른 실행 자리, 「그래프에 모아 보기」(WP-1991).
// 고른 실행은 주소 `?run=<id>`, 모아 보기는 `?runsView=graph` 로 둬 공유·뒤로 가기가 되게 한다. 필터는 화면 상태다(주소 아님).
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useProjectMembers } from '@/hooks/queries/useProjectMembers'
import { useWorkflowRunCounts, useWorkflowRuns } from '@/hooks/queries/useWorkflowRuns'
import { formatRelativeTime } from '@/lib/formatters'
import { RUN_STATUS_LABEL, type RunStatus } from '@/lib/workflow'
import { type RunFilters, type WorkflowRunItem } from '@/lib/workflowRuns'
import { useWorkflowVersion, type WorkflowModel } from '@/lib/workflows'

import { WorkflowGraphView } from './WorkflowGraphView'
import { WorkflowRunDetail } from './WorkflowRunDetail'
import { workflowSelectClass } from './WorkflowVersions'

const STATUSES: RunStatus[] = ['SUSPENDED', 'WAITING', 'RUNNING', 'COMPLETED', 'CANCELED']

/** 상태 칩 색 — 시맨틱 토큰만. 조치 필요는 destructive, 사람 차례는 warning 계열. */
const chipClass: Record<RunStatus, string> = {
  SUSPENDED: 'border-destructive/40 bg-destructive/10 text-destructive',
  WAITING: 'border-warning/40 bg-warning-subtle',
  RUNNING: 'border-primary/40 bg-primary/10',
  COMPLETED: 'bg-muted text-muted-foreground',
  CANCELED: 'bg-muted text-muted-foreground',
}

interface Props {
  workflowId: number
  projectKey: string
  activeVersionNo: number | null
  canManage: boolean
  /** 멈춘 실행에 조치를 할 수 있는 사람(프로젝트 구성원) — 실행 상세로 넘긴다. */
  canRecover: boolean
  meId: number
  /** 진행 중인 실행 수 — 버전별 activeRuns 합계(WorkflowTab 의 versions 조회). 모르면 null. */
  runningCount: number | null
  /** 실행 수 조회 실패 — 다시 불러오기를 보인다. */
  runningFailed: boolean
  onRetryRunning: () => void
  /** 옛 버전 실행 안내 문구(lib/workflowRuns olderRunsNotice) — 그래프 모아 보기에서 빠지는 까닭을 그래프 위에 보인다. 없으면 안내 없음. */
  olderNotice?: string | null
}

/** 실행 목록 + 고른 실행 자리. 목록 머리에 진행 중 수 문구를 두고 필터·모아 보기 단추를 둔다. */
export function WorkflowRuns({ workflowId, projectKey, activeVersionNo, canManage, canRecover, meId, runningCount, runningFailed, onRetryRunning, olderNotice }: Props) {
  const [params, setParams] = useSearchParams()
  const runId = Number(params.get('run')) || null
  const graphView = params.get('runsView') === 'graph'
  const [filters, setFilters] = useState<RunFilters>({})
  const hasFilter = Object.values(filters).some((v) => v !== undefined)

  const runs = useWorkflowRuns(workflowId, filters, !graphView)
  const counts = useWorkflowRunCounts(workflowId, graphView)
  const published = useWorkflowVersion(workflowId, activeVersionNo)
  const members = useProjectMembers(projectKey)
  const items = useMemo(() => runs.data?.pages.flatMap((p) => p.items) ?? [], [runs.data])
  const model = published.data?.model

  // 노드 이름 — 게시 모델에서. 목록 줄이 currentNodeName 을 주지만 필터 후보에도 쓴다.
  const nodeOptions = (model?.nodes ?? []).filter((n) => n.type !== 'start' && n.type !== 'end')

  /** 주소 검색값 하나를 바꾼다(push — 뒤로 가기가 이전 선택으로 돌아가게). */
  function setParam(name: string, value: string | null) {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value === null) next.delete(name)
      else next.set(name, value)
      return next
    }, { replace: false })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* 문구의 값은 예전과 같은 출처(versions 의 activeRuns 합계) — 실패하면 다시 불러오기를 보인다. */}
        {runningCount === null && runningFailed ? (
          <span role="alert" className="text-sm">
            실행 수를 불러오지 못했습니다. <Button variant="link" size="sm" onClick={onRetryRunning}>다시 불러오기</Button>
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">{runningCount === null ? '실행 수를 불러오는 중…' : `진행 중인 실행 ${runningCount}개`}</span>
        )}
        <FilterSelect
          id="run-filter-status" label="상태" allLabel="상태: 전체" value={filters.status ?? ''}
          options={STATUSES.map((st) => ({ value: st, label: RUN_STATUS_LABEL[st] }))}
          onChange={(v) => setFilters((f) => ({ ...f, status: (v || undefined) as RunStatus | undefined }))}
        />
        <FilterSelect
          id="run-filter-node" label="노드" allLabel="노드: 전체" value={filters.node ?? ''}
          options={nodeOptions.map((n) => ({ value: n.key, label: n.name ?? n.key }))}
          onChange={(v) => setFilters((f) => ({ ...f, node: v || undefined }))}
        />
        <FilterSelect
          id="run-filter-assignee" label="담당" allLabel="담당: 전체" value={filters.assigneeId ?? ''}
          options={(members.data ?? []).map((m) => ({ value: m.userId, label: m.name }))}
          onChange={(v) => setFilters((f) => ({ ...f, assigneeId: v ? Number(v) : undefined }))}
        />
        <Button
          size="sm" variant={graphView ? 'secondary' : 'ghost'} aria-pressed={graphView} className="ml-auto"
          onClick={() => setParam('runsView', graphView ? null : 'graph')}
        >
          그래프에 모아 보기
        </Button>
      </div>
      {graphView ? (
        <GraphBody model={model} activeVersionNo={activeVersionNo} isError={published.isError} onRetry={() => void published.refetch()} badges={counts.data}
          notice={olderNotice ?? null} onShowList={() => setParam('runsView', null)} />
      ) : (
        <div className="grid min-w-0 items-start gap-3 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="min-w-0 space-y-2">
            {runs.isError ? (
              <p role="alert" className="text-sm">
                실행 목록을 불러오지 못했습니다. <Button variant="link" size="sm" onClick={() => void runs.refetch()}>다시 불러오기</Button>
              </p>
            ) : runs.isPending ? (
              <p className="text-sm text-muted-foreground">실행을 불러오는 중…</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{hasFilter ? '조건에 맞는 실행이 없습니다' : '아직 실행이 없습니다'}</p>
            ) : (
              <ul className="space-y-1">
                {items.map((item) => (
                  <RunRow key={item.runId} item={item} selected={item.runId === runId} onSelect={() => setParam('run', String(item.runId))} />
                ))}
              </ul>
            )}
            {runs.hasNextPage && (
              <Button size="sm" variant="outline" disabled={runs.isFetchingNextPage} onClick={() => void runs.fetchNextPage()}>더 보기</Button>
            )}
          </div>
          {/* 고른 실행의 상세 — 없으면 안내. */}
          <div className="min-w-0">
            {runId === null
              ? <p className="text-sm text-muted-foreground">실행을 고르면 여기에 상세가 보입니다.</p>
              : <WorkflowRunDetail runId={runId} workflowId={workflowId} projectKey={projectKey} canManage={canManage} canRecover={canRecover} meId={meId} />}
          </div>
        </div>
      )}
    </div>
  )
}

/** 목록 한 줄 — 상태 칩·이슈 키·제목·지금 노드·담당·머문 시간. 줄 전체가 단추다. */
function RunRow({ item, selected, onSelect }: { item: WorkflowRunItem; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button" aria-current={selected || undefined} onClick={onSelect}
        className={'flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md border p-2 text-left text-sm hover:bg-muted/50 ' + (selected ? 'bg-muted' : '')}
      >
        <Badge variant="outline" className={chipClass[item.status]}>{RUN_STATUS_LABEL[item.status]}</Badge>
        <span className="font-medium">{item.issueKey}</span>
        <span className="min-w-0 flex-1 truncate">{item.title}</span>
        <span className="text-xs text-muted-foreground">{item.currentNodeName ?? item.currentNode}</span>
        <span className="text-xs text-muted-foreground">{item.assignees.map((a) => a.name).join(', ')}</span>
        <span className="text-xs text-muted-foreground">{formatRelativeTime(item.enteredAt)}</span>
      </button>
    </li>
  )
}

/** 필터 select 하나 — 보이지 않는 label 과 「전체」 선택지 + 값 목록. 값은 문자열로 주고받는다. */
function FilterSelect({ id, label, allLabel, value, options, onChange }: {
  id: string
  label: string
  allLabel: string
  value: string | number
  options: { value: string | number; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <select id={id} className={workflowSelectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </>
  )
}

/** 그래프에 모아 보기 본문 — 게시 모델이 있으면 그래프, 없으면 게시 없음·실패·로딩 안내를 early return 으로 가른다. */
function GraphBody({ model, activeVersionNo, isError, onRetry, badges, notice, onShowList }: {
  model: WorkflowModel | undefined
  activeVersionNo: number | null
  isError: boolean
  onRetry: () => void
  badges: Record<string, number> | undefined
  notice: string | null
  onShowList: () => void
}) {
  if (model) {
    // 옛 버전 실행은 그래프 단계에 셈하지 않으므로, 있으면 그 사실과 목록으로 가는 길을 그래프 위에 알린다.
    // role="note" — 수가 다시 읽힐 때마다 스크린리더가 단추까지 되읽지 않게 라이브 영역(status)으로 두지 않는다.
    return (
      <div className="space-y-2">
        {notice && (
          <div role="note" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-sm">
            <span className="min-w-0">{notice}</span>
            <Button variant="link" size="sm" onClick={onShowList}>목록에서 보기</Button>
          </div>
        )}
        <WorkflowGraphView model={model} readOnly badges={badges} />
      </div>
    )
  }
  if (activeVersionNo === null) return <p className="text-sm text-muted-foreground">게시된 버전이 없습니다</p>
  if (isError) {
    return (
      <p role="alert" className="text-sm">
        게시 버전을 불러오지 못했습니다. <Button variant="link" size="sm" onClick={onRetry}>다시 불러오기</Button>
      </p>
    )
  }
  return <p className="text-sm text-muted-foreground">게시 버전을 불러오는 중…</p>
}
