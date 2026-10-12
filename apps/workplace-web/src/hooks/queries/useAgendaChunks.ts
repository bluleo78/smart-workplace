// 모바일 캘린더 일정 목록(WP-136)의 무한 불러오기 — 시작일부터 30일 청크를 아래로 이어 조회하고 날짜별 묶음으로 합친다.
// 청크마다 기존 범위 조회와 같은 쿼리 옵션(calendarEventsQueryOptions·myIssueDuesQueryOptions)을 써서
// 캐시와 실시간 무효화(['calendar'] · ['my-issue-dues'] 접두)가 월·주·일 보기와 똑같이 동작한다.
// CalendarPage 가 무조건 호출하고(enabled 로 목록 보기일 때만 조회), 결과를 MobileAgendaView 에 넘기며
// loadedRange·count 는 AI 화면 컨텍스트에 그대로 싣는다.
import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import { startOfDay } from 'date-fns'
import { useCallback, useMemo, useState } from 'react'

import { agendaChunkRange, type AgendaDay, groupAgendaDays } from '@/lib/calendarAgenda'
import type { CalendarEvent, IssueDueMarker } from '@/types/calendar'

import { calendarEventsQueryOptions } from './useCalendarEvents'
import { myIssueDuesQueryOptions } from './useMyIssueDues'

// 최대 청크 수(30일 × 12 ≈ 1년). 넘으면 안내 없이 더 불러오지 않는다.
export const AGENDA_MAX_CHUNKS = 12

export interface AgendaChunksOptions {
  /** false 면 조회하지 않는다 — 목록 보기(모바일)가 아닐 때. */
  enabled: boolean
  /** 캘린더 표시 토글 필터(CalendarPage filterByCalendar). 참조가 바뀌면 묶음을 다시 계산하므로 useMemo 로 넘긴다. */
  filter: (e: CalendarEvent) => boolean
  /** 이슈 마감 레이어 — false 면 마감 조회 자체를 끈다(청크마다 요청이 늘어나므로). */
  showIssueDues: boolean
}

export interface AgendaChunks {
  /** 시작일(로컬 자정) — 이 날짜 이전 묶음은 버린다. */
  start: Date
  /** 불러온 청크 전체의 날짜별 묶음(필터·레이어 적용, 중복 제거 끝). */
  days: AgendaDay[]
  /** 불러온 범위의 표시 일정 수(묶음의 event 행 수 — 청크 경계 중복 제외). 일정 청크가 모두 성공하기 전엔 undefined(로딩 중 0건 오인 방지). */
  count: number | undefined
  /** 실제로 조회한 범위(ISO) — 첫 청크 시작 ~ 마지막 청크 끝. AI 화면 컨텍스트용. */
  loadedRange: { from: string; to: string }
  /** 첫 청크 데이터가 아직 없음 — 전체 스켈레톤. */
  isLoading: boolean
  /** 아직 데이터가 없는 청크가 있음(뒤 청크 첫 조회) — 목록 끝 스켈레톤 한 줄. */
  isLoadingMore: boolean
  /** 어느 청크든 조회 중이거나 데이터 없음(백그라운드 갱신 포함) — 센티널이 이 동안 다음 청크를 요청하지 않는다. */
  isFetching: boolean
  /** 일정 청크 실패 — 자동 불러오기를 멈추고 다시 시도 버튼을 보인다(마감 청크 실패는 무시 — 마감 행만 빠진다). */
  isError: boolean
  /** 더 불러올 청크가 있는지(최대 청크 수 미만). */
  hasMore: boolean
  /** 다음 청크 하나를 더한다(센티널이 호출). 참조 고정. */
  loadMore: () => void
  /** 실패한 청크만 다시 조회한다. */
  retry: () => void
  /** 청크를 1개로 되돌리고 맨 위로 스크롤하게 한다 — 시작일이 이미 오늘일 때 [오늘] 버튼용. 참조 고정. */
  reset: () => void
  /** 바뀌면 목록이 맨 위로 스크롤한다(시작일 변경 또는 reset). */
  scrollKey: string
}

// useQueries combine — 청크 결과를 하나로 요약한다. 모듈 스코프에 둬 참조가 고정되고,
// combine 결과는 구조 공유(replaceEqualDeep)라 값이 같으면 data 배열 참조가 유지돼 useMemo 의존성으로 바로 쓴다.
// refetch 는 관찰자별로 bind 된 고정 참조라 errored 배열도 같은 값이면 참조가 유지된다.
// 로딩 판정은 isLoading(=조회 중 && 데이터 없음)이 아니라 isPending(데이터 없음)으로 한다 — 꺼져 있던 쿼리가 켜진 첫 렌더는
// 아직 fetching 이 아니라서, isLoading 기준이면 한 프레임 빈 상태가 깜박이고 그 사이 센티널이 보여 다음 청크를 미리 요청했다.
function summarizeChunks<T>(rs: UseQueryResult<T[], Error>[]) {
  return {
    data: rs.flatMap((r) => r.data ?? []),
    firstPending: rs[0]?.isPending ?? false,
    anyPending: rs.some((r) => r.isPending),
    busy: rs.some((r) => r.isFetching || r.isPending),
    error: rs.some((r) => r.isError),
    allSuccess: rs.every((r) => r.isSuccess),
    erroredRefetch: rs.filter((r) => r.isError).map((r) => r.refetch),
  }
}

