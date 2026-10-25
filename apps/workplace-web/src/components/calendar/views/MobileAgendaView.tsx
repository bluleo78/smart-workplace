// 모바일 캘린더 일정 목록(WP-136) — 시작일부터 날짜별로 묶어 보여 주고, 아래로 스크롤하면 다음 30일을 이어 불러온다.
// 오늘 묶음은 끝난 일정을 흐리게 하고 지금 시각 위치에 빨간 선을 긋는다.
// 데이터는 CalendarPage 가 useAgendaChunks 로 조회해 넘긴다(AI 화면 컨텍스트에 같은 범위·건수를 싣기 위해). 데스크톱은 AgendaView 그대로.
import { format, isSameDay, startOfDay } from 'date-fns'
import { CalendarDays, Flag } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { MobileEmptyState } from '@/components/mobile/MobileEmptyState'
import { LoadMoreFooter } from '@/components/ui/load-more-footer'
import { Skeleton } from '@/components/ui/skeleton'
import type { AgendaChunks } from '@/hooks/queries/useAgendaChunks'
import { useCalendars } from '@/hooks/queries/useCalendars'
import { eventCalendarLabel, eventDisplayColor } from '@/lib/calendar'
import {
  AGENDA_CHUNK_DAYS,
  type AgendaDay,
  type AgendaItem,
  agendaNowState,
  agendaTimeLabels,
  agendaTitle,
} from '@/lib/calendarAgenda'
import { resolvePalette } from '@/lib/calendarPalette'
import { cn } from '@/lib/utils'
import type { CalendarEvent, IssueDueMarker } from '@/types/calendar'

export interface MobileAgendaViewProps {
  /** useAgendaChunks 결과 — 묶음·불러오기 상태·loadMore/retry·scrollKey, 맨 위 날짜는 agenda.setTopDay 로 알린다. */
  agenda: AgendaChunks
  /** 지금 시각(호출부 useMinuteNow, 분 단위) — 오늘 판정·흐림·지금 선. */
  now: Date
  onSelectEvent: (e: CalendarEvent) => void
  onSelectIssue: (marker: IssueDueMarker) => void
}

// 행 공통 — 좌우 여백 16 · 시간 칸 44 · 간격 10. 지금 선(NowLine)의 왼쪽 시작점 70px 이 이 합(막대 위치)이다.
const ROW_CLASS = 'flex min-h-11 w-full items-stretch gap-2.5 border-b px-4 py-2 text-left active:bg-accent'

