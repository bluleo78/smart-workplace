// 목록(어젠다) 뷰 — 일정과 이슈 마감일을 날짜 오름차순으로 한 줄씩 나열한다.
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { Flag } from 'lucide-react'

import { eventDisplayColor } from '@/lib/calendar'
import { eventDate } from '@/lib/calendarAgenda'
import { resolvePalette } from '@/lib/calendarPalette'
import { formatLocalClockTime24 } from '@/lib/formatters'
import type { CalendarEvent, IssueDueMarker } from '@/types/calendar'

import type { ViewProps } from './TimeGrid'

// 정렬용 통합 행 — 일정(event) 또는 이슈 마감(due)을 시각(sortKey)으로 묶는다.
type Row =
  | { kind: 'event'; sortKey: number; event: CalendarEvent }
  | { kind: 'due'; sortKey: number; marker: IssueDueMarker }

// 목록 뷰 컴포넌트
export function AgendaView({ events, issueDues, onSelectEvent, onSelectIssue }: ViewProps) {
  // 일정은 startsAt(종일은 복원 날짜), 마감은 dueDate(자정) 기준으로 한데 모아 오름차순 정렬.
  const rows: Row[] = [
    ...events.map<Row>((e) => ({ kind: 'event', sortKey: eventDate(e).getTime(), event: e })),
    ...issueDues.map<Row>((m) => ({
      kind: 'due',
      sortKey: new Date(`${m.dueDate.slice(0, 10)}T00:00:00`).getTime(),
      marker: m,
    })),
  ].sort((a, b) => a.sortKey - b.sortKey)

  return (
    // 루트가 스스로 세로 스크롤한다(WP-1662) — 부모(페이지 본문)가 고정 높이에 overflow-hidden 으로 잘라 내므로,
    // 높이 제한 없이 행 전체만큼 늘어나면 화면 아래 일정에 닿을 수 없다. 모바일 목록(MobileAgendaView) 루트와 같은 방식 —
    // flex-1 로 남은 높이만 차지해(오류 띠가 위에 떠도) min-h-0 로 줄어들 수 있게 하고 넘치는 만큼 스스로 스크롤한다.
    <div data-testid="calendar-view-agenda" className="flex min-h-0 flex-1 flex-col divide-y overflow-y-auto">
      {rows.length === 0 ? (
        // 빈 상태
        <div className="text-center text-muted-foreground py-12">일정이 없습니다</div>
      ) : (
        rows.map((row) =>
          row.kind === 'event' ? (
            <button
              key={`e-${row.event.id}-${row.event.occurrenceDate ?? 'single'}`}
              data-testid={`calendar-event-${row.event.occurrenceDate ? `${row.event.id}-${row.event.occurrenceDate}` : row.event.id}`}
              onClick={() => onSelectEvent(row.event)}
              className="flex gap-4 px-4 py-3 text-left hover:bg-muted/50 w-full"
            >
              {/* 날짜 */}
              <span className="text-sm text-muted-foreground w-28 shrink-0">
                {format(eventDate(row.event), 'M.d (EEE)', { locale: ko })}
              </span>
              {/* 시간 — 종일 이벤트는 '종일' 표시. 캘린더 안 시각은 24시간 HH:mm 하나로(WP-1909) */}
              <span className="text-sm text-muted-foreground w-16 shrink-0">
                {row.event.allDay ? '종일' : formatLocalClockTime24(row.event.startsAt)}
              </span>
              {/* 색 점 — effectiveColor 기반 */}
              <span
                className={`size-2 rounded-full shrink-0 self-center ${resolvePalette(eventDisplayColor(row.event)).dotClass}`}
                aria-hidden="true"
              />
              {/* 제목 */}
              <span className="text-sm font-medium">{row.event.title}</span>
            </button>
          ) : (
            <button
              key={`d-${row.marker.issueId}`}
              data-testid={`calendar-issue-due-${row.marker.issueId}`}
              onClick={() => onSelectIssue(row.marker)}
              className="flex gap-4 px-4 py-3 text-left hover:bg-muted/50 w-full"
            >
              {/* 날짜 */}
              <span className="text-sm text-muted-foreground w-28 shrink-0">
                {format(new Date(`${row.marker.dueDate.slice(0, 10)}T00:00:00`), 'M.d (EEE)', { locale: ko })}
              </span>
              {/* 이슈 마감 표식 — 일정과 구분 */}
              <span className="text-sm text-muted-foreground w-16 shrink-0">마감</span>
              {/* 제목 + 깃발 아이콘 */}
              <span className="flex items-center gap-1 text-sm font-medium">
                <Flag className="size-3 shrink-0 text-primary" aria-hidden="true" />
                {row.marker.projectKey}-{row.marker.number} {row.marker.title}
              </span>
            </button>
          ),
        )
      )}
    </div>
  )
}
