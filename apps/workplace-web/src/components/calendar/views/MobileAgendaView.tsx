// 모바일 캘린더 일정 목록(WP-136) — 시작일부터 날짜별로 묶어 보여 주고, 아래로 스크롤하면 다음 30일을 이어 불러온다.
// 날짜 머리글(sticky, 오늘 강조·건수) · 44px 시간 칸(시작/끝 두 줄) · 캘린더 색 3px 막대 · 줄바꿈되는 제목 · 보조 줄,
// 오늘 묶음은 끝난 일정을 흐리게 하고 지금 시각 위치에 빨간 선을 긋는다.
// 데이터는 CalendarPage 가 useAgendaChunks 로 조회해 넘긴다(AI 화면 컨텍스트에 같은 범위·건수를 싣기 위해). 데스크톱은 AgendaView 그대로.
import { format, isSameDay } from 'date-fns'
import { CalendarDays, Flag } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { MobileEmptyState } from '@/components/mobile/MobileEmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import type { AgendaChunks } from '@/hooks/queries/useAgendaChunks'
import { useLoadMoreSentinel } from '@/hooks/useLoadMoreSentinel'
import { type AgendaDay, type AgendaItem, agendaNowState, agendaTitle, continuedEndLabel } from '@/lib/calendarAgenda'
import { resolvePalette } from '@/lib/calendarPalette'
import { formatLocalClockTime24 } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import type { CalendarEvent, IssueDueMarker } from '@/types/calendar'

export interface MobileAgendaViewProps {
  /** useAgendaChunks 결과 — 묶음·불러오기 상태·loadMore/retry·scrollKey. */
  agenda: AgendaChunks
  /** 지금 시각 — 호출부(useMinuteNow)가 1분마다·화면 복귀 시 갱신한다. 오늘 판정·흐림·지금 선에 쓴다. */
  now: Date
  onSelectEvent: (e: CalendarEvent) => void
  onSelectIssue: (marker: IssueDueMarker) => void
  /** 화면 맨 위에 보이는 날짜 묶음이 바뀔 때 — 헤더 월 표시용. 묶음이 없으면 호출되지 않는다(호출부는 anchor 로 폴백). */
  onTopDayChange?: (day: Date) => void
}

// 행 공통 — 좌우 여백 16 · 시간 칸 44 · 간격 10. 지금 선(NowLine)의 왼쪽 시작점 70px 이 이 합(막대 위치)이다.
const ROW_CLASS = 'flex min-h-11 w-full items-stretch gap-2.5 border-b px-4 py-2 text-left active:bg-accent'

