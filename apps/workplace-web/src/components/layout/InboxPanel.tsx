// src/components/layout/InboxPanel.tsx
// 인박스 — AppRail 하단 종 아이콘 + 안읽음 배지 + Popover 평면 목록.
// 행 클릭 → 이슈 상세 이동 + 읽음 처리. 헤더 "모두 읽음". 무한스크롤(#610)로 20건 상한 해소.
import { Bell } from 'lucide-react'

import { CountBadge } from '@/components/CountBadge'
import { useInboxPanel } from '@/components/layout/InboxContext'
import { InboxList } from '@/components/layout/InboxList'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useUnreadCount } from '@/hooks/queries/useUnreadCount'
import { cn } from '@/lib/utils'

export function InboxPanel({ expanded = false }: { expanded?: boolean }) {
  // 오픈 상태는 컨텍스트 공유 — 합성 레이어 '멘션' 셀 등 외부에서도 패널을 열 수 있다.
  const { open, setOpen } = useInboxPanel()
  const { data: unread = 0 } = useUnreadCount()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="알림"
              data-testid="inbox-trigger"
              className={cn(
                // 데스크톱: pl-[10px] 고정으로 아이콘 위치 불변(NavLink와 동일 좌표). 모바일: px-3 py-2.
                'relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-muted-foreground transition-all duration-200 hover:bg-accent/50 hover:text-accent-foreground',
                'lg:pl-[10px] lg:pr-2',
              )}
            >
              <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
                <Bell className="h-5 w-5" />
                <CountBadge
                  count={unread}
                  data-testid="inbox-badge"
                  className="absolute -right-1.5 -top-1.5"
                />
              </span>
              <span
                className={cn(
                  'overflow-hidden whitespace-nowrap text-sm font-medium transition-[max-width,opacity] duration-200',
                  expanded ? 'lg:max-w-[100px] lg:opacity-100' : 'lg:max-w-0 lg:opacity-0',
                )}
              >
                알림
              </span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        {/* 축소 시에만 hover 툴팁(확장 시엔 라벨이 직접 보임). */}
        {!expanded && (
          <TooltipContent side="right" sideOffset={8} className="hidden lg:block">
            알림
          </TooltipContent>
        )}
      </Tooltip>
      {/* Radix PopoverContent는 role=dialog를 부여하지만 accessible name은 직접 지정해야 함(#698). */}
      <PopoverContent side="right" align="end" className="w-80 p-0" data-testid="inbox-panel" aria-label="알림">
        {/* 목록부는 모바일 /notifications 와 공유(InboxList) — open 일 때만 조회. */}
        <InboxList enabled={open} onNavigate={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}
