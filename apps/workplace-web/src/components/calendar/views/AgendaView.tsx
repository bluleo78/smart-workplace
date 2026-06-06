// 목록(어젠다) 뷰 — 일정을 startsAt 기준 오름차순으로 나열한다.
import { format } from 'date-fns'

import { hhmm } from '@/lib/calendar'

import type { ViewProps } from './TimeGrid'

// 목록 뷰 컴포넌트
export function AgendaView({ events, onSelectEvent }: ViewProps) {
  // startsAt 기준 오름차순 정렬 (원본 배열 불변)
  const sorted = [...events].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  )

  return (
    <div data-testid="calendar-view-agenda" className="flex flex-col divide-y">
      {sorted.length === 0 ? (
        // 빈 상태
        <div className="text-center text-muted-foreground py-12">일정이 없습니다</div>
      ) : (
        sorted.map((e) => (
          <button
            key={e.id}
            data-testid={`calendar-event-${e.id}`}
            onClick={() => onSelectEvent(e)}
            className="flex gap-4 px-4 py-3 text-left hover:bg-muted/50 w-full"
          >
            {/* 날짜 */}
            <span className="text-sm text-muted-foreground w-28 shrink-0">
              {format(new Date(e.startsAt), 'M.d (EEE)')}
            </span>
            {/* 시간 — 종일 이벤트는 '종일' 표시 */}
            <span className="text-sm text-muted-foreground w-16 shrink-0">
              {e.allDay ? '종일' : hhmm(e.startsAt)}
            </span>
            {/* 제목 */}
            <span className="text-sm font-medium">{e.title}</span>
          </button>
        ))
      )}
    </div>
  )
}