/** 모바일 일정 목록 뷰 — 자체 스크롤 컨테이너(센티널·맨 위 날짜 관찰의 root). */
export function MobileAgendaView({ agenda, now, onSelectEvent, onSelectIssue, onTopDayChange }: MobileAgendaViewProps) {
  // 스크롤 컨테이너 — 센티널 rootMargin 이 이 요소 기준으로 동작하도록 state 로 들고 observer 들에 root 로 넘긴다(WP-94).
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const { days, isLoading, isLoadingMore, isFetching, isError, hasMore, loadMore, retry, scrollKey } = agenda

  // 목록 끝 센티널 — 화면에 들어오면 다음 청크. 조회가 끝날 때마다 observer 를 다시 붙여, 빈 청크가 이어져도
  // 센티널이 보이는 동안 계속 불러온다(일정 드문 달에서 막히지 않게). 실패하면 멈추고 다시 시도 버튼.
  const sentinelRef = useLoadMoreSentinel(
    { hasNextPage: hasMore, isFetching, isFetchNextPageError: isError, fetchNextPage: loadMore },
    scrollEl,
    !isLoading,
  )

  // 시작일 변경·[오늘](reset) → 맨 위로. 같은 컨테이너를 재사용하므로 이전 스크롤 위치가 남지 않게 한다.
  // 레이아웃 effect 로 페인트 전에 올린다 — 일반 effect 면 청크가 줄어 스크롤이 끝으로 눌린 한 프레임에
  // 끝 센티널이 보여 방금 버린 둘째 청크를 다시 불렀다(WP-136 A2).
  useLayoutEffect(() => {
    scrollEl?.scrollTo({ top: 0 })
  }, [scrollEl, scrollKey])

  // 맨 위 날짜 알림 — 콜백은 최신 참조만 쓰고(인라인 함수여도 observer 를 다시 만들지 않게), 같은 날은 다시 알리지 않는다.
  const topCbRef = useRef(onTopDayChange)
  useEffect(() => {
    topCbRef.current = onTopDayChange
  })
  const lastTopKeyRef = useRef<string | null>(null)
  // 맨 위로 되돌린 뒤엔 같은 날이라도 다시 알린다(호출부가 헤더를 anchor 로 바꿨을 수 있다).
  useEffect(() => {
    lastTopKeyRef.current = null
  }, [scrollKey])
  // 날짜 묶음(section) 중 보이는 것의 집합을 관찰해 가장 이른 날 = 맨 위 묶음으로 본다(key 'yyyy-MM-dd' 사전순 = 날짜순).
  // 머리글이 아니라 section 을 본다 — sticky 머리글은 묶음이 끝날 때까지 맨 위에 붙어 있어 위치로 판단할 수 없다.
  useEffect(() => {
    // 로딩 중엔 스켈레톤이라 section 이 없다 — isLoading 을 의존성에 넣어, 일정이 먼저 오고 마감이 [](같은 참조라 days 불변)로
    // 뒤따라 와도 section 이 실제로 그려진 뒤 다시 관찰을 건다(안 그러면 아무것도 관찰하지 않아 헤더 월 추적이 멈춘다).
    if (!scrollEl || isLoading || days.length === 0) return
    const dayByKey = new Map(days.map((d) => [d.key, d.day]))
    const visible = new Set<string>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).dataset.dayKey
          if (!key) continue
          if (entry.isIntersecting) visible.add(key)
          else visible.delete(key)
        }
        let top: string | null = null
        for (const k of visible) if (top === null || k < top) top = k
        if (top === null || top === lastTopKeyRef.current) return
        lastTopKeyRef.current = top
        const day = dayByKey.get(top)
        if (day) topCbRef.current?.(day)
      },
      { root: scrollEl },
    )
    scrollEl.querySelectorAll<HTMLElement>('[data-day-key]').forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [scrollEl, days, isLoading])

  return (
    <div
      ref={setScrollEl}
      data-testid="calendar-view-agenda"
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
    >
      {isLoading ? (
        <AgendaSkeleton />
      ) : (
        <>
          {days.length === 0 && !isError && (
            // 불러온 범위 전체가 비었을 때만 — 아래 센티널이 보이는 동안 다음 기간을 계속 불러온다.
            <MobileEmptyState
              icon={CalendarDays}
              title="이 기간에 일정이 없습니다"
              className="pt-16"
              data-testid="calendar-agenda-empty"
            />
          )}
          {days.map((d) => (
            <DaySection
              key={d.key}
              day={d}
              now={now}
              onSelectEvent={onSelectEvent}
              onSelectIssue={onSelectIssue}
            />
          ))}
          {isError ? (
            <RetryFooter retrying={isFetching} onRetry={retry} />
          ) : (
            hasMore && (
              // 센티널 — 높이가 있어야 보임 판정이 안정적이다. 뒤 청크 첫 조회 중엔 스켈레톤 한 줄.
              <div ref={sentinelRef} data-testid="calendar-agenda-more" className="min-h-11">
                {isLoadingMore && <SkeletonRow />}
              </div>
            )
          )}
        </>
      )}
    </div>
  )
}

