// 캘린더 2차 사이드바 — 미니 캘린더 + 개인 캘린더별 토글 + 기타(이슈 마감/초대 일정) 토글.
import { CalendarDays, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'

import { CalendarTagSection } from '@/components/calendar/CalendarTagSection'
import { miniCalendarDotClass } from '@/components/calendar/miniCalendarClass'
import { sidebarTitleClass } from '@/components/layout/sidebar-link'
import { useCloseSheetAfterMenu } from '@/components/mobile/MobileSidebarSheetContext'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Checkbox } from '@/components/ui/checkbox'
import {
  type CalendarLayers,
  groupCalendarsBySource,
  isCalendarVisible,
  providerLabel,
} from '@/lib/calendar'
import { resolvePalette } from '@/lib/calendarPalette'
import { HIT_AREA_COARSE, HIT_AREA_COARSE_TIGHT } from '@/lib/hitArea'
import type { Calendar as CalendarType, CalendarTag } from '@/types/calendar'

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
  /** 새 태그 만들기 다이얼로그 열기. */
  onAddTag: () => void
  /** 태그 이름·색 바꾸기 다이얼로그 열기. */
  onEditTag: (tag: CalendarTag) => void
  /** 태그 지우기 확인 흐름 시작. */
  onDeleteTag: (tag: CalendarTag) => void
  /** 태그 구독 주소 창 열기. */
  onOpenTagFeed: (tag: CalendarTag) => void
  /** 일정/마감이 있어 점(dot)을 찍을 날짜들. */
  markedDates: Date[]
  /**
   * 미니 캘린더 숨김 — 모바일 ☰ 시트 전용(WP-136). 모바일은 날짜 이동을 헤더 제목 버튼의 미니 달력이 맡아,
   * 시트에는 [새 일정]과 캘린더 토글만 남겨 스크롤 없이 한 번에 보이게 한다. 데스크톱 사이드바는 기본값(표시) 그대로.
   */
  hideMiniCalendar?: boolean
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
  onAddTag,
  onEditTag,
  onDeleteTag,
  onOpenTagFeed,
  markedDates,
  hideMiniCalendar = false,
}: CalendarSidebarProps) {
  // 모바일 시트 안에서 시트 밖 다이얼로그를 여는 동작은 시트를 닫는다 — 남으면 다이얼로그를 닫은 뒤에도 본문을 덮는다(WP-578).
  // 버튼은 data-sheet-dismiss, ⋯ 메뉴 항목은 메뉴가 닫힌 뒤 닫는다. 캘린더·레이어 토글은 시트 안에서 이어 고르므로 둔다.
  const rowMenu = useCloseSheetAfterMenu()
  return (
    <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r bg-sidebar/40">
      <div className={sidebarTitleClass}>
        <CalendarDays className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
        캘린더
      </div>
      <div className="p-3">
        <Button data-testid="calendar-new-event" className="w-full gap-1" data-sheet-dismiss onClick={onNew}>
          <Plus className="h-4 w-4" /> 새 일정
        </Button>
      </div>

      {/* 미니 월 캘린더 — 선택일=anchor, 날짜/월 선택 시 본문 날짜 이동(양방향). 모바일 시트에선 숨김(헤더 미니 달력이 대신). */}
      {!hideMiniCalendar && (
        <div data-testid="calendar-mini">
          <Calendar
            mode="single"
            selected={anchor}
            month={anchor}
            onSelect={(d) => d && onSelectDate(d)}
            onMonthChange={onSelectDate}
            className="w-full px-2 pb-2 [--cell-size:1.75rem]"
            modifiers={{ hasItems: markedDates }}
            modifiersClassNames={{ hasItems: miniCalendarDotClass }}
          />
        </div>
      )}

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
              className="group mb-1 flex items-center gap-2 text-sm"
            >
              {/* 체크박스·색 점·이름을 label 로 묶어 이름을 눌러도 토글된다(기타 그룹 행과 같은 구조) — 전엔 16px 체크박스만 눌렸다.
                  세로로 행을 채워(self-stretch) 모바일 ☰ 시트의 44px 행 전체가 탭 영역이 된다. 케밥·배지는 label 밖(중첩 상호작용 방지). */}
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 self-stretch">
                <Checkbox
                  // label 왼쪽 끝에 붙은 16px 체크박스 — 터치에서 왼쪽으로도 눌리게 넓힌다(WP-734).
                  className={HIT_AREA_COARSE_TIGHT}
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
              </label>
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
                /* 케밥(⋯) 메뉴 — hover 시만 노출(터치 기기는 상시, WP-237). 편집 + (로컬 한정)모든 일정 삭제 */
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      // focus-visible 노출 추가(키보드 포커스 시 opacity-0로 완전 비가시 상태였음) +
                      // 24x24 최소 터치 타겟(WCAG 2.5.8) 충족을 위해 h-6 w-6로 상향(#709).
                      // 터치 기기(pointer: coarse)는 hover 가 없으므로 상시 노출 + 44px 터치 영역(WP-237).
                      className="h-6 w-6 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 pointer-coarse:size-11 pointer-coarse:opacity-100"
                      data-testid={`calendar-menu-${c.id}`}
                      aria-label={`${c.name} 메뉴`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onCloseAutoFocus={rowMenu.onCloseAutoFocus}>
                    <DropdownMenuItem
                      data-testid={`calendar-edit-${c.id}`}
                      onClick={() => {
                        rowMenu.closeAfterMenu()
                        onEditCalendar(c)
                      }}
                    >
                      <Pencil className="mr-2 h-3.5 w-3.5" /> 편집
                    </DropdownMenuItem>
                    {/* 로컬 캘린더(accountEmail 없음)만 일정 일괄 삭제 허용 */}
                    {!c.accountEmail && (
                      <DropdownMenuItem
                        data-testid={`calendar-reset-${c.id}`}
                        className="text-destructive focus:text-destructive"
                        onClick={() => {
                          rowMenu.closeAfterMenu()
                          onResetCalendar(c)
                        }}
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
                  // 20px 버튼 — 터치에서는 눌림 영역만 넓힌다(WP-734).
                  className={`h-5 w-5 ${HIT_AREA_COARSE}`}
                  data-testid="calendar-add"
                  aria-label="캘린더 추가"
                  data-sheet-dismiss
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

      {/* 태그 — 일정에 붙인 내 분류(Outlook 범주 포함). 걸러 보기는 없고 관리만(WP-714) */}
      <CalendarTagSection
        onAddTag={onAddTag}
        onEditTag={onEditTag}
        onDeleteTag={onDeleteTag}
        onOpenTagFeed={onOpenTagFeed}
        hasLinkedAccount={calendars.some((c) => !!c.accountEmail)}
      />

      {/* 기타 그룹 — 이슈 마감일 + 초대받은 일정 */}
      <div className="px-3 pb-4">
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          기타
        </div>
        <label className="mb-1.5 flex cursor-pointer items-center gap-2 text-sm">
          {/* 줄 높이 20px 라 체크박스 눌림 영역을 터치에서 24px 로 넓힌다(WP-734). */}
          <Checkbox
            className={HIT_AREA_COARSE_TIGHT}
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
            className={HIT_AREA_COARSE_TIGHT}
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
