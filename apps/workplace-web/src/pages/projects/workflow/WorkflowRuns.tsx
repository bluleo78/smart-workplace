// 워크플로우 탭 › 실행 — 왼쪽 실행 목록(글자 탭·필터 팝오버, 다음 쪽; WP-2157 두 칸·덜어내기)과 오른쪽 고른 실행 자리, 「그래프에 모아 보기」(WP-1991).
// 고른 실행은 주소 `?run=<id>`, 모아 보기는 `?runsView=graph` 로 둬 공유·뒤로 가기가 되게 한다. 필터는 화면 상태다(주소 아님).
import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover'
import { ResultStatus } from '@/components/ResultStatus'
import { Button } from '@/components/ui/button'
import { useProjectMembers } from '@/hooks/queries/useProjectMembers'
import { invalidateRunListAndCounts, useWorkflowRun, useWorkflowRunCounts, useWorkflowRuns } from '@/hooks/queries/useWorkflowRuns'
import { formatRelativeTime } from '@/lib/formatters'
import { ACTIVE_RUN_STATUSES, RUN_STATUS_DOT, RUN_STATUS_LABEL, RUN_STATUS_ORDER, type RunStatus } from '@/lib/workflow'
import { runDetailOpenedText, type RunFilters, type WorkflowRunItem } from '@/lib/workflowRuns'
import { useWorkflowVersion, type WorkflowModel } from '@/lib/workflows'

import { WorkflowGraphView } from './WorkflowGraphView'
import { WorkflowRunDetail } from './WorkflowRunDetail'
import { workflowSelectClass } from './WorkflowVersions'

/** 목록 글자 탭 — 진행 중(ACTIVE)·완료·전체(WP-2157). 값이 곧 서버 status 라 ALL 만 상태 없음이다. 화면 상태다. */
type RunTab = 'ACTIVE' | 'COMPLETED' | 'ALL'

interface Props {
  workflowId: number
  projectKey: string
  activeVersionNo: number | null
  canManage: boolean
  /** 멈춘 실행에 조치를 할 수 있는 사람(프로젝트 구성원) — 실행 상세로 넘긴다. */
  canRecover: boolean
  meId: number
  /** 진행 중인 실행 수 — 버전별 activeRuns 합계(WorkflowTab 의 versions 조회). 탭 숫자는 byStatus 가 쓰고, 이 값은 실수 조회 실패 안내 판정에만 쓴다. 모르면 null. */
  runningCount: number | null
  /** 실행 수 조회 실패 — 다시 불러오기를 보인다. */
  runningFailed: boolean
  onRetryRunning: () => void
  /** 옛 버전 실행 안내 문구(lib/workflowRuns olderRunsNotice) — 그래프 모아 보기에서 빠지는 까닭을 그래프 위에 보인다. 없으면 안내 없음. */
  olderNotice?: string | null
}

