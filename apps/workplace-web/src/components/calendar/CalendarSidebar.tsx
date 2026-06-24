import { CalendarDays, Plus } from 'lucide-react'

import { sidebarTitleClass } from '@/components/layout/sidebar-link'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Checkbox } from '@/components/ui/checkbox'
import type { CalendarLayers } from '@/lib/calendar'

interface CalendarSidebarProps {
  onNew: () => void
  // 미니 캘린더 선택일/표시 월 = 본문 anchor.
  anchor: Date
  // 미니 캘린더에서 날짜/월 선택 시 본문 anchor 이동.
  onSelectDate: (date: Date) => void
  // 본문에 겹쳐 보일 레이어 표시 상태.
  layers: CalendarLayers
  // 레이어 토글 변경.
  onToggleLayer: (key: keyof CalendarLayers, value: boolean) => void
  // 일정/마감이 있어 점(dot)을 찍을 날짜들.
  markedDates: Date[]
}

/** 캘린더 2차 사이드바 — 타이틀 + 새 일정 + 미니 캘린더 + 표시 레이어 토글. */
export function CalendarSidebar({ onNew, anchor, onSelectDate, layers, onToggleLayer, markedDates }: CalendarSidebarProps) {
  return (
    <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r bg-sidebar/40">
      <div className={sidebarTitleClass}>
        <CalendarDays className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
        캘린더
      </div>
      <div className="p-3">
        <Button data-testid="calendar-new-event" className="w-full gap-1" onClick={onNew}>
          <Plus className="h-4 w-4" /> 새 일정
        </Button>
      </div>

      {/* 미니 월 캘린더 — 선택일=anchor, 날짜/월 선택 시 본문 날짜 이동(양방향). */}
      {/* DayPicker 루트의 data-testid forward 가 불확실하므로 div 로 감싼다. */}
      {/* --cell-size 축소 + 좌우 패딩 최소화 → 7열 그리드가 w-56 사이드바 안에 안 잘리고 들어감(토요일 열 클리핑 방지). */}
      <div data-testid="calendar-mini">
        <Calendar
          mode="single"
          selected={anchor}
          month={anchor}
          onSelect={(d) => d && onSelectDate(d)}
          onMonthChange={onSelectDate}
          className="w-full px-2 pb-2 [--cell-size:1.75rem]"
          modifiers={{ hasItems: markedDates }}
          modifiersClassNames={{
            // day-has-items = E2E 셀렉트용 안정 토큰. after:* = 날짜 숫자 아래 primary 점.
            hasItems:
              'day-has-items relative after:absolute after:bottom-0.5 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-primary',
          }}
        />
      </div>

      {/* 표시 토글 — 본문에 겹쳐 보일 레이어 on/off. 색상 점은 본문 마커와 톤 일치. */}
      <div className="mt-2 px-3 pb-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          표시
        </div>
        <label className="mb-1.5 flex cursor-pointer items-center gap-2 text-sm">
          {/* Radix Checkbox는 button으로 렌더되므로 명시적 aria-label로 접근성 이름 보장. */}
          <Checkbox
            data-testid="calendar-layer-events"
            checked={layers.events}
            onCheckedChange={(v) => onToggleLayer('events', v === true)}
            aria-label="내 일정"
          />
          {/* 일정 = solid bg-primary 마커와 동일 */}
          <span className="size-2.5 shrink-0 rounded-sm bg-primary" aria-hidden="true" />
          내 일정
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          {/* Radix Checkbox는 button으로 렌더되므로 명시적 aria-label로 접근성 이름 보장. */}
          <Checkbox
            data-testid="calendar-layer-issue-dues"
            checked={layers.issueDues}
            onCheckedChange={(v) => onToggleLayer('issueDues', v === true)}
            aria-label="내 이슈 마감일"
          />
          {/* 이슈 마감일 = 점선 아웃라인 칩과 동일 톤 */}
          <span className="size-2.5 shrink-0 rounded-sm border border-dashed border-primary/60" aria-hidden="true" />
          내 이슈 마감일
        </label>
      </div>
    </aside>
  )
}
