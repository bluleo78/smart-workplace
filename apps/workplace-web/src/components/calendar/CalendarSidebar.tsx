// 캘린더 2차 사이드바 — 미니 캘린더 + 개인 캘린더별 토글 + 기타(이슈 마감/초대 일정) 토글.
import { CalendarDays, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'

import { sidebarTitleClass } from '@/components/layout/sidebar-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  type CalendarLayers,
  groupCalendarsBySource,
  isCalendarVisible,
  providerLabel,
} from '@/lib/calendar'
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
  /** 캘린더 모든 일정 삭제(강제 리셋) 확인 흐름 시작. */
  onResetCalendar: (c: CalendarType) => void
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
  onResetCalendar,
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

      {/* 캘린더 목록 — 로컬("내 캘린더") + 계정별 연동 섹션으로 그룹핑 */}
      {(() => {
        const { local, accounts } = groupCalendarsBySource(calendars)
        // 캘린더 1행 — 체크박스 + 색 점 + 이름 + (읽기전용 배지 | hover 편집). 로컬·연동 공용.
        const renderItem = (c: CalendarType) => {
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
              <span
                className={`size-2.5 shrink-0 rounded-sm ${palette.dotClass}`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {/* 외부 동기화 캘린더: 읽기전용 배지 표시, 케밥 메뉴 숨김 (이슈 #501) */}
              {c.isReadOnly ? (
                <Badge
                  variant="secondary"
                  className="h-4 shrink-0 px-1 text-[10px]"
                  data-testid="calendar-readonly-badge"
                >
                  읽기 전용
                </Badge>
              ) : (
                /* 케밥(⋯) 메뉴 — hover 시만 노출. 편집 + (로컬 한정)모든 일정 삭제 */
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      // focus-visible 노출 추가(키보드 포커스 시 opacity-0로 완전 비가시 상태였음) +
                      // 24x24 최소 터치 타겟(WCAG 2.5.8) 충족을 위해 h-6 w-6로 상향(#709).
                      className="h-6 w-6 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                      data-testid={`calendar-menu-${c.id}`}
                      aria-label={`${c.name} 메뉴`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      data-testid={`calendar-edit-${c.id}`}
                      onClick={() => onEditCalendar(c)}
                    >
                      <Pencil className="mr-2 h-3.5 w-3.5" /> 편집
                    </DropdownMenuItem>
                    {/* 로컬 캘린더(accountEmail 없음)만 일정 일괄 삭제 허용 */}
                    {!c.accountEmail && (
                      <DropdownMenuItem
                        data-testid={`calendar-reset-${c.id}`}
                        className="text-destructive focus:text-destructive"
                        onClick={() => onResetCalendar(c)}
                      >
                        <Trash2 className="mr-2 h-3.5 w-3.5" /> 모든 일정 삭제
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )
        }

        return (
          <>
            {/* 내 캘린더(로컬) 섹션 */}
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
              {local.map(renderItem)}
            </div>

            {/* 계정별 연동 섹션 — 헤더: 이메일(일반 표기) + 공급자 회색 pill */}
            {accounts.map((acct) => (
              <div
                key={acct.email}
                data-testid={`calendar-account-section-${acct.email}`}
                className="border-t px-3 pb-2 pt-2"
              >
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground">
                    {acct.email}
                  </span>
                  {/* 공급자 pill — "읽기 전용" 배지와 동일 톤 */}
                  <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">
                    {providerLabel(acct.provider)}
                  </Badge>
                </div>
                {acct.calendars.map(renderItem)}
              </div>
            ))}
          </>
        )
      })()}

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
