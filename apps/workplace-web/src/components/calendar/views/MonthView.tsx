// 월간 뷰 — 7열 × 6행(42칸) 달력 그리드.
// monthMatrix()로 일요일 시작 6주를 생성한다.
import { format, isSameMonth, isToday } from 'date-fns'

import { IssueDueChip } from '@/components/calendar/IssueDueChip'
import { eventsOnDay, issueDuesOnDay, monthMatrix } from '@/lib/calendar'

import type { ViewProps } from './TimeGrid'

// 요일 헤더 (일~토)
const WEEK_DAYS = ['일', '월', '화', '수', '목', '금', '토']

// 월간 뷰 컴포넌트
export function MonthView({ events, issueDues, anchor, onSelectEvent, onSelectIssue, onCreateAt }: ViewProps) {
  // anchor 기준 42칸 날짜 배열
  const cells = monthMatrix(anchor)

  return (
    <div data-testid="calendar-view-month" className="flex flex-col h-full">
      {/* ── 요일 헤더 ── */}
      <div className="grid grid-cols-7 border-b shrink-0">
        {WEEK_DAYS.map((d) => (
          <div key={d} className="text-center text-xs font-medium py-2 text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      {/* ── 6행 × 7열 날짜 셀 ── */}
      <div className="grid grid-cols-7 flex-1" style={{ gridTemplateRows: 'repeat(6, 1fr)' }}>
        {cells.map((day) => {
          const dateLabel = format(day, 'yyyy-MM-dd')
          const dayEvents = eventsOnDay(events, day)
          // 최대 3개만 표시, 나머지는 오버플로 표시
          const visible = dayEvents.slice(0, 3)
          const overflow = dayEvents.length - visible.length
          // 해당 날 마감 이슈 마커(읽기전용 오버레이)
          const dayDues = issueDuesOnDay(issueDues, day)
          const inMonth = isSameMonth(day, anchor)
          const today = isToday(day)

          return (
            <div
              key={dateLabel}
              data-testid={`calendar-cell-${dateLabel}`}
              onClick={() => onCreateAt(day)}
              className={`border-b border-r p-1 cursor-pointer overflow-hidden ${
                inMonth ? '' : 'bg-muted/30'
              }`}
            >
              {/* 날짜 숫자 — 오늘은 primary 원형 강조 */}
              <div
                className={`text-xs mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                  today
                    ? 'bg-primary text-primary-foreground font-bold'
                    : inMonth
                      ? ''
                      : 'text-muted-foreground'
                }`}
              >
                {format(day, 'd')}
              </div>

              {/* 이벤트 칩 (최대 3개) */}
              {visible.map((e) => (
                <button
                  key={e.id}
                  data-testid={`calendar-event-${e.id}`}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    onSelectEvent(e)
                  }}
                  className="w-full text-left text-xs px-1 py-0.5 mb-0.5 rounded bg-primary text-primary-foreground truncate block"
                >
                  {e.title}
                </button>
              ))}

              {/* +N 오버플로 표시 */}
              {overflow > 0 && (
                <div className="text-xs text-muted-foreground pl-1">+{overflow}</div>
              )}

              {/* 이슈 마감일 칩 (읽기전용, 일정과 구분) */}
              {dayDues.map((m) => (
                <div key={m.issueId} className="mb-0.5">
                  <IssueDueChip marker={m} onSelect={onSelectIssue} />
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
