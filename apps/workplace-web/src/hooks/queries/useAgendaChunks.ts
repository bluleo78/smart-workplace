// 모바일 캘린더 일정 목록(WP-136)의 무한 불러오기 — 시작일부터 30일 청크를 아래로 이어 조회하고 날짜별 묶음으로 합친다.
// 청크마다 기존 범위 조회와 같은 쿼리 옵션(calendarEventsQueryOptions·myIssueDuesQueryOptions)을 써서
// 캐시와 실시간 무효화(['calendar'] · ['my-issue-dues'] 접두)가 월·주·일 보기와 똑같이 동작한다.
// CalendarPage 가 무조건 호출하고(enabled 로 목록 보기일 때만 조회), 결과를 MobileAgendaView 에 넘기며
// loadedRange·count 는 AI 화면 컨텍스트에 그대로 싣는다.
import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import { format, startOfDay } from 'date-fns'
import { useCallback, useMemo, useState } from 'react'

import { useResetOnChange } from '@/hooks/useResetOnChange'
import { agendaChunkRange, type AgendaDay, agendaProgress, groupAgendaDays } from '@/lib/calendarAgenda'
import type { CalendarEvent, IssueDueMarker } from '@/types/calendar'

import { calendarEventsQueryOptions } from './useCalendarEvents'
import { myIssueDuesQueryOptions } from './useMyIssueDues'

// 최대 청크 수(30일 × 12 ≈ 1년). 넘으면 안내 없이 더 불러오지 않는다.
export const AGENDA_MAX_CHUNKS = 12
// 끝에서 연속으로 이만큼(90일) 빈 청크가 이어지면 자동 연쇄 불러오기를 멈추고 "다음 30일 더 보기" 버튼으로 넘긴다(WP-136).
// 일정이 없거나 드문 사용자가 목록을 열 때마다(그리고 실시간 무효화 때마다) 12청크·마감 포함 24요청을 쏘지 않게.
export const AGENDA_EMPTY_CHUNKS_TO_PAUSE = 3

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
  /** loadedRange 안의 표시 일정 수 — 성공한 청크가 없으면 undefined(로딩 중 0건 오인 방지). */
  count: number | undefined
  /** AI 화면 컨텍스트용 범위(ISO) — 첫 청크 시작 ~ 앞에서부터 연속 성공한 마지막 청크 끝(없으면 첫 청크). */
  loadedRange: { from: string; to: string }
  /** 앞에서부터 연속 성공한 일정 청크 수 — 빈 상태 문구("앞으로 N일간")용. */
  loadedChunks: number
  /** 첫 청크 데이터가 아직 없음 — 전체 스켈레톤. */
  isLoading: boolean
  /** 뒤 청크 첫 조회 중 — 목록 끝 "불러오는 중…". */
  isLoadingMore: boolean
  /** 어느 청크든 조회 중이거나 데이터 없음 — 센티널이 이 동안 다음 청크를 요청하지 않는다. */
  isFetching: boolean
  /** 일정 또는 (켜져 있으면) 마감 청크 실패 — 자동 불러오기를 멈추고 다시 시도 줄(받은 행은 그대로). */
  isError: boolean
  /** 더 불러올 청크가 있는지(최대 청크 수 미만). */
  hasMore: boolean
  /** 끝에서 빈 청크가 이어져 자동 연쇄를 멈춘 상태 — 센티널 대신 "다음 30일 더 보기" 버튼. */
  autoPaused: boolean
  /** 다음 청크 하나를 더한다 — 세대(scrollKey)에 묶여, 앞 세대에서 큐잉된 호출은 버려진다. */
  loadMore: () => void
  /** 실패한 청크만 다시 조회한다. */
  retry: () => void
  /** 청크를 1개로 되돌리고 맨 위로 스크롤하게 한다(시작일이 그대로일 때 [오늘]·보기 전환용). 참조 고정. */
  reset: () => void
  /** 세대 키 — 시작일 변경·reset 마다 바뀌고, 바뀌면 목록이 맨 위로 스크롤한다. */
  scrollKey: string
  /** 목록 맨 위에 보이는 날짜(헤더 월·자정 따라가기 판정용). 세대가 바뀌면 새 목록이 알려 올 때까지 null. */
  topDay: Date | null
  /** MobileAgendaView 가 맨 위 날짜를 알린다 — 앞 세대에 묶인 늦은 호출은 버려진다. */
  setTopDay: (day: Date | null) => void
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
    success: rs.map((r) => r.isSuccess),
    erroredRefetch: rs.filter((r) => r.isError).map((r) => r.refetch),
  }
}

