// 내 작업 「내 차례」 탭(WP-1991) — 모든 프로젝트에서 내가 담당인 사람 노드를 오래 기다린 순으로 모아 보이고,
// 줄을 고르면 오른쪽(좁은 화면에서는 목록 아래) 패널에서 넘겨받은 내용을 보며 결과를 골라 바로 넘긴다.
// 줄을 고르기 전에는 그 자리에 「줄을 고르면 …」 안내를 보인다(WP-2050) — 빈 칸이면 무엇을 해야 할지 몰랐다.
// 왜: 흩어진 프로젝트를 돌지 않고 한곳에서 답하게 한다. 넘기면 목록 쪽이 다시 읽혀 그 줄이 빠지고, 패널 자리는 다시 안내로 돌아간다.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { EmptyState } from '@/components/layout/EmptyState'
import { ResultStatus } from '@/components/ResultStatus'
import { useMyWorkflowTurns } from '@/hooks/queries/useWorkflowRuns'
import { useAuth } from '@/hooks/useAuth'
import { focusRow } from '@/hooks/useListFocusRescue'
import { focusLost } from '@/hooks/useRestoreFocusOnExit'
import { issuePath } from '@/lib/appUrl'
import { formatRelativeTime } from '@/lib/formatters'
import { type MyWorkflowTurn, turnDetailOpenedText } from '@/lib/workflowRuns'
import { IssueWorkflowBanner } from '@/pages/projects/components/IssueWorkflowBanner'

/** 고른 줄의 패널 — 넘겨받은 내용(넘긴 사람·질문, 없으면 생략)과 결과 고르기 배너. 제목을 이름으로 가진 영역(region)이라 스크린리더가 상세 범위를 안다(WP-2053). */
function TurnPanel({ turn, meId }: { turn: MyWorkflowTurn; meId: number }) {
  const headingId = useId()
  // WP-2055: 넘긴 뒤 이 배너가 물러나도(담당이 남으로 바뀜) 초점이 body 로 떨어지지 않게 제목으로 옮긴다.
  const headingRef = useRef<HTMLHeadingElement>(null)
  // 배너 효과가 부모 렌더마다 다시 돌지 않도록 참조를 고정한다.
  // 제목은 탭 순서에 없으니 초점 받는 동안만 tabindex=-1 을 단다(focusRow — 늘 달면 빈 곳 클릭이 제목을 포커스한다).
  const focusHeading = useCallback(() => {
    if (headingRef.current) focusRow(headingRef.current)
  }, [])
  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-md border p-3 text-sm" data-testid="my-turn-panel">
      <h2 ref={headingRef} id={headingId} className="font-medium text-sm">{`${turn.issueKey} ${turn.title}`}</h2>
      {turn.handedBy && <p className="text-muted-foreground">{`${turn.handedBy.name} 님이 넘김`}</p>}
      {turn.question && <p>{`「${turn.question}」`}</p>}
      <IssueWorkflowBanner issueId={turn.issueId} projectKey={turn.projectKey} meId={meId} onLeave={focusHeading} />
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
  // WP-2055: 고른 줄이 목록에서 빠지면(넘겨서) 눌렀던 단추가 사라져 초점이 body 로 떨어진다 — 첫 줄 단추로, 목록이 비면 빈 상태로 옮긴다.
  // 줄을 고르지 않은 채 다른 줄이 빠지는 재조회에는 끼어들지 않도록, 직전 렌더에 고른 줄이 있었고 지금 없을 때만 처리한다.
  const listRef = useRef<HTMLUListElement>(null)
  const emptyRef = useRef<HTMLDivElement>(null)
  const hadSelectedRef = useRef(false)
  const hasSelected = selected !== null
  useEffect(() => {
    if (hadSelectedRef.current && !hasSelected) {
      // 초점을 잃었을 때(없음·body·연결 끊김)만 옮긴다 — 주기 재조회(WP-2042)로 남이 옮겨 빠진 때 사용자가 다른 곳(검색창 등)에 있으면 건드리지 않는다.
      const active = document.activeElement
      // 지워진 요소가 커밋 직후 activeElement 로 남을 수 있어 연결이 끊긴 것도 잃은 것으로 본다(useListFocusRescue 와 같다).
      // 목록 안의 다른 줄에 있는 사용자는 옮기지 않는다 — 내가 넘긴 경우 눌렀던 단추는 body·연결 끊김으로 이미 잃은 상태다.
      const lost = focusLost() || !active?.isConnected
      if (lost) {
        if (items.length === 0) {
          if (emptyRef.current) focusRow(emptyRef.current)
        } else listRef.current?.querySelector('button')?.focus()
      }
    }
    hadSelectedRef.current = hasSelected
    // items 는 길이만 쓰므로 길이로 의존한다 — 목록 객체가 바뀔 때마다 돌 필요가 없다.
  }, [hasSelected, items.length])

  if (turns.isPending) return <p className="text-sm text-muted-foreground">불러오는 중…</p>
  // 목록이 아직 없을 때만 전체 오류 — 주기 재조회(WP-2042)가 한 번 실패해도 v5 는 옛 data 를 두고 status 만 error 로 바꾸므로,
  // 그때 목록·열어 둔 패널을 오류 문구로 갈아치우지 않고 받아 둔 목록을 지킨다.
  if (turns.isError && !turns.data) return <p className="text-sm text-destructive">내 차례를 불러오지 못했습니다</p>
  if (items.length === 0) {
    // WP-2055: EmptyState 는 고치지 않고 감싼 요소가 초점을 받는다(보이는 문구 추가 없음).
    return (
      <div ref={emptyRef}>
        <EmptyState title="지금 내 차례인 일이 없습니다" description="워크플로우가 나에게 넘긴 일이 여기에 모입니다" />
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* WP-2053: 줄을 고르면 상세가 열렸음을 스크린리더에 알린다(포커스는 옮기지 않음). 영역은 늘 하나만 마운트. */}
      <ResultStatus
        conditionKey={String(selected?.runId ?? '')} ready={selected !== null && user != null}
        text={selected ? turnDetailOpenedText(selected.issueKey) : ''} testId="my-turn-status"
      />
      <ul ref={listRef} className="divide-y rounded-md border" data-testid="my-turn-list">
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
      {/* WP-2050: 고른 줄이 없으면 빈 칸 대신 안내 — 줄을 누르면 여기서 바로 답할 수 있다는 걸 알린다(실행 탭의 빈 상세와 같은 모양·톤, 문구는 이 탭에 맞춤). */}
      {/* 로그인 정보가 아직 없으면 패널을 못 그리니 빈 칸 대신 안내를 둔다. */}
      {selected && user
        ? <TurnPanel key={selected.runId} turn={selected} meId={user.id} />
        : <p className="text-sm text-muted-foreground" data-testid="my-turn-empty-detail">줄을 고르면 여기에서 넘겨받은 내용을 보고 바로 결과를 고를 수 있습니다.</p>}
    </div>
  )
}
