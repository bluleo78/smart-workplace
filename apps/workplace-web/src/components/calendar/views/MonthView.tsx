// 월간 뷰 — 7열 × 6행(42칸) 달력 그리드.
// monthMatrix()로 일요일 시작 6주를 생성한다.
import { format, isSameMonth, isToday } from 'date-fns'
import { useLayoutEffect, useRef, useState } from 'react'

import { ExtraTagDots } from '@/components/calendar/ExtraTagDots'
import { IssueDueChip } from '@/components/calendar/IssueDueChip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover'
import { eventDisplayColor, eventsOnDay, issueDuesOnDay, monthMatrix } from '@/lib/calendar'
import { withRange } from '@/lib/calendarMove'
import { resolvePalette } from '@/lib/calendarPalette'
import type { CalendarEvent, IssueDueMarker } from '@/types/calendar'

import { fitMonthCell, MONTH_MIN_ROW_H } from './monthCellFit'
import { MovePreviewChip } from './MovePreviewChip'
import type { ViewProps } from './TimeGrid'
import { isMovingEvent, useEventMoveDrag } from './useEventMoveDrag'

// 요일 헤더 (일~토)
const WEEK_DAYS = ['일', '월', '화', '수', '목', '금', '토']

// 월간 뷰 컴포넌트
export function MonthView({
  events,
  issueDues,
  anchor,
  onSelectEvent,
  onSelectIssue,
  onCreateAt,
  onMoveEvent,
  canMoveEvent,
}: ViewProps) {
  // 일정 끌어 옮기기(WP-1328) — 칸 사이로 날짜만 옮긴다(타임드 일정은 시각 유지, 종일 ↔ 타임드 바꾸지 않음).
  const move = useEventMoveDrag({ onMoveEvent, canMoveEvent })
  // 놓일 날 판정용 사본 — 옮긴 범위로 바꾼 일정이 걸친 칸마다 반투명 사본을 그린다.
  const movedEvent = move.preview?.range ? withRange(move.preview.event, move.preview.range) : null
  // anchor 기준 42칸 날짜 배열
  const cells = monthMatrix(anchor)

  // 6행이 모두 minmax(0,1fr) 균등 높이이므로 그리드 높이/6 = 한 셀 높이.
  // ResizeObserver 로 셀 높이를 재서 셀별 칩(일정+마감 이슈) 표시 개수 계산에 사용한다.
  const gridRef = useRef<HTMLDivElement>(null)
  const [rowHeight, setRowHeight] = useState(0)
  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el) return
    // 칩 높이 상수는 루트 글자 크기 16px 기준(Tailwind rem)이다. 사용자가 브라우저 글자 크기를 바꾸면
    // 칩도 같은 비율로 커지므로, 잰 높이를 16px 기준으로 환산해 개수가 어긋나지 않게 한다.
    // 글자 크기는 크기 바뀜마다 바뀌지 않으므로 처음 한 번만 읽는다(스타일 재계산 줄이기).
    const fontScale = (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16
    const update = () => setRowHeight(el.clientHeight / 6 / fontScale)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    // 스크롤 틀은 바깥 스와이프 영역의 touch-action(pan-y)을 끊으므로 모바일에서는 여기에 다시 건다 —
    // 없으면 브라우저가 가로 제스처를 가져가(pointercancel) 좌우 스와이프로 달이 바뀌지 않는다(TimeGrid 와 같음).
    <div data-testid="calendar-view-month" className="flex h-full min-h-0 flex-col overflow-y-auto max-lg:touch-pan-y">
      {/* ── 요일 헤더 ── 창이 낮아 스크롤될 때도 보이게 sticky. 끌어 옮기기 미리보기(z-10) 위(z-20). */}
      <div className="sticky top-0 z-20 grid shrink-0 grid-cols-7 border-b bg-background">
        {WEEK_DAYS.map((d) => (
          <div key={d} className="text-center text-xs font-medium py-2 text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      {/* ── 6행 × 7열 날짜 셀 ── 행 최소 높이를 보장해(minHeight) 마감 이슈가 몰려도 6주가 늘어나지 않고,
          창이 낮으면 행을 줄이는 대신 바깥 컨테이너가 세로 스크롤된다(WP-1541). */}
      <div
        ref={gridRef}
        className="grid flex-1 grid-cols-7"
        style={{ gridTemplateRows: 'repeat(6, minmax(0, 1fr))', minHeight: MONTH_MIN_ROW_H * 6 }}
      >
        {cells.map((day) => {
          const dateLabel = format(day, 'yyyy-MM-dd')
          const dayEvents = eventsOnDay(events, day)
          // 해당 날 마감 이슈 마커(읽기전용 오버레이)
          const dayDues = issueDuesOnDay(issueDues, day)
          // 일정 먼저, 마감 이슈 다음 순서로 칸 높이만큼만 채우고 넘치면 「+N」(마감 이슈도 포함).
          const { visibleEvents, visibleDues, overflow } = fitMonthCell({
            rowHeight,
            eventCount: dayEvents.length,
            dueCount: dayDues.length,
          })
          const visible = dayEvents.slice(0, visibleEvents)
          const visibleDueMarkers = dayDues.slice(0, visibleDues)
          const inMonth = isSameMonth(day, anchor)
          const today = isToday(day)

          return (
            <div
              key={dateLabel}
              data-testid={`calendar-cell-${dateLabel}`}
              data-move-day={dateLabel}
              data-move-kind="day"
              onClick={() => {
                // 일정을 끌어 옮긴 직후 칸으로 온 click 이면 새 일정을 열지 않는다(WP-1328).
                if (move.consumeClick()) return
                onCreateAt(day)
              }}
              className={`relative border-b border-r p-1 cursor-pointer overflow-hidden select-none ${
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

              {/* 이벤트 칩 (셀 높이만큼) — DECLINED 는 반투명 처리 (이슈 #489) */}
              {/* 끌어 옮기는 일정이 놓일 날 — 칸 전체를 덮는 반투명 테두리와 제목(WP-1328). 칸 안 칩을 밀어내지 않게 겹쳐 그린다. */}
              {movedEvent && eventsOnDay([movedEvent], day).length > 0 && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-end bg-primary/10 p-1 ring-2 ring-inset ring-primary">
                  <MovePreviewChip preview={move.preview} />
                </div>
              )}

              {visible.map((e) => (
                <EventChip
                  key={`${e.id}-${e.occurrenceDate ?? 'single'}`}
                  event={e}
                  testId={`calendar-event-${eventKey(e)}`}
                  dragHandlers={move.bind(e, day, 'day')}
                  moving={isMovingEvent(move.preview, e)}
                  onSelect={(picked) => {
                    // 끌어 옮긴 직후의 click 이면 일정을 열지 않는다.
                    if (move.consumeClick()) return
                    onSelectEvent(picked)
                  }}
                />
              ))}

              {/* 이슈 마감일 칩 (읽기전용, 일정과 구분) — 칸에 들어가는 만큼만 */}
              {visibleDueMarkers.map((m) => (
                <div key={m.issueId} className="mb-0.5">
                  <IssueDueChip marker={m} onSelect={onSelectIssue} />
                </div>
              ))}

              {/* +N — 일정·마감 이슈 칩 다음 맨 끝. 누르면 그날 일정과 마감 이슈 전체를 팝오버로 보인다(WP-1139, WP-1541).
                  칸의 「새 일정」으로 올라가지 않는다 */}
              {overflow > 0 && (
                <MoreEvents
                  day={day}
                  dateLabel={dateLabel}
                  events={dayEvents}
                  dues={dayDues}
                  overflow={overflow}
                  onSelect={onSelectEvent}
                  onSelectIssue={onSelectIssue}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 일정 칩 test id 의 키 — 반복 일정은 회차 날짜까지 붙여 회차마다 다르게 한다. */
function eventKey(e: CalendarEvent) {
  return e.occurrenceDate ? `${e.id}-${e.occurrenceDate}` : e.id
}

/**
 * 월 보기 일정 칩 — 누르면 일정을 연다. 칸 클릭(새 일정)으로 올라가지 않게 막는다.
 * dragHandlers 를 주면 끌어 다른 날로 옮길 수 있고(WP-1328), moving 이면 옮기는 중이라 원래 자리를 흐리게 그린다.
 * +N 팝오버 안의 칩은 끌지 않는다(팝오버가 칸을 덮어 놓을 칸이 보이지 않는다).
 */
function EventChip({
  event: e,
  testId,
  onSelect,
  dragHandlers,
  moving = false,
}: {
  event: CalendarEvent
  testId: string
  onSelect: (e: CalendarEvent) => void
  dragHandlers?: ReturnType<ReturnType<typeof useEventMoveDrag>['bind']>
  moving?: boolean
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      {...dragHandlers}
      onClick={(ev) => {
        ev.stopPropagation()
        onSelect(e)
      }}
      className={`w-full text-left text-xs px-1 py-0.5 mb-0.5 rounded ${resolvePalette(eventDisplayColor(e)).chipClass} truncate block ${e.myRsvpStatus === 'DECLINED' || moving ? 'opacity-40' : ''}`}
    >
      <ExtraTagDots event={e} />
      {e.title}
    </button>
  )
}

/**
 * 칸에 다 못 그린 일정·마감 이슈 「+N」 — 버튼이라 키보드·스크린리더로도 닿고, 누르면 그날 일정과 마감 이슈 전체를 팝오버로 보인다(WP-1139, WP-1541).
 * 팝오버에서 일정·마감 이슈를 고르면 닫고 그 항목을 연다. 팝오버는 포털로 그려지지만 React 이벤트는 칸까지 올라가므로
 * 팝오버 안의 클릭도 막아야 칸의 「새 일정」이 열리지 않는다.
 */
function MoreEvents({
  day,
  dateLabel,
  events,
  dues,
  overflow,
  onSelect,
  onSelectIssue,
}: {
  day: Date
  dateLabel: string
  events: CalendarEvent[]
  dues: IssueDueMarker[]
  overflow: number
  onSelect: (e: CalendarEvent) => void
  onSelectIssue: (m: IssueDueMarker) => void
}) {
  const [open, setOpen] = useState(false)
  // 접근 이름·머리말 — 마감 이슈가 없는 날은 기존 문구 그대로, 있으면 「일정·마감 이슈」 로 부른다.
  const dayLabel = format(day, 'M월 d일')
  const moreLabel = dues.length > 0 ? `${dayLabel} 일정·마감 이슈 ${overflow}개 더 보기` : `${dayLabel} 일정 ${overflow}개 더 보기`
  const headerLabel = [
    events.length > 0 ? `일정 ${events.length}개` : null,
    dues.length > 0 ? `마감 이슈 ${dues.length}개` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`calendar-more-${dateLabel}`}
          aria-label={moreLabel}
          onClick={(ev) => ev.stopPropagation()}
          className="w-full rounded px-1 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          +{overflow}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={16}
        className="w-64 max-w-[calc(100vw-2rem)] p-2"
        data-testid={`calendar-more-popover-${dateLabel}`}
        onClick={(ev) => ev.stopPropagation()}
      >
        <p className="mb-2 px-1 text-xs font-medium text-muted-foreground">{dayLabel} {headerLabel}</p>
        <div className="max-h-72 overflow-y-auto">
          {events.map((e) => (
            <EventChip
              key={`${e.id}-${e.occurrenceDate ?? 'single'}`}
              event={e}
              testId={`calendar-more-event-${eventKey(e)}`}
              onSelect={(picked) => {
                setOpen(false)
                onSelect(picked)
              }}
            />
          ))}
          {dues.map((m) => (
            <div key={m.issueId} className="mb-0.5">
              <IssueDueChip
                marker={m}
                onSelect={(picked) => {
                  setOpen(false)
                  onSelectIssue(picked)
                }}
              />
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