/** 모바일 목록 보기의 청크 조회. start 가 바뀌면(날짜 기준)·reset 하면 청크 수를 1로 되돌린다. */
export function useAgendaChunks(start: Date, { enabled, filter, showIssueDues }: AgendaChunksOptions): AgendaChunks {
  const startKey = startOfDay(start).getTime()
  // 세대 = 시작일 + reset 횟수. 청크 수·맨 위 날짜는 세대에 묶여 바뀌는 렌더에서 곧바로 1·null 로 돌아가고(useResetOnChange),
  // 앞 세대 setter 로 늦게 온 쓰기(초기화 직전에 큐잉된 센티널 loadMore 등)는 버려진다 — 초기화 뒤 방금 버린 둘째 청크가 되살아나지 않게.
  const [epoch, setEpoch] = useState(0)
  const scrollKey = `${startKey}:${epoch}`
  const [count, setCount] = useResetOnChange(scrollKey, 1)
  const [topDay, setTopDay] = useResetOnChange<Date | null>(scrollKey, null)
  // 렌더 시점 count 로 쓴다 — 센티널은 렌더마다 새 loadMore 로 다시 붙으므로 늦어도 한 렌더 차이라 줄어드는 쓰기는 없다.
  const loadMore = useCallback(() => setCount(Math.min(count + 1, AGENDA_MAX_CHUNKS)), [count, setCount])
  const reset = useCallback(() => setEpoch((e) => e + 1), [])

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
  // 마감 조회는 to(다음 날 자정, 배타)를 날짜로 바꿔 dueTo 로 보내 그 날이 포함돼 올 수 있다 — 마지막 청크 끝 다음 날은
  // 일정은 없이 마감만 보이게 되므로(상한에 닿으면 영구히) 불러온 범위 끝 날짜 이전 마감만 남긴다. 쿼리 키는 그대로(캐시 공유).
  const endKey = format(new Date(ranges[ranges.length - 1].to), 'yyyy-MM-dd')
  const days = useMemo(
    () =>
      groupAgendaDays(
        events.data.filter(filter),
        showIssueDues ? dues.data.filter((m) => m.dueDate.slice(0, 10) < endKey) : [],
        { from: startDate },
      ),
    [events.data, dues.data, filter, showIssueDues, startDate, endKey],
  )

  // 청크별 진행 — 확정(settled) = 일정·마감(켜져 있으면) 모두 성공. 마감이 아직 오는 중인 청크를 "빈 청크"로 세지 않게.
  const { loadedChunks, eventCount, trailingEmpty } = useMemo(
    () =>
      agendaProgress(days, startDate, events.success, events.success.map((ok, i) => ok && (!showIssueDues || dues.success[i]))),
    [days, startDate, events.success, dues.success, showIssueDues],
  )
  const hasMore = count < AGENDA_MAX_CHUNKS

  const retry = useCallback(() => {
    for (const refetch of [...events.erroredRefetch, ...dues.erroredRefetch]) void refetch()
  }, [events.erroredRefetch, dues.erroredRefetch])

  return {
    start: startDate,
    days,
    count: loadedChunks > 0 ? eventCount : undefined,
    loadedRange: { from: ranges[0].from, to: ranges[Math.max(loadedChunks, 1) - 1].to },
    loadedChunks,
    // 마감 레이어가 꺼지면 마감 쿼리는 비활성(영원히 pending)이라 판정에서 뺀다.
    isLoading: enabled && (events.firstPending || (showIssueDues && dues.firstPending)),
    isLoadingMore: enabled && (events.anyPending || (showIssueDues && dues.anyPending)),
    isFetching: events.busy || (showIssueDues && dues.busy),
    // 마감 청크 실패도 멈춤·다시 시도 사유 — 숨기면 마감 행이 말없이 빠지고 되살릴 방법이 없다. 받은 일정 행은 막지 않는다.
    // retry 는 실패한 일정·마감 청크를 모두 다시 받는다.
    isError: events.error || (showIssueDues && dues.error),
    hasMore,
    autoPaused: hasMore && trailingEmpty >= AGENDA_EMPTY_CHUNKS_TO_PAUSE,
    loadMore,
    retry,
    reset,
    scrollKey,
    topDay,
    setTopDay,
  }
}
