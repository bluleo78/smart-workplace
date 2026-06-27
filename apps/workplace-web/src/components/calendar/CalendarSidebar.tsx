// 캘린더 2차 사이드바 — 미니 캘린더 + 개인 캘린더별 토글 + 기타(이슈 마감/초대 일정) 토글.
import { CalendarDays, Pencil, Plus } from 'lucide-react'

import { sidebarTitleClass } from '@/components/layout/sidebar-link'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Checkbox } from '@/components/ui/checkbox'
import { type CalendarLayers,isCalendarVisible } from '@/lib/calendar'
import { resolvePalette } from '@/lib/calendarPalette'
import type { Calendar as CalendarType } from '@/types/calendar'

interface CalendarSidebarProps {
  onNew: () => void
  /** 미니 캘린더 선택일/표시 월 = 본문 anchor. */
  anchor: Date
  /** 미니 캘린더에서 날짜/월 선택 시 본문 anchor 이동. */
  onSelectDate: (date: Date) => void
  /** 사이드바 표시 레이어 상태. */
  layers: CalendarLayers
  /** issueDues / invited 토글 변경. */
  onToggleLayer: (key: keyof Pick<CalendarLayers, 'issueDues' | 'invited'>, value: boolean) => void
  /** 내 캘린더 목록. */
  calendars: CalendarType[]
  /** 캘린더별 표시 토글. */
  onToggleCalendar: (id: number) => void
  /** 새 캘린더 추가 다이얼로그 열기. */
  onAddCalendar: () => void
  /** 캘린더 편집 다이얼로그 열기. */
  onEditCalendar: (c: CalendarType) => void
  /** 일정/마감이 있어 점(dot)을 찍을 날짜들. */
  markedDates: Date[]
}

/** 캘린더 2차 사이드바 — 타이틀 + 새 일정 + 미니 캘린더 + 캘린더별 토글 + 기타 토글. */
export function CalendarSidebar({
  onNew,
  anchor,
  onSelectDate,
  layers,
  onToggleLayer,
  calendars,
  onToggleCalendar,
  onAddCalendar,
  onEditCalendar,
  markedDates,
}: CalendarSidebarProps) {
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
            hasItems:
              'day-has-items relative after:absolute after:bottom-0.5 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-primary',
          }}
        />
      </div>

      {/* 내 캘린더 그룹 — 캘린더별 체크박스 토글 */}
      <div className="mt-2 px-3 pb-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            내 캘린더
          </span>
          {/* 새 캘린더 추가 버튼 */}
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            data-testid="calendar-add"
            aria-label="캘린더 추가"
            onClick={onAddCalendar}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        {calendars.map((c) => {
          const palette = resolvePalette(c.color)
          const visible = isCalendarVisible(layers, c.id)
          return (
            <div
              key={c.id}
              data-testid={`calendar-list-item-${c.id}`}
              className="group mb-1 flex cursor-pointer items-center gap-2 text-sm"
            >
              <Checkbox
                data-testid={`calendar-toggle-${c.id}`}
                checked={visible}
                onCheckedChange={() => onToggleCalendar(c.id)}
                aria-label={`캘린더 표시: ${c.name}`}
              />
              {/* 캘린더 색 점 */}
              <span className={`size-2.5 shrink-0 rounded-sm ${palette.dotClass}`} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {/* 편집 버튼 — hover 시만 노출 */}
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100"
                data-testid={`calendar-edit-${c.id}`}
                aria-label={`${c.name} 편집`}
                onClick={(e) => {
                  e.stopPropagation()
                  onEditCalendar(c)
                }}
              >
                <Pencil className="h-3 w-3" />
              </Button>
            </div>
          )
        })}
      </div>

      {/* 기타 그룹 — 이슈 마감일 + 초대받은 일정 */}
      <div className="px-3 pb-4">
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          기타
        </div>
        <label className="mb-1.5 flex cursor-pointer items-center gap-2 text-sm">
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
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            data-testid="calendar-layer-invited"
            checked={layers.invited}
            onCheckedChange={(v) => onToggleLayer('invited', v === true)}
            aria-label="초대받은 일정"
          />
          {/* 초대받은 일정 = 회색 점 */}
          <span className="size-2.5 shrink-0 rounded-sm bg-muted-foreground/50" aria-hidden="true" />
          초대받은 일정
        </label>
      </div>
    </aside>
  )
}
