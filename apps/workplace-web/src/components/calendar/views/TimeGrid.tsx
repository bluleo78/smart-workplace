// 주/일 뷰 공용 타임그리드 컴포넌트.
// WeekView(7일)와 DayView(1일)가 동일한 레이아웃을 공유한다.
import { format, isToday } from 'date-fns'
import { ko } from 'date-fns/locale'

import { IssueDueChip } from '@/components/calendar/IssueDueChip'
import { eventsOnDay, HOURS, issueDuesOnDay, timedEventBox } from '@/lib/calendar'
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
  onCreateAt: (start: Date) => void
}

// TimeGrid 전용 추가 props
interface TimeGridProps extends ViewProps {
  /** 표시할 날짜 목록 (주간: 7개, 일간: 1개) */
  days: Date[]
  /** 루트 컨테이너 data-testid */
  testid: string
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
                  className={`w-full text-left text-xs px-1 py-0.5 rounded ${resolvePalette(e.effectiveColor).chipClass} truncate`}
                >
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
        {days.map((day) => {
          // 해당 날의 타임드(종일 아닌) 이벤트
          const timedEvts = eventsOnDay(events, day).filter((e) => !e.allDay)
          return (
            <div key={day.toISOString()} data-testid="calendar-day-column" className="flex-1 relative border-l">
              {/* 클릭 가능한 시간 슬롯 */}
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="h-12 border-b cursor-pointer hover:bg-muted/30"
                  onClick={() => {
                    // 해당 날 h시 정각으로 onCreateAt 호출
                    const d = new Date(day)
                    d.setHours(h, 0, 0, 0)
                    onCreateAt(d)
                  }}
                />
              ))}

              {/* 절대 위치 타임드 이벤트 블록 */}
              {timedEvts.map((e) => {
                // 그날에 걸친 구간만(자정 넘김은 날짜별로 잘림 — WP-539)
                const style = timedEventBox(e, day)
                return (
                  <button
                    key={`${e.id}-${e.occurrenceDate ?? 'single'}`}
                    data-testid={`calendar-event-${e.occurrenceDate ? `${e.id}-${e.occurrenceDate}` : e.id}`}
                    style={{ position: 'absolute', top: style.top, height: style.height, left: 2, right: 2 }}
                    onClick={(ev) => {
                      ev.stopPropagation()
                      onSelectEvent(e)
                    }}
                    className={`text-xs text-left px-1 rounded ${resolvePalette(e.effectiveColor).chipClass} overflow-hidden`}
                  >
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