/** 모바일 일정 목록 뷰 — 자체 스크롤 컨테이너(센티널·맨 위 날짜 관찰의 root). */
export function MobileAgendaView({ agenda, now, onSelectEvent, onSelectIssue }: MobileAgendaViewProps) {
  // 스크롤 컨테이너 — 센티널 rootMargin 이 이 요소 기준으로 동작하도록 state 로 들고 observer 들에 root 로 넘긴다(WP-94).
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const { start, days, isLoading, isLoadingMore, isFetching, isError, hasMore, autoPaused, loadedChunks, loadMore, retry, scrollKey } =
    agenda
  // 날짜 단위 오늘 — 오늘이 아닌 묶음엔 이것만 넘겨 분 단위 now 가 바뀌어도 다시 그리지 않는다(memo).
  const todayKey = startOfDay(now).getTime()

  // 행 선택 콜백은 최신 참조만 ref 로 들고 고정 래퍼를 내려 준다 — 페이지 재렌더(맨 위 날짜 변경 등)에 묶음 memo 가 깨지지 않게.
  const selectRef = useRef({ onSelectEvent, onSelectIssue })
  useEffect(() => {
    selectRef.current = { onSelectEvent, onSelectIssue }
  })
  const select = useMemo(
    () => ({
      event: (e: CalendarEvent) => selectRef.current.onSelectEvent(e),
      issue: (m: IssueDueMarker) => selectRef.current.onSelectIssue(m),
    }),
    [],
  )

  // 목록 끝 푸터(공용 LoadMoreFooter) 어댑터 — 평소엔 센티널이 loadMore, 실패 중엔 버튼이 retry(실패한 청크만).
  // 상한에 닿았어도 실패한 청크가 있으면 다시 시도 줄은 남긴다. 다시 시도 중(실패 상태는 성공 전까지 남는다)도 "불러오는 중…".
  const footerQuery = {
    hasNextPage: hasMore || isError,
    isFetching,
    isFetchNextPageError: isError,
    isFetchingNextPage: isLoadingMore || (isError && isFetching),
    fetchNextPage: isError ? retry : loadMore,
  }

  // 세대 변경(시작일·reset) → 맨 위로. 레이아웃 effect 인 이유: 청크가 줄어 끝으로 눌린 한 프레임에 센티널이 보여
  // 방금 버린 둘째 청크를 다시 부르지 않게 페인트 전에 올린다.
  useLayoutEffect(() => {
    scrollEl?.scrollTo({ top: 0 })
  }, [scrollEl, scrollKey])

  // ── 맨 위 날짜 관찰 — observer 는 scrollEl·세대(scrollKey)마다 하나. 묶음(section)은 ref 콜백으로 등록·해제한다. ──
  // 머리글이 아니라 section 을 본다 — sticky 머리글은 묶음이 끝날 때까지 맨 위에 붙어 있어 위치로 판단할 수 없다.
  // setTopDay·묶음 목록은 최신 값을 ref 로 읽는다 — 묶음이 바뀔 때마다 observer 를 다시 만들지 않게.
  const latestRef = useRef({ setTopDay: agenda.setTopDay, days })
  useEffect(() => {
    latestRef.current = { setTopDay: agenda.setTopDay, days }
  })
  const ioRef = useRef<IntersectionObserver | null>(null)
  const sectionsRef = useRef(new Set<HTMLElement>())
  const visibleRef = useRef(new Set<string>())
  const lastTopKeyRef = useRef<string | null>(null)
  // 보이는 묶음 중 가장 이른 날(key 'yyyy-MM-dd' 사전순 = 날짜순)이 바뀌었으면 알린다.
  const reportTop = useCallback(() => {
    let top: string | null = null
    for (const k of visibleRef.current) if (top === null || k < top) top = k
    if (top === null || top === lastTopKeyRef.current) return
    lastTopKeyRef.current = top
    const day = latestRef.current.days.find((d) => d.key === top)?.day
    if (day) latestRef.current.setTopDay(day)
  }, [])
  // 세대가 바뀌면(맨 위 날짜가 null 로 돌아간다) 다시 만들어, 맨 위로 올린 뒤 보이는 묶음의 첫 알림으로 같은 날이라도 다시 알린다.
  useEffect(() => {
    if (!scrollEl) return
    lastTopKeyRef.current = null
    const visible = visibleRef.current
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).dataset.dayKey
          if (!key) continue
          if (entry.isIntersecting) visible.add(key)
          else visible.delete(key)
        }
        reportTop()
      },
      { root: scrollEl },
    )
    ioRef.current = io
    // observer 보다 먼저 그려진 묶음(자식 ref 가 먼저 붙는다)도 관찰한다.
    sectionsRef.current.forEach((n) => io.observe(n))
    return () => {
      io.disconnect()
      ioRef.current = null
      visible.clear()
    }
  }, [scrollEl, scrollKey, reportTop])
  // 묶음 ref 콜백(참조 고정 — 묶음 memo 유지). 늦게 그려진 묶음도 그 즉시 관찰하고, 사라진 묶음은 보임 집합에서 빼고 다시 판정한다
  // (unobserve 한 노드엔 "안 보임" 알림이 오지 않아 지운 날이 맨 위로 남는다).
  const registerSection = useCallback(
    (el: HTMLElement) => {
      sectionsRef.current.add(el)
      ioRef.current?.observe(el)
      return () => {
        sectionsRef.current.delete(el)
        ioRef.current?.unobserve(el)
        if (el.dataset.dayKey && visibleRef.current.delete(el.dataset.dayKey)) reportTop()
      }
    },
    [reportTop],
  )

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
          {days.length === 0 && !isError && (autoPaused || !hasMore) && (
            // 불러온 범위 전체가 비었고 자동 불러오기도 멈췄을 때만 — 문구는 실제로 확인한 기간 그대로.
            <MobileEmptyState
              icon={CalendarDays}
              title={`${isSameDay(start, now) ? '앞으로' : `${format(start, 'M월 d일')}부터`} ${loadedChunks * AGENDA_CHUNK_DAYS}일간 일정이 없습니다`}
              className="pt-16"
              data-testid="calendar-agenda-empty"
            />
          )}
          {days.map((d) => (
            <DaySection
              key={d.key}
              day={d}
              todayKey={todayKey}
              now={d.day.getTime() === todayKey ? now : null}
              sectionRef={registerSection}
              onSelectEvent={select.event}
              onSelectIssue={select.issue}
            />
          ))}
          {autoPaused && !isError ? (
            // 빈 청크가 이어져 자동 연쇄를 멈춘 상태 — 누를 때마다 30일씩. 공용 LoadMoreFooter 엔 "수동 버튼" 칸이 없어 따로 그린다.
            <div className="py-1 text-center">
              <button
                type="button"
                data-testid="calendar-agenda-load-next"
                onClick={loadMore}
                className="min-h-11 px-4 text-sm font-medium text-primary active:bg-accent"
              >
                다음 {AGENDA_CHUNK_DAYS}일 더 보기
              </button>
            </div>
          ) : (
            // 센티널 — 높이가 있어야 보임 판정이 안정적이다(min-h-11).
            <LoadMoreFooter
              query={footerQuery}
              root={scrollEl}
              enabled={!isLoading}
              errorLabel="일부 일정을 불러오지 못했습니다 — 다시 시도"
              className="min-h-11"
              data-testid="calendar-agenda-more"
            />
          )}
        </>
      )}
    </div>
  )
}

