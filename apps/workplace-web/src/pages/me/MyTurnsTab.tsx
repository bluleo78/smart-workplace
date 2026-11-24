// 내 작업 「내 차례」 탭(WP-1991) — 모든 프로젝트에서 내가 담당인 사람 노드를 오래 기다린 순으로 모아 보이고,
// 줄을 고르면 오른쪽 패널에서 넘겨받은 내용을 보며 결과를 골라 바로 넘긴다.
// 왜: 흩어진 프로젝트를 돌지 않고 한곳에서 답하게 한다. 넘기면 목록 쪽이 다시 읽혀 그 줄이 빠지고 패널이 닫힌다.
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'

import { EmptyState } from '@/components/layout/EmptyState'
import { ResultStatus } from '@/components/ResultStatus'
import { useMyWorkflowTurns } from '@/hooks/queries/useWorkflowRuns'
import { useAuth } from '@/hooks/useAuth'
import { issuePath } from '@/lib/appUrl'
import { formatRelativeTime } from '@/lib/formatters'
import { type MyWorkflowTurn, turnDetailOpenedText } from '@/lib/workflowRuns'
import { IssueWorkflowBanner } from '@/pages/projects/components/IssueWorkflowBanner'

/** 고른 줄의 패널 — 넘겨받은 내용(넘긴 사람·질문, 없으면 생략)과 결과 고르기 배너. 제목을 이름으로 가진 영역(region)이라 스크린리더가 상세 범위를 안다(WP-2053). */
function TurnPanel({ turn, meId }: { turn: MyWorkflowTurn; meId: number }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-md border p-3 text-sm" data-testid="my-turn-panel">
      <h2 id={headingId} className="font-medium text-sm">{`${turn.issueKey} ${turn.title}`}</h2>
      {turn.handedBy && <p className="text-muted-foreground">{`${turn.handedBy.name} 님이 넘김`}</p>}
      {turn.question && <p>{`「${turn.question}」`}</p>}
      <IssueWorkflowBanner issueId={turn.issueId} projectKey={turn.projectKey} meId={meId} />
    </section>
  )
}

export function MyTurnsTab() {
  const { user } = useAuth()
  const turns = useMyWorkflowTurns()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const items = turns.data ?? []
  // 고른 실행이 새 목록에 없으면(넘겨서 빠졌다) 선택을 푼다 — 상태를 따로 지우지 않고 파생해 깜빡임이 없다.
  const selected = items.find((t) => t.runId === selectedId) ?? null

  if (turns.isPending) return <p className="text-sm text-muted-foreground">불러오는 중…</p>
  if (turns.isError) return <p className="text-sm text-destructive">내 차례를 불러오지 못했습니다</p>
  if (items.length === 0) {
    return <EmptyState title="지금 내 차례인 일이 없습니다" description="워크플로우가 나에게 넘긴 일이 여기에 모입니다" />
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* WP-2053: 줄을 고르면 상세가 열렸음을 스크린리더에 알린다(포커스는 옮기지 않음). 영역은 늘 하나만 마운트. */}
      <ResultStatus
        conditionKey={String(selected?.runId ?? '')} ready={selected !== null && user != null}
        text={selected ? turnDetailOpenedText(selected.issueKey) : ''} testId="my-turn-status"
      />
      <ul className="divide-y rounded-md border" data-testid="my-turn-list">
        {items.map((t) => (
          <li
            key={t.runId}
            data-testid={`my-turn-row-${t.runId}`}
            className={`flex items-start gap-2 p-3 ${t.runId === selected?.runId ? 'bg-muted' : ''}`}
          >
            <button type="button" className="min-w-0 flex-1 space-y-0.5 text-left text-sm" onClick={() => setSelectedId(t.runId)}>
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{t.issueKey}</span>
                <span className="truncate font-medium">{t.title}</span>
              </span>
              <span className="block text-xs text-muted-foreground">{`${t.workflowName} · ${t.nodeName ?? t.nodeKey}`}</span>
              {t.question && <span className="block text-xs">{t.question}</span>}
              <span className="block text-xs text-muted-foreground">{formatRelativeTime(t.enteredAt)}</span>
            </button>
            <Link to={issuePath(t.projectKey, t.issueNumber)} className="shrink-0 text-xs text-primary hover:underline">
              열기
            </Link>
          </li>
        ))}
      </ul>
      {selected && user && <TurnPanel key={selected.runId} turn={selected} meId={user.id} />}
    </div>
  )
}
