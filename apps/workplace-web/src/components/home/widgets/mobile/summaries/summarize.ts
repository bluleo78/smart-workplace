// 모바일 요약 컴포넌트 공용 헬퍼(WP-142) — 요약마다 반복되던 "로딩이면 스켈레톤, 오류면 실패 문구" 분기와
// 캘린더 요약 2종(카탈로그·오늘 일정)의 다음 일정 계산을 한곳에 둔다. 훅 호출은 각 요약 컴포넌트 최상단에 그대로 두고
// (훅 규칙), 이 헬퍼는 그 결과만 받는다.
import type { ReactNode } from 'react'

import { useCalendarEvents } from '@/hooks/queries/useCalendarEvents'
import { resolveCalendarRange } from '@/lib/calendarRange'

import type { MobileSummaryData } from '../types'
import { pickNextEvent } from './summaryLogic'

/** 로딩·오류 판정에 쓰는 쿼리 상태(TanStack Query 결과의 부분집합). 조건부 쿼리는 호출부가 이 모양으로 맞춰 넘긴다. */
export interface SummaryQueryState {
  isLoading: boolean
  isError: boolean
}

/**
 * 요약 렌더 공통 틀 — 하나라도 로딩 중이면 loading, 아니면 하나라도 실패면 error, 둘 다 아니면 build() 결과.
 * 로딩을 오류보다 먼저 본다(기존 요약들의 분기 순서와 동일). build 는 준비된 데이터만 다루므로 안에서 훅을 부르지 않는다.
 */
export function summarize(
  render: (data: MobileSummaryData) => ReactNode,
  queries: SummaryQueryState[],
  build: () => MobileSummaryData,
): ReactNode {
  if (queries.some((q) => q.isLoading)) return render({ status: 'loading' })
  if (queries.some((q) => q.isError)) return render({ status: 'error' })
  return render(build())
}

/**
 * 캘린더 요약의 다음 일정 — 위젯과 같은 범위 계산(resolveCalendarRange)으로 같은 쿼리 키를 써 요청을 합치고,
 * 지금 이후 첫 일정(pickNextEvent)을 함께 돌려준다. params 없으면 오늘 하루(오늘 일정 본문과 같은 키).
 */
export function useNextCalendarEvent(params?: Record<string, unknown> | null) {
  const { from, to } = resolveCalendarRange(params)
  const query = useCalendarEvents(from, to)
  const events = query.data ?? []
  return { query, events, next: pickNextEvent(events, new Date()) }
}