/** 하루치 묶음 — sticky 머리글 + 행. 오늘이면 끝난 일정 흐림 + 지금 선.
 *  memo — 묶음·콜백 참조가 고정이고, 분 단위 now 는 오늘 묶음에만 넘어와(그 밖은 null) 나머지는 날짜가 바뀔 때만 다시 그린다. */
const DaySection = memo(function DaySection({
  day,
  todayKey,
  now,
  sectionRef,
  onSelectEvent,
  onSelectIssue,
}: {
  day: AgendaDay
  /** 오늘 로컬 자정(ms) — 머리글 "오늘 ·" 판정. */
  todayKey: number
  /** 오늘 묶음일 때만 지금 시각, 아니면 null. */
  now: Date | null
  sectionRef: (el: HTMLElement) => () => void
  onSelectEvent: (e: CalendarEvent) => void
  onSelectIssue: (marker: IssueDueMarker) => void
}) {
  const isToday = now != null
  const nowState = now ? agendaNowState(day.items, now) : null
  const title = agendaTitle(day.day, new Date(todayKey))

  return (
    // aria-label 을 달지 않는다 — 이름 있는 section 은 날짜마다 region 랜드마크가 되어 랜드마크 목록을 덮는다. 묶음 이름은 h2 가 맡는다.
    <section ref={sectionRef} data-day-key={day.key}>
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
})

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
 * continuedOn: 목록 시작일 전에 시작해 그 날(continuedOn)까지 이어지는 일정. 시간 칸 두 줄 문구는 agendaTimeLabels 가
 * 시작일 행·이어지는 행 모두 같은 규칙으로 만든다(여러 날 종일 "종일 / ~10/16", 자정 끝 "24:00" 등).
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
  // 캘린더 이름 — 초대받은 일정은 주최자 캘린더 이름 대신 「초대받은 일정」(WP-604). 목록은 캐시된 내 캘린더 목록으로 판정한다.
  const { data: calendars } = useCalendars()
  const myCalendarIds = useMemo(() => (calendars ? new Set(calendars.map((c) => c.id)) : null), [calendars])
  const sub = [eventCalendarLabel(event, myCalendarIds), event.location].filter(Boolean).join(' · ')
  // 시간 칸 첫 줄(시작)과 둘째 줄(끝). 둘째 줄이 없으면 한 줄(하루짜리 종일).
  const { start, end } = agendaTimeLabels(event, continuedOn)
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
            {/* 끝 줄에 보이는 "~" 가 있으면(날짜 끝·이어지는 일정) 구분자는 공백만. */}
            <Sep text={end.startsWith('~') ? ' ' : ' ~ '} />
            <span className="block text-[11px] font-normal text-muted-foreground">{end}</span>
          </>
        )}
      </span>
      <Sep text=", " />
      <span
        aria-hidden="true"
        className={cn('w-0.75 shrink-0 rounded-full', resolvePalette(eventDisplayColor(event)).dotClass, past && 'opacity-50')}
      />
      <RowBody title={event.title} sub={sub} muted={past} />
    </button>
  )
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