/** 모바일 목록 보기의 청크 조회. start 가 바뀌면(날짜 기준) 청크 수를 1로 되돌린다. */
export function useAgendaChunks(start: Date, { enabled, filter, showIssueDues }: AgendaChunksOptions): AgendaChunks {
  const startKey = startOfDay(start).getTime()
  // 청크 수 + 스크롤 초기화 세대(epoch). startKey 를 함께 들고 있다가 시작일이 바뀌면 렌더 중에 1로 되돌린다
  // (effect 로 되돌리면 한 번은 이전 청크 수로 새 시작일을 조회한다 — CalendarPage 의 suspendedId 와 같은 렌더 중 조정).
  const [chunks, setChunks] = useState({ startKey, count: 1, epoch: 0 })
  let count = chunks.count
  if (chunks.startKey !== startKey) {
    setChunks((s) => ({ startKey, count: 1, epoch: s.epoch }))
    count = 1
  }

  const loadMore = useCallback(
    () => setChunks((s) => ({ ...s, count: Math.min(s.count + 1, AGENDA_MAX_CHUNKS) })),
    [],
  )
  const reset = useCallback(() => setChunks((s) => ({ ...s, count: 1, epoch: s.epoch + 1 })), [])

  // 시작일 Date — startKey(숫자)로 고정해 같은 날이면 참조가 유지된다.
  const startDate = useMemo(() => new Date(startKey), [startKey])
  // 청크별 조회 범위 — 앞 청크 to == 다음 청크 from 으로 빈틈 없이 이어진다.
  const ranges = useMemo(
    () => Array.from({ length: count }, (_, i) => agendaChunkRange(startDate, i)),
    [startDate, count],
  )

  const events = useQueries({
    queries: ranges.map((r) => ({ ...calendarEventsQueryOptions(r.from, r.to), enabled })),
    combine: summarizeChunks<CalendarEvent>,
  })
  const dues = useQueries({
    queries: ranges.map((r) => ({ ...myIssueDuesQueryOptions(r.from, r.to), enabled: enabled && showIssueDues })),
    combine: summarizeChunks<IssueDueMarker>,
  })

  // 필터·레이어 적용 후 날짜별 묶음. 겹침 조회라 시작일 전에 시작한 일정도 섞여 오므로 from 으로 잘라낸다.
  const days = useMemo(
    () =>
      groupAgendaDays(events.data.filter(filter), showIssueDues ? dues.data : [], { from: startDate }),
    [events.data, dues.data, filter, showIssueDues, startDate],
  )

  // AI 화면 컨텍스트용 일정 수 — 마감 행은 일정이 아니므로 뺀다.
  const eventCount = useMemo(
    () => days.reduce((n, d) => n + d.items.filter((it) => it.kind === 'event').length, 0),
    [days],
  )

  const { erroredRefetch: eventsRetry } = events
  const { erroredRefetch: duesRetry } = dues
  const retry = useCallback(() => {
    for (const refetch of [...eventsRetry, ...duesRetry]) void refetch()
  }, [eventsRetry, duesRetry])

  return {
    start: startDate,
    days,
    count: events.allSuccess ? eventCount : undefined,
    loadedRange: { from: ranges[0].from, to: ranges[ranges.length - 1].to },
    // 마감 레이어가 꺼지면 마감 쿼리는 비활성(영원히 pending)이라 판정에서 뺀다.
    isLoading: enabled && (events.firstPending || (showIssueDues && dues.firstPending)),
    isLoadingMore: enabled && (events.anyPending || (showIssueDues && dues.anyPending)),
    isFetching: events.busy || (showIssueDues && dues.busy),
    // 일정 청크 실패만 멈춤 사유로 본다 — 이슈 마감은 다른 보기처럼 최선 노력 오버레이라, 마감 조회 실패로 일정 목록이 막히면 안 된다.
    // (실패한 마감 청크도 retry 가 함께 다시 받는다.)
    isError: events.error,
    hasMore: count < AGENDA_MAX_CHUNKS,
    loadMore,
    retry,
    reset,
    scrollKey: `${startKey}:${chunks.epoch}`,
  }
}
