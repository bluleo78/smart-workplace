// 주/일 뷰 공용 타임그리드 컴포넌트.
// WeekView(7일)와 DayView(1일)가 동일한 레이아웃을 공유한다.
import { format, isSameDay, isToday } from 'date-fns'
import { ko } from 'date-fns/locale'

import { IssueDueChip } from '@/components/calendar/IssueDueChip'
import { eventsOnDay, hhmm, HOURS, issueDuesOnDay } from '@/lib/calendar'
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

// 타임드 이벤트의 top / height (시간 슬롯 1칸 = 48px)
function eventStyle(event: CalendarEvent): { top: number; height: number } {
  const start = new Date(event.startsAt)
  const end = new Date(event.endsAt)
  const startHour = start.getHours() + start.getMinutes() / 60
  const endHour = end.getHours() + end.getMinutes() / 60
  return {
    top: startHour * 48,
    height: Math.max((endHour - startHour) * 48, 16), // 최소 16px
  }
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
              className="flex-1 text-center text-sm py-2 font-medium border-l"
            >
              <span
                className={
                  todayCol
                    ? 'inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground px-2 h-7 font-bold'
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
          const allDayEvts = events.filter(
            (e) => e.allDay && isSameDay(new Date(e.startsAt), day),
          )
          // 마감일은 날짜 단위라 종일 줄에 함께 표시.
          const dayDues = issueDuesOnDay(issueDues, day)
          return (
            <div
              key={day.toISOString()}
              className="flex-1 border-l min-h-[28px] p-0.5 space-y-0.5"
            >
              {allDayEvts.map((e) => (
                <button
                  key={`${e.id}-${e.occurrenceDate ?? 'single'}`}
                  data-testid={`calendar-event-${e.occurrenceDate ? `${e.id}-${e.occurrenceDate}` : e.id}`}
                  onClick={() => onSelectEvent(e)}
                  className="w-full text-left text-xs px-1 py-0.5 rounded bg-primary text-primary-foreground truncate"
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

      {/* ── 시간 그리드 ── */}
      <div className="flex flex-1 overflow-auto">
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
            <div key={day.toISOString()} className="flex-1 relative border-l">
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
                const style = eventStyle(e)
                return (
                  <button
                    key={`${e.id}-${e.occurrenceDate ?? 'single'}`}
                    data-testid={`calendar-event-${e.occurrenceDate ? `${e.id}-${e.occurrenceDate}` : e.id}`}
                    style={{ position: 'absolute', top: style.top, height: style.height, left: 2, right: 2 }}
                    onClick={(ev) => {
                      ev.stopPropagation()
                      onSelectEvent(e)
                    }}
                    className="text-xs text-left px-1 rounded bg-primary text-primary-foreground overflow-hidden"
                  >
                    {hhmm(e.startsAt)} {e.title}
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
