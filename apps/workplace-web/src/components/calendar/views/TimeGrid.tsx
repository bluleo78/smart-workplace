// 주/일 뷰 공용 타임그리드 컴포넌트.
// WeekView(7일)와 DayView(1일)가 동일한 레이아웃을 공유한다.
import { format, isToday } from 'date-fns'
import { ko } from 'date-fns/locale'
import { type PointerEvent as ReactPointerEvent, useMemo, useRef, useState } from 'react'

import { ExtraTagDots } from '@/components/calendar/ExtraTagDots'
import { IssueDueChip } from '@/components/calendar/IssueDueChip'
import { dragSlotRange, eventDisplayColor, eventsOnDay, HOUR_SLOT_PX, HOURS, issueDuesOnDay, layoutTimedEvents } from '@/lib/calendar'
import { resolvePalette } from '@/lib/calendarPalette'
import { formatClockTimePadded } from '@/lib/formatters'
import type { CalendarEvent, IssueDueMarker } from '@/types/calendar'

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
  // end 는 주·일 보기에서 시간 구간을 끌어 고른 경우만(WP-949) — 없으면 기본 길이로 연다.
  onCreateAt: (start: Date, end?: Date) => void
}

// TimeGrid 전용 추가 props
interface TimeGridProps extends ViewProps {
  /** 표시할 날짜 목록 (주간: 7개, 일간: 1개) */
  days: Date[]
  /** 루트 컨테이너 data-testid */
  testid: string
}

// 끌기로 보는 최소 이동(px) — 이보다 덜 움직이고 놓으면 지금처럼 한 칸 클릭(정각 + 1시간)으로 둔다.
const DRAG_THRESHOLD_PX = 4

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
  days,
  testid,
}: TimeGridProps) {
  // 시간 구간 끌어 만들기(WP-949) — 마우스·펜만. 터치는 세로 스크롤과 겹쳐 지금처럼 칸 탭(정각 + 1시간)만 둔다.
  const [drag, setDragState] = useState<DragSelection | null>(null)
  // 날짜별 타임드 일정 배치(겹침 열 나누기, WP-1138) — 끌기 중 포인터가 움직일 때마다 다시 그리므로 일정·날짜가 바뀔 때만 계산한다.
  const layoutsByDay = useMemo(
    () => days.map((day) => layoutTimedEvents(eventsOnDay(events, day).filter((e) => !e.allDay), day)),
    [events, days],
  )
  // 이벤트 처리기는 이 ref 의 최신 값을 읽는다 — 빠르게 튕기듯 끌면 다시 그리기 전에 pointerup 이 와서, 렌더 때 값(drag)으로는
  // 움직이지 않은 것으로 보고 정각 클릭으로 열 수 있었다. state 는 하이라이트를 그리는 데만 쓴다.
  const dragRef = useRef<DragSelection | null>(null)
  const setDrag = (next: DragSelection | null) => {
    dragRef.current = next
    setDragState(next)
  }
  // 끌기를 마친 직후 같은 제스처의 click 이 칸 클릭(정각 생성)으로 한 번 더 열지 않게 막는다.
  const suppressClickRef = useRef(false)

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
          const todayCol = isToday(day)
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
              className="flex-1 min-w-0 border-l min-h-[28px] p-0.5 space-y-0.5"
            >
              {allDayEvts.map((e) => (
                <button
                  key={`${e.id}-${e.occurrenceDate ?? 'single'}`}
                  data-testid={`calendar-event-${e.occurrenceDate ? `${e.id}-${e.occurrenceDate}` : e.id}`}
                  onClick={() => onSelectEvent(e)}
                  className={`w-full text-left text-xs px-1 py-0.5 rounded ${resolvePalette(eventDisplayColor(e)).chipClass} truncate`}
                >
                  <ExtraTagDots event={e} />
                  {e.title}
                </button>
              ))}
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
      <div className="flex flex-1 items-start overflow-auto max-lg:touch-pan-y">
        {/* 시간 거터 */}
        <div className="w-12 shrink-0">
          {HOURS.map((h) => (
            <div
              key={h}
              className="h-12 text-xs text-muted-foreground text-right pr-2 pt-0.5"
            >
              {h}:00
            </div>
          ))}
        </div>

        {/* 날짜별 컬럼 */}
        {days.map((day, dayIndex) => {
          return (
            <div
              key={day.toISOString()}
              data-testid="calendar-day-column"
              className="flex-1 relative border-l select-none"
              onPointerDown={(ev) => startDrag(ev, day)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={() => setDrag(null)}
            >
              {/* 클릭 가능한 시간 슬롯 */}
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="h-12 border-b cursor-pointer hover:bg-muted/30"
                  onClick={() => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false
                      return
                    }
                    // 해당 날 h시 정각으로 onCreateAt 호출
                    const d = new Date(day)
                    d.setHours(h, 0, 0, 0)
                    onCreateAt(d)
                  }}
                />
              ))}

              {/* 끌고 있는 구간 하이라이트(WP-949) — 30분 칸에 맞춰 그리고 시작~종료 시각을 보인다. */}
              {drag?.moved && drag.dayKey === day.toISOString() && (
                <DragSelectionBox day={day} startY={drag.startY} currentY={drag.currentY} />
              )}

              {/* 절대 위치 타임드 이벤트 블록 — 그날에 걸친 구간만(자정 넘김은 날짜별로 잘림 — WP-539),
                  겹치는 일정은 열을 나눠 나란히 그린다(WP-1138). */}
              {layoutsByDay[dayIndex].map(({ event: e, top, height, lane, lanes }) => {
                return (
                  <button
                    key={`${e.id}-${e.occurrenceDate ?? 'single'}`}
                    data-testid={`calendar-event-${e.occurrenceDate ? `${e.id}-${e.occurrenceDate}` : e.id}`}
                    style={{
                      position: 'absolute',
                      top,
                      height,
                      left: `calc(${(lane / lanes) * 100}% + 2px)`,
                      // 좁은 모바일 열에 겹침이 많아도 블록이 0 이하로 사라지지 않게 최소 폭을 둔다.
                      width: `max(calc(${100 / lanes}% - 4px), 4px)`,
                    }}
                    onClick={(ev) => {
                      ev.stopPropagation()
                      onSelectEvent(e)
                    }}
                    className={`text-xs text-left px-1 rounded ${resolvePalette(eventDisplayColor(e)).chipClass} overflow-hidden`}
                  >
                    <ExtraTagDots event={e} />
                    {formatClockTimePadded(e.startsAt)} {e.title}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 끌고 있는 시간 구간 — 30분 칸에 맞춘 위치·높이와 「10:00 – 11:30」 라벨. 포인터 이벤트를 막지 않는다. */
function DragSelectionBox({ day, startY, currentY }: { day: Date; startY: number; currentY: number }) {
  const { start, end } = dragSlotRange(day, startY, currentY)
  // 그날 0시 기준 위치 — 종료가 다음 날 0시(24:00)면 맨 아래.
  const toPx = (d: Date) =>
    (d.getDate() !== day.getDate() ? 24 : d.getHours() + d.getMinutes() / 60) * HOUR_SLOT_PX
  return (
    <div
      data-testid="calendar-drag-selection"
      className="pointer-events-none absolute inset-x-0.5 z-10 rounded border border-primary bg-primary/15 px-1 text-xs font-medium text-primary"
      style={{ top: toPx(start), height: toPx(end) - toPx(start) }}
    >
      {format(start, 'HH:mm')} – {format(end, 'HH:mm')}
    </div>
  )
}
