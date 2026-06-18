import { CalendarDays } from 'lucide-react'
import { Link } from 'react-router-dom'

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
  // startsAt이 null/빈 문자열이면 parseUtcDate가 Invalid Date 반환 → '-'로 폴백
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

/** 오늘 일정 요약 본문 — 건수 + 상위 3건. 프레임/딥링크는 Dashboard 담당. */
export default function CalendarTodayBody({ count = 5 }: { count?: number }) {
  const { from, to } = todayRange()
  const { data, isLoading, isError, refetch } = useCalendarEvents(from, to)

  // I3(a11y): 로딩 영역에 aria-busy + 라벨.
  if (isLoading)
    return (
      <div aria-busy="true" aria-label="불러오는 중">
        <Skeleton className="h-20 w-full" />
      </div>
    )
  if (isError) return <WidgetError onRetry={() => refetch()} testId="dash-calendar-error" />

  const events = data ?? []
  if (events.length === 0)
    return (
      <div
        // I3(a11y): 빈 상태는 보조 안내이므로 role="status"(polite live region).
        role="status"
        className="flex flex-col items-center gap-2 py-6 text-center"
        data-testid="dash-calendar-empty"
      >
        <CalendarDays className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">오늘 일정이 없어요</p>
      </div>
    )

  // 시작 시각순 정렬 후 상위 count 건(위젯 설정 기반).
  const top = [...events]
    .sort((a, b) => parseUtcDate(a.startsAt).getTime() - parseUtcDate(b.startsAt).getTime())
    .slice(0, count)

  return (
    <div data-testid="dash-calendar">
      <div className="mb-2 text-sm text-muted-foreground">오늘 {events.length}건</div>
      <ul className="space-y-0.5">
        {top.map((ev) => (
          // 일정 전용 상세 라우트가 없어 캘린더(/calendar)로 딥링크(스펙 §1.3 허용 폴백).
          <li key={ev.id}>
            <Link
              to="/calendar"
              aria-label={`일정 열기: ${ev.title}`}
              className="flex min-h-6 items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="w-12 shrink-0 text-xs text-muted-foreground">{eventTime(ev)}</span>
              <span className="truncate">{ev.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
