import { CalendarDays } from 'lucide-react'
import { useId } from 'react'
import { Link } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { useCalendarEvents } from '@/hooks/queries/useCalendarEvents'
import { todayRange } from '@/lib/calendarRange'
import { showsLoadError } from '@/lib/queryFailure'
import { cn } from '@/lib/utils'
import type { CalendarEvent } from '@/types/calendar'

import { WidgetError } from '../WidgetError'
import { eventTime, type TimeKind, todayAgenda } from './bodyRules'
import { WidgetEmptyState } from './WidgetEmptyState'

// 종류별 리딩 점 마커 스타일(시맨틱 토큰만). 미정은 hollow(테두리만)로 구분.
const DOT_CLASS: Record<TimeKind, string> = {
  allday: 'bg-primary',
  timed: 'bg-muted-foreground/40',
  untimed: 'border border-muted-foreground/40 bg-transparent',
}

/** 오늘 일정 요약 본문 — 건수 + 상위 3건. 프레임/딥링크는 Dashboard 담당. */
export default function CalendarTodayBody({
  count = 5,
  previewData,
}: {
  count?: number
  previewData?: CalendarEvent[]
}) {
  // WP-1899: 행 설명 id 접두 — 훅 규칙상 early return 전에 둔다.
  const base = useId()
  const { from, to } = todayRange()
  const query = useCalendarEvents(from, to, { enabled: !previewData })
  const { data: queryData, isLoading, refetch } = query
  const data = previewData ?? queryData

  // 실패 안내는 로딩보다 먼저 본다 — 다시 부르는 동안에도 안내를 그대로 둬야 다시 시도의 초점이 남는다(WP-881).
  if (!previewData && showsLoadError(query))
    return <WidgetError onRetry={() => refetch()} retrying={query.isFetching} testId="dash-calendar-error" />
  // I3(a11y): 로딩 영역에 aria-busy + 라벨.
  if (!previewData && isLoading)
    return (
      <div aria-busy="true" aria-label="불러오는 중">
        <Skeleton className="h-20 w-full" />
      </div>
    )

  const events = data ?? []
  if (events.length === 0)
    return (
      // #653: MyTasksBody 와 동일한 4단 구성(아이콘+제목+설명+CTA)으로 통일.
      // CTA(새 일정)는 캘린더 페이지의 기존 생성 다이얼로그를 ?new=true 딥링크로 재사용(신규 플로우 설계 없음).
      <WidgetEmptyState
        icon={CalendarDays}
        title="오늘 일정이 없어요"
        description="예정된 회의·마감이 없는 여유로운 하루예요"
        cta={{ label: '새 일정', to: '/calendar?new=true' }}
        testId="dash-calendar-empty"
      />
    )

  // 시작 시각순 정렬(미정은 맨 뒤) 후 상위 count 건(위젯 설정 기반) + 미정 건수(헤더에 함께 노출해 데이터 상태를 드러낸다).
  const { top, untimedCount } = todayAgenda(events, count)

  return (
    <div data-testid="dash-calendar">
      <div className="mb-2 text-sm text-muted-foreground">
        <span className="font-medium text-ai-accent">오늘 {events.length}건</span>
        {untimedCount > 0 && ` · 미정 ${untimedCount}`}
      </div>
      <ul className="space-y-0.5">
        {top.map((ev) => {
          const { label, kind } = eventTime(ev)
          // WP-1899: 이름(aria-label)은 제목만 두고, 시각 라벨(종일/HH:mm/미정)은 aria-describedby 로 설명에 잇는다.
          // 반복 일정은 회차가 id 를 공유하므로 occurrenceDate 를 붙여 행마다 유일하게 한다
          // (AgendaView·MonthView·TimeGrid 와 같은 키 규칙). 같은 id 면 둘째 행이 첫째 행의 시각을 읽는다.
          const rowKey = `${ev.id}-${ev.occurrenceDate ?? 'single'}`
          const timeId = `${base}-${rowKey}-time`
          return (
            // 일정 전용 상세 라우트가 없어 캘린더(/calendar)로 딥링크(스펙 §1.3 허용 폴백).
            <li key={rowKey}>
              <Link
                to="/calendar"
                aria-label={`일정 열기: ${ev.title}`}
                aria-describedby={timeId}
                className="flex min-h-7 items-center gap-2.5 rounded-md px-1.5 py-1 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {/* 리딩 컬럼: 점 마커 + 라벨(종일/HH:mm/미정). 고정폭으로 제목 시작점 정렬. */}
                <span
                  id={timeId}
                  data-testid="cal-time"
                  className={cn(
                    // 미정은 흐린 색 대신 기울임으로 구분한다 — 투명도를 낮추면 글자 대비가 4.5:1 밑으로 떨어진다(WP-736).
                    'flex w-14 shrink-0 items-center gap-1.5 text-xs tabular-nums text-muted-foreground',
                    kind === 'untimed' && 'italic',
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
