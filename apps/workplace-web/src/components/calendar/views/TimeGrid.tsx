// 주·작업주·일 뷰 공용 타임그리드 컴포넌트.
// WeekView(7일)·WorkWeekView(월~금 5일, WP-1815)·DayView(1일)가 동일한 레이아웃을 공유한다. 열은 days 길이만큼 flex-1 로 나뉜다.
import { format, isSameDay } from 'date-fns'
import { ko } from 'date-fns/locale'
import { type PointerEvent as ReactPointerEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { DeclinedTitle } from '@/components/calendar/declinedEvent'
import { ExtraTagDots } from '@/components/calendar/ExtraTagDots'
import { IssueDueChip } from '@/components/calendar/IssueDueChip'
import { NowLine } from '@/components/calendar/NowLine'
import { useMinuteNow } from '@/hooks/useMinuteNow'
import { DRAG_THRESHOLD_PX, dragSlotRange, eventDisplayColor, eventsOnDay, HOUR_SLOT_PX, hourOffset, HOURS, initialGridScrollTop, issueDuesOnDay, layoutTimedEvents, nowLineTop, timedEventBox, timedEventColumnStyle, timedSegmentLabel } from '@/lib/calendar'
import { isDeclinedByMe } from '@/lib/calendarEventView'
import { dayColumnLabel, defaultTimeSlot, nextTimeSlot, timeSlotLabel, type TimeSlotPos } from '@/lib/calendarGridNav'
import { type MovedRange, type ResizeEdge, resizeHandles, withRange } from '@/lib/calendarMove'
import { resolvePalette } from '@/lib/calendarPalette'
import { formatHourLabel24, formatLocalClockRange24, formatLocalMoveRange24 } from '@/lib/formatters'
import type { CalendarEvent, IssueDueMarker } from '@/types/calendar'

import { MovePreviewChip } from './MovePreviewChip'
import { isMovingEvent, useEventMoveDrag } from './useEventMoveDrag'

// ─────────────────────────────────────────────────────────────
// 공용 뷰 props (MonthView · AgendaView · WeekView · DayView 공통)
// ─────────────────────────────────────────────────────────────
export interface ViewProps {
  events: CalendarEvent[]
  // 내게 할당된 이슈 마감일 오버레이(읽기전용). 일정과 별도로 렌더링.
  issueDues: IssueDueMarker[]
  anchor: Date
  onSelectEvent: (e: CalendarEvent) => void
  onSelectIssue: (marker: IssueDueMarker) => void
  // end 는 주·작업주·일 보기에서 시간 구간을 끌어 고른 경우만(WP-949) — 없으면 기본 길이로 연다.
  onCreateAt: (start: Date, end?: Date) => void
  // 일정을 끌어 다른 날짜·시간에 놓았을 때(WP-1328) — 없으면 끌어 옮기기를 켜지 않는다(목록 보기 등).
  onMoveEvent?: (e: CalendarEvent, range: MovedRange) => void
  // 끌어 옮길 수 있는 일정인가(내 캘린더 + 읽기 전용 아님) — 아니면 눌러도 끌리지 않고 지금처럼 연다.
  canMoveEvent?: (e: CalendarEvent) => boolean
}

/** 늘이기 손잡이 순서 — 위(시작)·아래(종료) */
const RESIZE_EDGES: ResizeEdge[] = ['start', 'end']

// TimeGrid 전용 추가 props
interface TimeGridProps extends ViewProps {
  /** 표시할 날짜 목록 (주간: 7개, 작업주: 월~금 5개, 일간: 1개) */
  days: Date[]
  /** 루트 컨테이너 data-testid */
  testid: string
}

/** 끌고 있는 구간 — 어느 날 열에서(dayKey), 누른 y 와 지금 y(열 맨 위 기준 px). */
interface DragSelection {
  dayKey: string
  day: Date
  startY: number
  currentY: number
  moved: boolean
}

// ─────────────────────────────────────────────────────────────
// 타임그리드 컴포넌트
// ─────────────────────────────────────────────────────────────
export function TimeGrid({
  events,
  issueDues,
  onSelectEvent,
  onSelectIssue,
  onCreateAt,
  onMoveEvent,
  canMoveEvent,
  days,
  testid,
}: TimeGridProps) {
  // 일정 끌어 옮기기(WP-1328) — 종일 줄은 날짜 칸 사이(day), 시간 그리드는 날짜 열 + 30분 칸(grid).
  const move = useEventMoveDrag({ onMoveEvent, canMoveEvent })
  // 놓일 자리 미리보기용 사본 — 옮긴 시각으로 바꾼 일정을 같은 배치 함수(eventsOnDay·timedEventBox)로 그린다.
  const movedEvent = move.preview?.range ? withRange(move.preview.event, move.preview.range) : null
  // 시간 구간 끌어 만들기(WP-949) — 마우스·펜만. 터치는 세로 스크롤과 겹쳐 지금처럼 칸 탭(정각 + 1시간)만 둔다.
  const [drag, setDragState] = useState<DragSelection | null>(null)
  // 날짜별 타임드 일정 배치(겹침 열 나누기, WP-1138) — 끌기 중 포인터가 움직일 때마다 다시 그리므로 일정·날짜가 바뀔 때만 계산한다.
  // 부르는 쪽(주·작업주·일 보기)은 렌더마다 새 days 배열을 넘기므로 배열이 아니라 날짜 값으로 메모한다(WP-1154 — 배열 기준이면 끌기 중 매번
  // 다시 계산됐다). 블록 가로 위치·폭도 여기서 함께 만든다.
  const dayKey = days.map((d) => d.getTime()).join(',')
  const layoutsByDay = useMemo(
    () =>
      dayKey.split(',').map((t) => {
        const day = new Date(Number(t))
        return layoutTimedEvents(eventsOnDay(events, day).filter((e) => !e.allDay), day).map((l) => ({
          ...l,
          columnStyle: timedEventColumnStyle(l.lane, l.span, l.lanes),
        }))
      }),
    [events, dayKey],
  )
  // 날짜가 바뀔 때만 새 값이 되는 지금(WP-1557) — 「오늘」 배지와 현재 시각 선을 그을 열 판정이 화면을 열어 둔 채 자정을 넘겨도 따라간다.
  // 분 단위로 두면 그리드 전체가 1분마다 다시 그려져, 분마다 움직이는 선 위치는 GridNowLine 이 스스로 갱신한다.
  const { now } = useMinuteNow('day')
  // 로빙 tabIndex(WP-1906) — 시간 칸 168개 중 Tab 정지점은 초점 칸 하나. 기본은 오늘 열의 지금 시, 없으면 첫 열 오전 8시.
  // 고른 칸은 그때 보이던 날짜(dayKey)와 함께 둔다 — 날짜가 바뀌면 사라진 열을 가리키지 않게 기본값으로 읽는다(다시 set 하지 않음).
  // 기본값은 렌더마다 new Date() 가 아니라 useMinuteNow(날짜 단위) 값을 쓴다 — 시각이 흘러 Tab 정지점이 다른 칸으로 옮겨가지 않게(WP-1906 리뷰 후속 2).
  const [focusPick, setFocusPick] = useState<{ key: string; slot: TimeSlotPos } | null>(null)
  const focusSlot = focusPick?.key === dayKey ? focusPick.slot : defaultTimeSlot(days, now)
  const setFocusSlot = (slot: TimeSlotPos) => setFocusPick({ key: dayKey, slot })
  // 키보드 초점 링 표시 여부 — 칸 자체 outline 은 뒤 형제인 일정 블록(absolute)에 가려지므로, 열 안 오버레이로 그린다.
  // 마우스 클릭 초점에는 보이지 않게 칸이 :focus-visible 일 때만 켠다(상태는 focus/blur 이벤트로만 바꾼다).
  const [slotRingOn, setSlotRingOn] = useState(false)
  // 이벤트 처리기는 이 ref 의 최신 값을 읽는다 — 빠르게 튕기듯 끌면 다시 그리기 전에 pointerup 이 와서, 렌더 때 값(drag)으로는
  // 움직이지 않은 것으로 보고 정각 클릭으로 열 수 있었다. state 는 하이라이트를 그리는 데만 쓴다.
  const dragRef = useRef<DragSelection | null>(null)
  const setDrag = (next: DragSelection | null) => {
    dragRef.current = next
    setDragState(next)
  }
  // 끌기를 마친 직후 같은 제스처의 click 이 칸 클릭(정각 생성)으로 한 번 더 열지 않게 막는다.
  const suppressClickRef = useRef(false)
  // 시간 그리드 스크롤 요소 — 지금 시각 근처로 내려 두려고 잡는다(WP-1557).
  const gridScrollRef = useRef<HTMLDivElement>(null)
  // 처음 스크롤을 이미 정했는가 — 이후 날짜 변경 때는 오늘이 든 기간일 때만 다시 정한다.
  const scrollInitializedRef = useRef(false)
  // 스크롤 위치(WP-1557) — 늘 0시부터 보여 지금 시각을 찾아 내려야 했다. 오늘이 든 기간이면 지금보다 1시간 위, 아니면 오전 8시부터.
  // 마운트 때는 늘 정하고, 이후 보이는 날짜(dayKey)가 바뀌면 오늘이 든 기간으로 돌아왔을 때만(「오늘」·이전으로 이번 주 복귀) 다시 정해
  // 현재 시각 선이 보이게 한다. 오늘이 없는 기간으로 옮길 때는 사용자가 보던 위치를 지킨다. 셸이 lg 경계를 넘을 때는 dayKey 가
  // 그대로라 다시 정하지 않는다(WP-1488). 주↔일 전환은 다른 보기 컴포넌트라 다시 마운트되어 새로 정해진다.
  // 지금은 렌더 값(now, 날짜 단위라 시·분이 처음 읽은 때에 머문다) 대신 new Date() 로 읽는다 — 분까지 맞아야 선 근처로 간다.
  useLayoutEffect(() => {
    const el = gridScrollRef.current
    if (!el) return
    const current = new Date()
    const shown = dayKey.split(',').map((t) => new Date(Number(t)))
    if (!scrollInitializedRef.current || shown.some((d) => isSameDay(d, current))) {
      el.scrollTop = initialGridScrollTop(shown, current)
    }
    scrollInitializedRef.current = true
  }, [dayKey])

  const columnY = (ev: ReactPointerEvent<HTMLDivElement>) =>
    ev.clientY - ev.currentTarget.getBoundingClientRect().top

  const startDrag = (ev: ReactPointerEvent<HTMLDivElement>, day: Date) => {
    // 새 제스처마다 막음을 푼다 — 포인터를 붙잡은 끌기 뒤에는 click 이 오지 않을 수도 있어, 남은 막음이 다음 클릭을 삼키지 않게.
    suppressClickRef.current = false
    if (ev.pointerType === 'touch' || ev.button !== 0) return
    // 기존 일정(버튼) 위에서 누르면 그 일정을 여는 클릭이라 끌기를 시작하지 않는다.
    if ((ev.target as HTMLElement).closest('button')) return
    const y = columnY(ev)
    setDrag({ dayKey: day.toISOString(), day, startY: y, currentY: y, moved: false })
  }

  const moveDrag = (ev: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const y = columnY(ev)
    const moved = drag.moved || Math.abs(y - drag.startY) >= DRAG_THRESHOLD_PX
    // 끌기가 시작되면 포인터를 이 열에 붙잡는다 — 열 밖(다른 요일·그리드 밖)으로 끌어도 이 열의 구간으로 계속 받는다.
    // 누를 때 바로 붙잡으면 움직이지 않은 클릭이 시간 칸까지 가지 않아 칸 클릭(정각 생성)이 막혔다.
    if (moved && !drag.moved) ev.currentTarget.setPointerCapture(ev.pointerId)
    setDrag({ ...drag, currentY: y, moved })
  }

  const endDrag = () => {
    const drag = dragRef.current
    if (!drag) return
    setDrag(null)
    if (!drag.moved) return // 움직이지 않았으면 칸 클릭(onClick)이 처리한다.
    suppressClickRef.current = true
    const { start, end } = dragSlotRange(drag.day, drag.startY, drag.currentY)
    onCreateAt(start, end)
  }

  return (
    <div data-testid={testid} className="flex flex-col h-full overflow-hidden">
      {/* ── 날짜 헤더 ── */}
      <div className="flex border-b sticky top-0 bg-background z-10 shrink-0">
        {/* 거터 */}
        <div className="w-12 shrink-0" />
        {days.map((day) => {
          // 오늘 날짜 컬럼 강조 — 월간 뷰와 동일한 primary 원형 스타일 적용
          // 판정 기준은 날짜가 바뀔 때 새로 읽는 now — 현재 시각 선 열과 같은 기준이라 자정을 넘기면 함께 옮겨 간다(WP-1557).
          const todayCol = isSameDay(day, now)
          return (
            <div
              key={day.toISOString()}
              data-testid="calendar-day-header"
              className="flex-1 min-w-0 text-center text-sm py-2 font-medium border-l"
            >
              <span
                data-testid={todayCol ? 'calendar-today-badge' : undefined}
                // 고정 높이(h-7) 대신 최소 높이 — 모바일 주 보기처럼 좁은 열에서 「M.d (요일)」이 두 줄로 접히면
                // 배지가 글자만큼 늘어나야 위아래가 잘리지 않는다(WP-556). 한 줄일 때는 지금과 같은 28px 원형이다.
                className={
                  todayCol
                    ? 'inline-flex max-w-full min-h-7 items-center justify-center rounded-2xl bg-primary px-2 py-0.5 font-bold leading-tight text-primary-foreground'
                    : ''
                }
              >
                {format(day, 'M.d (EEE)', { locale: ko })}
              </span>
            </div>
          )
        })}
      </div>

      {/* ── 종일 이벤트 줄 ── */}
      <div className="flex border-b shrink-0">
        <div className="w-12 shrink-0 text-xs text-muted-foreground px-1 py-1 leading-5">종일</div>
        {days.map((day) => {
          // 종일은 eventsOnDay 공통 로직으로 매칭 — 캘린더 날짜 half-open 비교(다중일 종일은 걸친 날마다,
          // 동기화 UTC 자정 종일도 의도한 날에만). MonthView 와 동일 chokepoint.
          const allDayEvts = eventsOnDay(events, day).filter((e) => e.allDay)
          // 마감일은 날짜 단위라 종일 줄에 함께 표시.
          const dayDues = issueDuesOnDay(issueDues, day)
          return (
            // min-w-0: 줄바꿈 없는 긴 제목(truncate)이 flex 항목 최소 폭을 키우면 칸이 날짜 헤더 열과 어긋난다(WP-538).
            <div
              key={day.toISOString()}
              data-testid="calendar-allday-cell"
              role="group"
              aria-label={`${dayColumnLabel(day)} 종일`}
              data-move-day={format(day, 'yyyy-MM-dd')}
              data-move-kind="day"
              className="flex-1 min-w-0 border-l min-h-[28px] p-0.5 space-y-0.5 select-none"
            >
              {allDayEvts.map((e) => (
                <button
                  key={`${e.id}-${e.occurrenceDate ?? 'single'}`}
                  data-testid={`calendar-event-${e.occurrenceDate ? `${e.id}-${e.occurrenceDate}` : e.id}`}
                  {...move.bind(e, day, 'day')}
                  onClick={() => {
                    if (move.consumeClick()) return
                    onSelectEvent(e)
                  }}
                  className={`w-full text-left text-xs px-1 py-0.5 rounded ${resolvePalette(eventDisplayColor(e)).chipClass} truncate ${isDeclinedByMe(e) || isMovingEvent(move.preview, e) ? 'opacity-50' : ''}`}
                >
                  <ExtraTagDots event={e} />
                  {/* 거절한 일정(WP-2149)은 흐림 + 「거절」 배지 + 제목 취소선 */}
                  <DeclinedTitle declined={isDeclinedByMe(e)}>{e.title}</DeclinedTitle>
                </button>
              ))}
              {/* 끌어 옮기는 종일 일정이 놓일 날 — 반투명 사본(WP-1328) */}
              {movedEvent?.allDay && eventsOnDay([movedEvent], day).length > 0 && <MovePreviewChip preview={move.preview} />}
              {dayDues.map((m) => (
                <IssueDueChip key={m.issueId} marker={m} onSelect={onSelectIssue} />
              ))}
            </div>
          )
        })}
      </div>

      {/* ── 시간 그리드 ── 모바일(max-lg)은 본문 좌우 스와이프(WP-136)가 이 자체 스크롤 요소에서 pointercancel 로 끊기지 않게
          세로 패닝만 브라우저에 맡긴다(useIsMobile 과 같은 lg 기준).
          items-start: 기본 stretch 면 날짜 열이 스크롤 영역의 보이는 높이로만 늘어나 그 아래(16시 이후)에서
          세로 구분선(border-l)이 끊긴다 — 열 높이를 24시간 슬롯 내용 높이로 둔다(WP-544). */}
      <div ref={gridScrollRef} className="flex flex-1 items-start overflow-auto max-lg:touch-pan-y">
        {/* 시간 거터 */}
        <div className="w-12 shrink-0">
          {HOURS.map((h) => (
            <div
              key={h}
              className="h-12 text-xs text-muted-foreground text-right pr-2 pt-0.5"
            >
              {/* 캘린더 안 시각은 24시간 HH:mm 하나로(WP-1909) — 시를 2자리로 맞춘다. */}
              {formatHourLabel24(h)}
            </div>
          ))}
        </div>

        {/* 날짜별 컬럼 */}
        {days.map((day, dayIndex) => {
          // 열 이름과 그 열 시간 칸 24개 이름에 함께 쓴다 — 칸마다 날짜를 다시 format 하지 않게 열마다 한 번.
          const dayLabel = dayColumnLabel(day)
          return (
            <div
              key={day.toISOString()}
              data-testid="calendar-day-column"
              role="group"
              aria-label={dayLabel}
              data-move-day={format(day, 'yyyy-MM-dd')}
              data-move-kind="grid"
              className="flex-1 relative border-l select-none"
              onPointerDown={(ev) => startDrag(ev, day)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={() => setDrag(null)}
            >
              {/* 클릭 가능한 시간 슬롯 — 키보드로도 닿는 버튼 역할(WP-1906). 일정 블록 버튼은 이 칸의 자식이 아니라 형제라
                  블록에서 올라온 키가 칸 동작을 일으키지 않는다. */}
              {HOURS.map((h) => {
                // 클릭·Enter·Space 공통 — 해당 날 h시 정각으로 새 일정을 연다.
                const createAtHour = () => {
                  const d = new Date(day)
                  d.setHours(h, 0, 0, 0)
                  onCreateAt(d)
                }
                return (
                  <div
                    key={h}
                    // 방향키로 옮길 칸을 찾는 표식 — 칸마다 ref 콜백을 두면 끌기 중 pointermove 다시 그리기마다 168개가 떼었다 붙는다.
                    data-slot={`${dayIndex}-${h}`}
                    role="button"
                    aria-label={timeSlotLabel(dayLabel, h)}
                    tabIndex={focusSlot.dayIndex === dayIndex && focusSlot.hour === h ? 0 : -1}
                    className="h-12 border-b cursor-pointer hover:bg-muted/30 focus:outline-none"
                    onFocus={(ev) => {
                      // click 이 오지 않는 경로(끌어 만들기의 마우스다운 등)에서도 초점을 받은 칸이 로빙 초점 칸이 되게 한다 —
                      // 아니면 tabIndex=-1 칸이 초점만·로빙 표식은 다른 칸에 남아 초점 링이 어긋난다(WP-1906 리뷰 후속 1).
                      if (focusSlot.dayIndex !== dayIndex || focusSlot.hour !== h) {
                        setFocusSlot({ dayIndex, hour: h })
                      }
                      // 키보드 초점(:focus-visible)일 때만 링을 켠다. 지원하지 않는 환경이면 켜지 않는다.
                      try {
                        setSlotRingOn(ev.currentTarget.matches(':focus-visible'))
                      } catch {
                        setSlotRingOn(false)
                      }
                    }}
                    onBlur={() => setSlotRingOn(false)}
                    onKeyDown={(ev) => {
                      // 브라우저·OS 단축키(Alt+←: 뒤로 등)는 가로채지 않는다.
                      if (ev.altKey || ev.ctrlKey || ev.metaKey) return
                      if (ev.target !== ev.currentTarget) return
                      // 마우스로 눌러 초점이 온 칸(:focus-visible 아님)에서도 키를 쓰면 키보드 사용 중이니 링을 켠다.
                      setSlotRingOn(true)
                      const next = nextTimeSlot({ dayIndex, hour: h }, ev.key, days.length)
                      if (next) {
                        // 방향키가 스크롤 영역을 움직이지 않게 막고 초점만 옮긴다(끝에서는 그대로).
                        ev.preventDefault()
                        setFocusSlot(next)
                        const el = gridScrollRef.current?.querySelector<HTMLElement>(`[data-slot="${next.dayIndex}-${next.hour}"]`)
                        el?.focus()
                        el?.scrollIntoView?.({ block: 'nearest' })
                      } else if (ev.key === 'Enter' || ev.key === ' ') {
                        // Space 의 페이지 스크롤을 막고 클릭과 같은 정각 생성을 연다. 길게 누르면(ev.repeat) 매 키마다
                        // 되풀이되므로 반복 눌림도 막고 첫 눌림만 받는다(WP-1906 리뷰 후속 3).
                        ev.preventDefault()
                        if (ev.repeat) return
                        createAtHour()
                      }
                    }}
                    onClick={() => {
                      // 마우스로 눌러도 그 칸이 로빙 초점 칸이 된다.
                      setFocusSlot({ dayIndex, hour: h })
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false
                        return
                      }
                      // 일정을 끌어 옮긴 직후 칸으로 온 click 이면 새 일정을 열지 않는다(WP-1328).
                      if (move.consumeClick()) return
                      createAtHour()
                    }}
                  />
                )
              })}

              {/* 현재 시각 선 — 오늘 열에만(WP-1557). 포인터를 막지 않아 칸 클릭·끌어 만들기·일정 끌기가 그대로 동작한다. */}
              {isSameDay(day, now) && <GridNowLine />}

              {/* 끌고 있는 구간 하이라이트(WP-949) — 30분 칸에 맞춰 그리고 시작~종료 시각을 보인다. */}
              {drag?.moved && drag.dayKey === day.toISOString() && (
                <DragSelectionBox day={day} startY={drag.startY} currentY={drag.currentY} />
              )}

              {/* 절대 위치 타임드 이벤트 블록 — 그날에 걸친 구간만(자정 넘김은 날짜별로 잘림 — WP-539),
                  겹치는 일정은 열을 나눠 나란히 그린다(WP-1138). */}
              {layoutsByDay[dayIndex].map(({ event: e, top, height, columnStyle }) => {
                // 테두리 늘이기 손잡이(WP-1518) — 옮길 수 있는 일정만, 어느 조각에 둘지는 resizeHandles 가 정한다.
                const handles = onMoveEvent && (!canMoveEvent || canMoveEvent(e)) ? resizeHandles(e, day, height) : null
                const declined = isDeclinedByMe(e)
                return (
                  <button
                    key={`${e.id}-${e.occurrenceDate ?? 'single'}`}
                    data-testid={`calendar-event-${e.occurrenceDate ? `${e.id}-${e.occurrenceDate}` : e.id}`}
                    style={{
                      position: 'absolute',
                      top,
                      height,
                      // 겹친 묶음의 열 몫 안에서만 그린다 — 좁은 칸에서도 옆 날짜로 넘치지 않고, 오른쪽이 빈 일정은 넓힌다(WP-1154).
                      ...columnStyle,
                    }}
                    {...move.bind(e, day, 'grid')}
                    onClick={(ev) => {
                      ev.stopPropagation()
                      // 끌어 옮긴 직후의 click 이면 일정을 열지 않는다(WP-1328).
                      if (move.consumeClick()) return
                      onSelectEvent(e)
                    }}
                    className={`text-xs text-left rounded ${resolvePalette(eventDisplayColor(e)).chipClass} overflow-hidden ${declined || isMovingEvent(move.preview, e) ? 'opacity-50' : ''}`}
                  >
                    <ExtraTagDots event={e} />
                    {/* 거절한 일정(WP-2149)은 흐림 + 「거절」 배지 + 시각 라벨·제목 취소선 */}
                    {/* WP-1910: 여러 날 일정은 조각마다 그날에 맞는 라벨 — 24시간 HH:mm, 로컬 타임존(WP-1909) — (시작일 시작 시각·이어지는 날 M/d부터·마지막 날 ~끝 시각) */}
                    <DeclinedTitle declined={declined}>{timedSegmentLabel(e, day)} {e.title}</DeclinedTitle>
                    {handles &&
                      RESIZE_EDGES.filter((edge) => handles[edge]).map((edge) => (
                        <span
                          key={edge}
                          aria-hidden
                          data-resize-edge={edge}
                          data-testid={`calendar-event-resize-${edge}`}
                          className={`absolute inset-x-0 h-1.5 cursor-ns-resize ${edge === 'start' ? 'top-0' : 'bottom-0'}`}
                        />
                      ))}
                  </button>
                )
              })}

              {/* 키보드 초점 칸 링 — 일정 블록보다 위(z-[6])에 그려 블록에 가려지지 않게 하고, pointer-events-none 이라 블록 클릭을 빼앗지 않는다. */}
              {slotRingOn && focusSlot.dayIndex === dayIndex && (
                <div
                  data-testid="calendar-slot-focus-ring"
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 z-[6] ring-2 ring-inset ring-ring"
                  style={{ top: focusSlot.hour * HOUR_SLOT_PX, height: HOUR_SLOT_PX }}
                />
              )}

              {/* 끌어 옮기는 타임드 일정이 놓일 자리 — 그날에 걸친 구간만(WP-1328). 포인터 이벤트를 막지 않아 놓을 열을 가리지 않는다. */}
              {movedEvent && !movedEvent.allDay && eventsOnDay([movedEvent], day).length > 0 && (
                <div
                  data-testid="calendar-move-preview"
                  className="pointer-events-none absolute inset-x-0.5 z-10 overflow-hidden rounded border border-primary bg-primary/15 px-1 text-xs font-medium text-primary"
                  style={timedEventBox(movedEvent, day)}
                >
                  {/* 옮기기·늘이기 모두 놓이면 갈 시각 범위와 제목을 보인다(시각은 formatters 로만 그린다) */}
                  {/* 옮기기 미리보기도 24시간 HH:mm — 하루 안이면 자정 끝 24:00, 여러 날이면 양 끝에 날짜(WP-1909 리뷰 후속) */}
                  {formatLocalMoveRange24(new Date(movedEvent.startsAt), new Date(movedEvent.endsAt))} {movedEvent.title}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 시간 그리드의 현재 시각 선(WP-1557) — 모바일 일정 목록과 같은 공용 NowLine(빨간 선 + 왼쪽 점).
 * 1분마다 바뀌는 지금을 이 컴포넌트만 구독해 분마다 선만 다시 그린다(그리드 전체를 다시 그리지 않게).
 * 쌓임은 z-[5] — 일정 블록보다 위, 끌어 고른 구간·옮기기 미리보기(z-10)보다 아래. pointer-events-none 이라
 * 아래 칸·일정의 클릭·끌기를 가리지 않는다.
 */
function GridNowLine() {
  const { now } = useMinuteNow('minute')
  return (
    <NowLine
      testid="calendar-grid-now"
      className="pointer-events-none absolute left-0 right-0 z-[5]"
      style={{ top: nowLineTop(now) }}
    />
  )
}

/** 끌고 있는 시간 구간 — 30분 칸에 맞춘 위치·높이와 「10:00 – 11:30」 라벨. 포인터 이벤트를 막지 않는다. */
function DragSelectionBox({ day, startY, currentY }: { day: Date; startY: number; currentY: number }) {
  const { start, end } = dragSlotRange(day, startY, currentY)
  // 그날 0시 기준 위치 — 종료가 다음 날 0시(24:00)면 맨 아래.
  const toPx = (d: Date) =>
    (d.getDate() !== day.getDate() ? 24 : hourOffset(d)) * HOUR_SLOT_PX
  return (
    <div
      data-testid="calendar-drag-selection"
      className="pointer-events-none absolute inset-x-0.5 z-10 rounded border border-primary bg-primary/15 px-1 text-xs font-medium text-primary"
      style={{ top: toPx(start), height: toPx(end) - toPx(start) }}
    >
      {formatLocalClockRange24(start, end)}
    </div>
  )
}
