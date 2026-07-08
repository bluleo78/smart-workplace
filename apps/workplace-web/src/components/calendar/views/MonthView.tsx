// 월간 뷰 — 7열 × 6행(42칸) 달력 그리드.
// monthMatrix()로 일요일 시작 6주를 생성한다.
import { format, isSameMonth, isToday } from 'date-fns'
import { useLayoutEffect, useRef, useState } from 'react'

import { IssueDueChip } from '@/components/calendar/IssueDueChip'
import { eventsOnDay, issueDuesOnDay, monthMatrix } from '@/lib/calendar'
import { resolvePalette } from '@/lib/calendarPalette'

import type { ViewProps } from './TimeGrid'

// 요일 헤더 (일~토)
const WEEK_DAYS = ['일', '월', '화', '수', '목', '금', '토']

// 셀 레이아웃 상수(px) — 용량 계산용. 실제 Tailwind 클래스와 맞춰 조정.
const HEADER_H = 32 // 날짜 숫자 원형(h-6=24) + mb-1(4) + p-1 top(4)
const CHIP_H = 22 // 이벤트 칩 1개(text-xs + py-0.5 + mb-0.5)
const OVERFLOW_H = 18 // +N 표시 줄
const FALLBACK_FIT = 3 // 측정 전 초기값

// 월간 뷰 컴포넌트
export function MonthView({ events, issueDues, anchor, onSelectEvent, onSelectIssue, onCreateAt }: ViewProps) {
  // anchor 기준 42칸 날짜 배열
  const cells = monthMatrix(anchor)

  // 6행이 모두 1fr 균등 높이이므로 그리드 높이/6 = 한 셀 높이.
  // ResizeObserver 로 셀 높이를 재서 셀별 이벤트 표시 개수 계산에 사용한다.
  const gridRef = useRef<HTMLDivElement>(null)
  const [rowHeight, setRowHeight] = useState(0)
  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el) return
    const update = () => setRowHeight(el.clientHeight / 6)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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
      <div ref={gridRef} className="grid grid-cols-7 flex-1" style={{ gridTemplateRows: 'repeat(6, 1fr)' }}>
        {cells.map((day) => {
          const dateLabel = format(day, 'yyyy-MM-dd')
          const dayEvents = eventsOnDay(events, day)
          // 해당 날 마감 이슈 마커(읽기전용 오버레이) — 이벤트 아래에 항상 렌더되므로
          // 그만큼 세로 공간을 먼저 예약한 뒤 이벤트 표시 개수를 계산한다(마커가 잘려 사라지는 회귀 방지).
          const dayDues = issueDuesOnDay(issueDues, day)
          // 셀 높이만큼 이벤트를 채우되, 마감 마커 예약분을 뺀 공간 안에서만 채우고 넘치면 +N.
          const availForEvents = rowHeight - HEADER_H - dayDues.length * CHIP_H
          let maxVisible: number
          if (rowHeight <= 0) {
            maxVisible = FALLBACK_FIT // 측정 전 초기 렌더
          } else {
            const fitNoOverflow = Math.floor(availForEvents / CHIP_H)
            // 넘치면 +N 줄이 한 칸을 먹으므로 그만큼 줄여 재계산.
            maxVisible =
              dayEvents.length > fitNoOverflow
                ? Math.floor((availForEvents - OVERFLOW_H) / CHIP_H)
                : fitNoOverflow
            maxVisible = Math.max(1, maxVisible) // 최소 1건은 보장
          }
          const visible = dayEvents.slice(0, maxVisible)
          const overflow = dayEvents.length - visible.length
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

              {/* 이벤트 칩 (셀 높이만큼) — DECLINED 는 반투명 처리 (이슈 #489) */}
              {visible.map((e) => (
                <button
                  key={`${e.id}-${e.occurrenceDate ?? 'single'}`}
                  data-testid={`calendar-event-${e.occurrenceDate ? `${e.id}-${e.occurrenceDate}` : e.id}`}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    onSelectEvent(e)
                  }}
                  className={`w-full text-left text-xs px-1 py-0.5 mb-0.5 rounded ${resolvePalette(e.effectiveColor).chipClass} truncate block ${e.myRsvpStatus === 'DECLINED' ? 'opacity-40' : ''}`}
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
