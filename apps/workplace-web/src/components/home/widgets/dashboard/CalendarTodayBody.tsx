import { CalendarDays } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { useCalendarEvents } from '@/hooks/queries/useCalendarEvents'
import { parseUtcDate } from '@/lib/formatters'
import { cn } from '@/lib/utils'
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

// 일정 종류 — allday(종일)/timed(시각 있음)/untimed(시작시각 미정).
type TimeKind = 'allday' | 'timed' | 'untimed'

// 리딩 컬럼에 표시할 라벨 + 종류. startsAt 이 null/빈 문자열이면
// '-'(의미 없는 placeholder) 대신 '미정' 으로 명시한다.
function eventTime(ev: CalendarEvent): { label: string; kind: TimeKind } {
  if (ev.allDay) return { label: '종일', kind: 'allday' }
  const d = parseUtcDate(ev.startsAt)
  if (Number.isNaN(d.getTime())) return { label: '미정', kind: 'untimed' }
  // 대시보드 컴팩트 표기 — 24시간제(예: 14:30)로 폭을 일정하게 유지.
  return {
    label: d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }),
    kind: 'timed',
  }
}

// 정렬 키 — 시작시각 오름차순. 미정(NaN)은 Infinity 로 밀어 항상 맨 뒤에 둔다.
function sortKey(ev: CalendarEvent): number {
  const t = parseUtcDate(ev.startsAt).getTime()
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
}

// 종류별 리딩 점 마커 스타일(시맨틱 토큰만). 미정은 hollow(테두리만)로 구분.
const DOT_CLASS: Record<TimeKind, string> = {
  allday: 'bg-primary',
  timed: 'bg-muted-foreground/40',
  untimed: 'border border-muted-foreground/40 bg-transparent',
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

  // 시작 시각순 정렬(미정은 맨 뒤) 후 상위 count 건(위젯 설정 기반).
  const top = [...events].sort((a, b) => sortKey(a) - sortKey(b)).slice(0, count)
  // 시작시각 미정 건수 — 헤더에 함께 노출해 데이터 상태를 드러낸다.
  const untimedCount = events.filter((ev) => eventTime(ev).kind === 'untimed').length

  return (
    <div data-testid="dash-calendar">
      <div className="mb-2 text-sm text-muted-foreground">
        오늘 {events.length}건{untimedCount > 0 && ` · 미정 ${untimedCount}`}
      </div>
      <ul className="space-y-0.5">
        {top.map((ev) => {
          const { label, kind } = eventTime(ev)
          return (
            // 일정 전용 상세 라우트가 없어 캘린더(/calendar)로 딥링크(스펙 §1.3 허용 폴백).
            <li key={ev.id}>
              <Link
                to="/calendar"
                aria-label={`일정 열기: ${ev.title}`}
                className="flex min-h-7 items-center gap-2.5 rounded-md px-1.5 py-1 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {/* 리딩 컬럼: 점 마커 + 라벨(종일/HH:mm/미정). 고정폭으로 제목 시작점 정렬. */}
                <span
                  data-testid="cal-time"
                  className={cn(
                    'flex w-14 shrink-0 items-center gap-1.5 text-xs tabular-nums',
                    kind === 'untimed' ? 'text-muted-foreground/70' : 'text-muted-foreground',
                  )}
                >
                  <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', DOT_CLASS[kind])} />
                  {label}
                </span>
                <span className="truncate">{ev.title}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
