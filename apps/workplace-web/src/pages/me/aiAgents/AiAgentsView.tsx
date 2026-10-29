// AI 위임 작업 「AI별」 보기 본문(WP-1201) — 툴바(범위·보기) + 상태별 칩 + AI 명단(데스크톱 표 / 모바일 카드).
// 범위(나와 관련·전체)는 이슈별 보기와 같은 URL 값(scope)을, 상태 필터는 roster 값을 쓴다.
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { ListLoadingSkeleton } from '@/components/issue/ListLoadingSkeleton'
import { LoadErrorState } from '@/components/LoadErrorState'
import { useAiAgents } from '@/hooks/queries/useAiAgents'
import { useIsMobile } from '@/hooks/useIsMobile'
import { parseRosterState, ROSTER_LABEL, rosterCounts, rosterRows, type RosterState } from '@/lib/aiRoster'
import { buildAiAgentsContext } from '@/lib/aiScreenContext/builders/issue'
import { failedWithoutData } from '@/lib/queryFailure'

import { AiTasksToolbar } from '../aiTasks/AiTasksToolbar'
import { AiRosterChips, AiRosterMobileList, AiRosterTable } from './AiRoster'

export function AiAgentsView({ scope }: { scope: 'mine' | 'all' }) {
  const [params, setParams] = useSearchParams()
  const filter = parseRosterState(params.get('roster'))
  const query = useAiAgents(scope === 'all' ? 'ALL' : 'MINE')
  const isMobile = useIsMobile()

  // AI 마다 판정은 여기서 한 번 — 정렬·건수·거르기·그리기는 모두 이 결과를 읽는다.
  const rows = useMemo(() => rosterRows(query.data?.agents ?? []), [query.data])
  const counts = useMemo(() => (query.data ? rosterCounts(rows) : undefined), [query.data, rows])
  const shown = useMemo(() => (filter ? rows.filter((r) => r.state === filter) : rows), [rows, filter])
  // 「n분째」 기준 시각 — 다시 받을 때(30초)마다 새로 그려지므로 렌더 시각이면 충분하다.
  // eslint-disable-next-line react-hooks/purity -- 경과 시간 표시는 렌더 시각 기준이 맞다(30초 갱신마다 다시 그림)
  const now = Date.now()

  // WP-54: AI 화면 컨텍스트 — 보기·범위·켜진 상태 칩 + 보이는 AI 수(받기 전·이전 범위의 자리채움 값이면 생략).
  const visibleCount = query.data && !query.isPlaceholderData ? shown.length : undefined
  const rosterLabel = filter ? ROSTER_LABEL[filter] : null
  useRegisterAiScreenContext(
    useMemo(() => buildAiAgentsContext({ scope, rosterLabel, count: visibleCount }), [scope, rosterLabel, visibleCount]),
  )

  const setFilter = (s: RosterState | null) => {
    const next = new URLSearchParams(params)
    if (s) next.set('roster', s)
    else next.delete('roster')
    setParams(next, { replace: true })
  }

  const limit = query.data?.slotLimit ?? 3
  return (
    <>
      <AiTasksToolbar view="agents" scope={scope} />
      {failedWithoutData(query) ? (
        <LoadErrorState
          title="AI 현황을 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
          queries={[query]}
          testId="ai-agents-error"
        />
      ) : query.isLoading ? (
        <ListLoadingSkeleton label="AI 현황 불러오는 중" />
      ) : (
        <>
          <AiRosterChips state={filter} counts={counts} onChange={setFilter} />
          {shown.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground" data-testid="ai-agents-empty">
              {filter
                ? '이 상태의 AI 가 없습니다.'
                : scope === 'mine'
                  ? '내 관련 이슈를 진행 중인 AI 가 없습니다. 「전체」에서 모든 AI 를 볼 수 있습니다.'
                  : 'AI 구성원이 없습니다.'}
            </p>
          ) : isMobile ? (
            <AiRosterMobileList rows={shown} limit={limit} now={now} />
          ) : (
            <AiRosterTable rows={shown} limit={limit} now={now} />
          )}
        </>
      )}
    </>
  )
}