/** 하루치 묶음 — sticky 머리글 + 행. 오늘이면 끝난 일정 흐림 + 지금 선. */
function DaySection({
  day,
  now,
  onSelectEvent,
  onSelectIssue,
}: {
  day: AgendaDay
  now: Date
  onSelectEvent: (e: CalendarEvent) => void
  onSelectIssue: (marker: IssueDueMarker) => void
}) {
  const isToday = isSameDay(day.day, now)
  const nowState = isToday ? agendaNowState(day.items, now) : null
  const title = agendaTitle(day.day, now)

  return (
    // aria-label 을 달지 않는다 — 이름 있는 section 은 날짜마다 region 랜드마크가 되어 랜드마크 목록을 덮는다. 묶음 이름은 h2 가 맡는다.
    <section data-day-key={day.key}>
      {/* 머리글 — sticky 라 불투명 바탕이 필요하다(다크 muted·primary/10 은 반투명): bg-background 위에 안쪽 층으로 색을 얹는다. */}
      <h2 data-testid={`calendar-agenda-day-${day.key}`} className="sticky top-0 z-10 bg-background">
        {/* 제목 안이라 div 대신 span(구문 콘텐츠). sr-only 쉼표로 접근성 이름이 "…(화), 3건" 으로 읽히게 한다. */}
        <span
          className={cn(
            'flex items-center justify-between border-b px-4 py-1.5 text-xs font-semibold',
            isToday ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          <span>{title}</span>
          <Sep text=", " />
          <span className="font-normal text-muted-foreground">{day.items.length}건</span>
        </span>
      </h2>
      {day.items.map((item, i) => (
        <AgendaRowWithNow
          key={itemKey(item)}
          item={item}
          day={day.day}
          past={nowState?.past[i] ?? false}
          isNext={nowState?.nowIndex === i}
          onSelectEvent={onSelectEvent}
          onSelectIssue={onSelectIssue}
        />
      ))}
      {/* 시간 지정 일정이 모두 끝났으면 묶음 끝에 지금 선 */}
      {nowState && nowState.nowIndex === day.items.length && <NowLine />}
    </section>
  )
}

// 행 key — 반복 회차는 id 를 공유하므로 occurrenceDate 까지 붙인다(AgendaView 와 같은 규칙).
function itemKey(item: AgendaItem): string {
  return item.kind === 'event'
    ? `e-${item.event.id}-${item.event.occurrenceDate ?? 'single'}`
    : `d-${item.marker.issueId}`
}

/** 한 행 — isNext(지금 선 바로 다음 행)면 선을 앞에 긋고 시작 시각을 강조한다. */
function AgendaRowWithNow({
  item,
  day,
  past,
  isNext,
  onSelectEvent,
  onSelectIssue,
}: {
  item: AgendaItem
  day: Date
  past: boolean
  isNext: boolean
  onSelectEvent: (e: CalendarEvent) => void
  onSelectIssue: (marker: IssueDueMarker) => void
}) {
  return (
    <>
      {isNext && <NowLine />}
      {item.kind === 'event' ? (
        <EventRow
          event={item.event}
          continuedOn={item.continued ? day : null}
          past={past}
          isNext={isNext}
          onSelect={onSelectEvent}
        />
      ) : (
        <DueRow marker={item.marker} onSelect={onSelectIssue} />
      )}
    </>
  )
}

/**
 * 일정 행 — 시간(종일/시작·끝) · 캘린더 색 막대 · 제목 · 캘린더명 · 장소.
 * continuedOn: 목록 시작일 전에 시작해 그 날(continuedOn)까지 이어지는 일정 — 시간 칸 첫 줄은 종일이면 "종일",
 * 시간 일정이면 시작 날짜(M/d), 둘째 줄은 끝("~10/15" 또는 그 날 안에 끝나면 "~09:00"). 두 줄 규격은 같다.
 */
function EventRow({
  event,
  continuedOn,
  past,
  isNext,
  onSelect,
}: {
  event: CalendarEvent
  continuedOn: Date | null
  past: boolean
  isNext: boolean
  onSelect: (e: CalendarEvent) => void
}) {
  const sub = [event.calendarName, event.location].filter(Boolean).join(' · ')
  // 시간 칸 첫 줄(시작)과 둘째 줄(끝). 둘째 줄이 없으면 한 줄(당일 종일).
  const start = event.allDay ? '종일' : continuedOn ? format(new Date(event.startsAt), 'M/d') : formatLocalClockTime24(event.startsAt)
  const end = continuedOn ? continuedEndLabel(event, continuedOn) : event.allDay ? null : endLabel(event)
  return (
    <button
      type="button"
      data-testid={`calendar-event-${event.occurrenceDate ? `${event.id}-${event.occurrenceDate}` : event.id}`}
      data-continued={continuedOn ? 'true' : undefined}
      onClick={() => onSelect(event)}
      className={ROW_CLASS}
    >
      {/* 끝난 일정은 행 전체 투명도 대신 글자를 muted 로(보조 줄 대비 2:1 → 본문 대비 유지), 투명도는 색 막대에만 — 여전히 눌러 열 수 있다. */}
      <span
        className={cn(
          'w-11 shrink-0 text-xs leading-snug tabular-nums',
          isNext && 'font-semibold text-primary',
          past && 'text-muted-foreground',
        )}
      >
        {start}
        {end && (
          <>
            {/* 이어지는 일정은 끝 앞에 보이는 "~" 가 있어 구분자는 공백만. */}
            <Sep text={continuedOn ? ' ' : ' ~ '} />
            <span className="block text-[11px] font-normal text-muted-foreground">{end}</span>
          </>
        )}
      </span>
      <Sep text=", " />
      <span
        aria-hidden="true"
        className={cn('w-0.75 shrink-0 rounded-full', resolvePalette(event.effectiveColor).dotClass, past && 'opacity-50')}
      />
      <RowBody title={event.title} sub={sub} muted={past} />
    </button>
  )
}

// 끝 표시 — 같은 날이면 HH:mm, 다음 날 이후에 끝나면 날짜(M/d)로 — 시각만 쓰면 시작보다 이른 시각처럼 읽힌다.
function endLabel(event: CalendarEvent): string {
  const end = new Date(event.endsAt)
  return isSameDay(end, new Date(event.startsAt)) ? formatLocalClockTime24(event.endsAt) : format(end, 'M/d')
}

/** 이슈 마감 행 — ⚑ 마감 · primary 막대 · 이슈 제목 · "이슈 마감 · KEY-N". */
function DueRow({ marker, onSelect }: { marker: IssueDueMarker; onSelect: (m: IssueDueMarker) => void }) {
  return (
    <button
      type="button"
      data-testid={`calendar-issue-due-${marker.issueId}`}
      onClick={() => onSelect(marker)}
      className={ROW_CLASS}
    >
      <span className="flex w-11 shrink-0 items-start gap-0.5 text-xs leading-snug">
        <Flag className="mt-0.5 size-3 shrink-0 text-primary" aria-hidden="true" />
        마감
      </span>
      <Sep text=", " />
      <span aria-hidden="true" className="w-0.75 shrink-0 rounded-full bg-primary" />
      <RowBody title={marker.title} sub={`이슈 마감 · ${marker.projectKey}-${marker.number}`} />
    </button>
  )
}

/** 행 본문 — 제목은 잘리지 않고 줄바꿈된다(모바일 월 보기 칩 잘림 문제를 푸는 핵심). muted = 끝난 일정(제목을 흐린 글자색으로). */
function RowBody({ title, sub, muted = false }: { title: string; sub: string; muted?: boolean }) {
  return (
    <span className="min-w-0 flex-1">
      <span className={cn('block break-words text-sm font-medium leading-snug', muted && 'text-muted-foreground')}>{title}</span>
      {sub && <Sep text=", " />}
      {sub && <span className="mt-0.5 block break-words text-xs text-muted-foreground">{sub}</span>}
    </span>
  )
}

/** 화면엔 안 보이는 구분자 — 버튼·제목의 접근성 이름에서 붙어 읽히는 칸("07:0007:30아침…")을 띄운다. */
function Sep({ text }: { text: string }) {
  return <span className="sr-only">{text}</span>
}

/** 지금 시각 선 — 막대 위치(70px)부터 오른쪽 여백까지, 왼쪽 끝에 점. */
function NowLine() {
  return (
    <div
      data-testid="calendar-agenda-now"
      role="separator"
      aria-label="현재 시각"
      className="relative mr-4 ml-[70px] border-t-2 border-destructive"
    >
      <span className="absolute -top-[5px] -left-1 size-2 rounded-full bg-destructive" aria-hidden="true" />
    </div>
  )
}

/** 일정 청크 실패 푸터 — 다시 시도 중이면 버튼 대신 스켈레톤(실패 상태는 성공 전까지 남아 그대로면 버튼이 계속 보인다 — LoadMoreFooter 와 같은 순서). */
function RetryFooter({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  if (retrying) return <SkeletonRow />
  return (
    <div className="py-3 text-center text-xs">
      <button type="button" data-testid="calendar-agenda-retry" className="text-destructive underline" onClick={onRetry}>
        불러오지 못했습니다 — 다시 시도
      </button>
    </div>
  )
}

/** 첫 청크 로딩 — 머리글 + 행 몇 줄 모양. */
function AgendaSkeleton() {
  return (
    <div data-testid="calendar-agenda-loading" aria-busy="true">
      <Skeleton className="h-7 rounded-none" />
      {[0, 1, 2, 3, 4].map((i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  )
}

/** 스켈레톤 한 행 — 시간 칸 + 본문. */
function SkeletonRow() {
  return (
    <div className="flex gap-2.5 px-4 py-2">
      <Skeleton className="h-8 w-11" />
      <Skeleton className="h-8 flex-1" />
    </div>
  )
}
