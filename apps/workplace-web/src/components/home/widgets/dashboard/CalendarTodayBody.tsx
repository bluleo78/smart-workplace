import { CalendarDays } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { useCalendarEvents } from '@/hooks/queries/useCalendarEvents'
import { parseUtcDate } from '@/lib/formatters'
import type { CalendarEvent } from '@/types/calendar'

import { WidgetError } from '../WidgetError'

// 오늘 00:00~24:00(로컬) 범위의 ISO 문자열을 만들어 캘린더 쿼리에 전달.
function todayRange(): { from: string; to: string } {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { from: start.toISOString(), to: end.toISOString() }
}

// 일정 시작 시각 — allDay 면 '종일', 아니면 HH:mm(로컬).
function eventTime(ev: CalendarEvent): string {
  if (ev.allDay) return '종일'
  const d = parseUtcDate(ev.startsAt)
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

/** 오늘 일정 요약 본문 — 건수 + 상위 3건. 프레임/딥링크는 Dashboard 담당. */
export default function CalendarTodayBody() {
  const { from, to } = todayRange()
  const { data, isLoading, isError, refetch } = useCalendarEvents(from, to)

  if (isLoading) return <Skeleton className="h-20 w-full" />
  if (isError) return <WidgetError onRetry={() => refetch()} testId="dash-calendar-error" />

  const events = data ?? []
  if (events.length === 0)
    return (
      <div
        className="flex flex-col items-center gap-2 py-6 text-center"
        data-testid="dash-calendar-empty"
      >
        <CalendarDays className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">오늘 일정이 없어요</p>
      </div>
    )

  // 시작 시각순 정렬 후 상위 3건.
  const top = [...events]
    .sort((a, b) => parseUtcDate(a.startsAt).getTime() - parseUtcDate(b.startsAt).getTime())
    .slice(0, 3)

  return (
    <div data-testid="dash-calendar">
      <div className="mb-2 text-sm text-muted-foreground">오늘 {events.length}건</div>
      <ul className="space-y-1">
        {top.map((ev) => (
          <li key={ev.id} className="flex items-center gap-2 text-sm">
            <span className="w-12 shrink-0 text-xs text-muted-foreground">{eventTime(ev)}</span>
            <span className="truncate">{ev.title}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