/** 실행 목록 + 고른 실행 자리. 목록 머리에 글자 탭(진행 중·완료·전체)·필터 단추·모아 보기 단추를 둔다. */
export function WorkflowRuns({ workflowId, projectKey, activeVersionNo, canManage, canRecover, meId, runningCount, runningFailed, onRetryRunning, olderNotice }: Props) {
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const runId = Number(params.get('run')) || null
  const graphView = params.get('runsView') === 'graph'
  const [filters, setFilters] = useState<RunFilters>({})
  const [tab, setTab] = useState<RunTab>('ACTIVE')
  const filterCount = Object.values(filters).filter((v) => v !== undefined).length
  const hasFilter = filterCount > 0
  // 상태 select 를 고르면 탭의 상태보다 앞선다 — 서버에 보낼 상태는 select 값 ?? 탭 값.
  const tabStatus: RunFilters['status'] = tab === 'ALL' ? undefined : tab
  const queryFilters: RunFilters = { ...filters, status: filters.status ?? tabStatus }

  const runs = useWorkflowRuns(workflowId, queryFilters, !graphView)
  // 탭 숫자(byStatus)와 그래프 배지(counts)가 같은 조회를 쓰므로 목록·그래프 보기 모두 읽는다.
  const counts = useWorkflowRunCounts(workflowId, true)
  const byStatus = counts.data?.byStatus
  const activeCount = byStatus ? ACTIVE_RUN_STATUSES.reduce((sum, st) => sum + byStatus[st], 0) : null
  const versionCountFailed = runningCount === null && runningFailed
  const published = useWorkflowVersion(workflowId, activeVersionNo)
  const members = useProjectMembers(projectKey)
  // 상세와 같은 쿼리 키라 요청이 늘지 않는다 — 열림 안내 문구(이슈 키)를 얻으려고 읽는다(WP-2053).
  // 그래프 보기에서는 상세를 그리지 않으니 읽지 않는다(주소에 run 이 남아 있어도 요청이 더 가지 않게).
  const runQuery = useWorkflowRun(graphView ? null : runId)
  const items = useMemo(() => runs.data?.pages.flatMap((p) => p.items) ?? [], [runs.data])
  const model = published.data?.model

  // 노드 이름 — 게시 모델에서. 목록 줄이 currentNodeName 을 주지만 필터 후보에도 쓴다.
  const nodeOptions = (model?.nodes ?? []).filter((n) => n.type !== 'start' && n.type !== 'end')

  /** 탭을 고르면 상태 select 를 비운다(WP-2157) — select 가 탭보다 앞서므로 남겨 두면 탭을 눌러도 목록이 안 바뀌어 보인다. */
  function selectTab(next: RunTab) {
    setTab(next)
    setFilters((f) => ({ ...f, status: undefined }))
  }

  /** 상태 select 를 고르면 탭을 「전체」로 옮긴다(WP-2157) — 목록은 select 상태인데 「완료」 탭이 눌려 보이는 어긋남을 막는다. 비우면 전체 탭 그대로. */
  function selectStatus(status: RunStatus | undefined) {
    if (status) setTab('ALL')
    setFilters((f) => ({ ...f, status }))
  }

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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* 진행 중 수 문구는 글자 탭 숫자로 대체. 실행 수 조회 실패 알림은 머리 아래에 남긴다. */}
        {!graphView && (
          <div className="flex items-center gap-3 text-sm">
            {([['ACTIVE', activeCount === null ? '진행 중' : `진행 중 ${activeCount}`],
              ['COMPLETED', byStatus ? `완료 ${byStatus.COMPLETED}` : '완료'],
              ['ALL', '전체']] as const).map(([key, text]) => (
              <button
                key={key} type="button" aria-pressed={tab === key} onClick={() => selectTab(key)}
                className={tab === key ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}
              >
                {text}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {!graphView && (
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="ghost">{filterCount > 0 ? `필터 ${filterCount}` : '필터'}</Button>
              </PopoverTrigger>
              <PopoverContent align="end" aria-label="실행 필터" className="flex w-auto flex-col gap-2">
                <FilterSelect
                  id="run-filter-status" label="상태" allLabel="상태: 전체" value={filters.status ?? ''}
                  options={RUN_STATUS_ORDER.map((st) => ({ value: st, label: RUN_STATUS_LABEL[st] }))}
                  onChange={(v) => selectStatus((v || undefined) as RunStatus | undefined)}
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
              </PopoverContent>
            </Popover>
          )}
          <Button
            size="sm" variant={graphView ? 'secondary' : 'ghost'} aria-pressed={graphView}
            onClick={() => setParam('runsView', graphView ? null : 'graph')}
          >
            그래프에 모아 보기
          </Button>
        </div>
      </div>
      {/* WP-2157: 실행 수 조회 실패 — 숫자가 조용히 비지 않게 안내와 다시 불러오기를 둔다. 버전 기반 실행 수 실패가 먼저(겹치면 하나만). */}
      {(versionCountFailed || counts.isError) && (
        <span role="alert" className="block text-sm">
          실행 수를 불러오지 못했습니다. <Button variant="link" size="sm" onClick={versionCountFailed ? onRetryRunning : () => void counts.refetch()}>다시 불러오기</Button>
        </span>
      )}
      {graphView ? (
        <GraphBody model={model} activeVersionNo={activeVersionNo} isError={published.isError} onRetry={() => void published.refetch()} badges={counts.data?.counts}
          notice={olderNotice ?? null} onShowList={() => setParam('runsView', null)} />
      ) : (
        <div className="grid min-w-0 items-start gap-4 @3xl/runs:grid-cols-[300px_minmax(0,1fr)]">
          {/* WP-2053: 줄을 고르면 상세가 열렸음을 스크린리더에 알린다. 포커스는 옮기지 않는다(목록 탐색 유지). 영역은 늘 하나만 마운트.
              다른 워크플로우의 실행이면 상세가 그 안내(role=alert)를 보이므로 「열었습니다」는 알리지 않는다. */}
          <ResultStatus
            conditionKey={String(runId ?? '')} ready={runQuery.isSuccess && runQuery.data.run.workflowId === workflowId}
            text={runQuery.data ? runDetailOpenedText(runQuery.data.run.issueKey) : ''} testId="run-detail-status"
          />
          <div className="min-w-0 space-y-2 @3xl/runs:border-r">
            {runs.isError ? (
              <p role="alert" className="text-sm">
                실행 목록을 불러오지 못했습니다. <Button variant="link" size="sm" onClick={() => void invalidateRunListAndCounts(queryClient, workflowId)}>다시 불러오기</Button>
              </p>
            ) : runs.isPending ? (
              <p className="text-sm text-muted-foreground">실행을 불러오는 중…</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{hasFilter || tab !== 'ALL' ? '조건에 맞는 실행이 없습니다' : '아직 실행이 없습니다'}</p>
            ) : (
              <ul className="divide-y">
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

/** 목록 한 줄(WP-2157) — 상태 점+제목, 아래 회색 메타(이슈 키·지금 노드·담당·머문 시간). 사람 차례는 메타가 주황. 줄 전체가 단추다. */
function RunRow({ item, selected, onSelect }: { item: WorkflowRunItem; selected: boolean; onSelect: () => void }) {
  const meta = [item.issueKey, item.currentNodeName ?? item.currentNode, item.assignees.map((a) => a.name).join(', '), formatRelativeTime(item.enteredAt)]
    .filter(Boolean).join(' · ')
  return (
    <li>
      <button
        type="button" aria-current={selected || undefined} onClick={onSelect}
        className={'block w-full space-y-0.5 border-l-2 px-3 py-2 text-left text-sm hover:bg-muted/50 ' + (selected ? 'border-primary bg-muted' : 'border-transparent')}
      >
        <span className="flex items-center gap-2">
          <span className={'size-2 shrink-0 rounded-full ' + RUN_STATUS_DOT[item.status]} aria-hidden="true" />
          <span className="sr-only">{RUN_STATUS_LABEL[item.status]}</span>
          <span className="min-w-0 truncate font-medium">{item.title}</span>
        </span>
        <span className={'block truncate text-xs ' + (item.status === 'WAITING' ? 'text-warning-text' : 'text-muted-foreground')}>{meta}</span>
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
