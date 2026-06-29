// src/components/layout/InboxPanel.tsx
// 인박스 — AppRail 하단 종 아이콘 + 안읽음 배지 + Popover 평면 목록.
// 행 클릭 → 이슈 상세 이동 + 읽음 처리. 헤더 "모두 읽음".
import { Bell } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { useInboxPanel } from '@/components/layout/InboxContext'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useMarkAllNotificationsRead } from '@/hooks/queries/useMarkAllNotificationsRead'
import { useMarkNotificationRead } from '@/hooks/queries/useMarkNotificationRead'
import { useNotifications } from '@/hooks/queries/useNotifications'
import { useUnreadCount } from '@/hooks/queries/useUnreadCount'
import { formatDateTimeMinute, formatRelativeTime } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import type { NotificationResponse } from '@/types/notification'

// 알림 종류별 동작 문구(액터명 뒤에 붙는다).
const ACTION_LABEL: Record<NotificationResponse['type'], string> = {
  ASSIGNED: '님이 회원님을 배정했습니다',
  COMMENTED: '님이 코멘트를 남겼습니다',
  STATUS_CHANGED: '님이 상태를 변경했습니다',
  // REMINDER 는 액터가 없어 별도 분기로 렌더(아래 onRowClick/목록 참조).
  REMINDER: '일정 알림',
}

export function InboxPanel({ expanded = false }: { expanded?: boolean }) {
  // 오픈 상태는 컨텍스트 공유 — 합성 레이어 '멘션' 셀 등 외부에서도 패널을 열 수 있다.
  const { open, setOpen } = useInboxPanel()
  const navigate = useNavigate()
  const { data: unread = 0 } = useUnreadCount()
  const { data: items = [], isLoading } = useNotifications(open)
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()

  // 행 클릭: 안읽음이면 읽음 처리 → 패널 닫고 대상으로 이동.
  // REMINDER 는 일정 알림이므로 캘린더로, 그 외 이슈 타입은 이슈 상세로.
  const onRowClick = (n: NotificationResponse) => {
    if (!n.read) markRead.mutate(n.id)
    setOpen(false)
    if (n.type === 'REMINDER') {
      navigate('/calendar')
    } else if (n.projectKey && n.issueNumber != null) {
      navigate(`/projects/${n.projectKey}/issues/${n.issueNumber}`)
    }
  }

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
                {unread > 0 && (
                  <span
                    data-testid="inbox-badge"
                    className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold leading-none text-destructive-foreground"
                  >
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
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
      <PopoverContent side="right" align="end" className="w-80 p-0" data-testid="inbox-panel">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">알림</span>
          <button
            type="button"
            data-testid="inbox-mark-all"
            onClick={() => markAll.mutate()}
            // 알림 없거나 모두 읽음 상태이거나 처리 중이면 비활성화
            disabled={items.length === 0 || unread === 0 || markAll.isPending}
            className="text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            모두 읽음
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {isLoading ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">불러오는 중…</p>
          ) : items.length === 0 ? (
            // 빈 상태: 아이콘 + 제목 + 설명 (디자인 시스템 §2.5 Empty State 4요소)
            <div
              data-testid="inbox-empty"
              className="flex flex-col items-center gap-2 px-3 py-8 text-center text-muted-foreground"
            >
              <Bell className="h-8 w-8 opacity-30" />
              <p className="text-sm font-medium">새 알림이 없습니다</p>
              <p className="text-xs">이슈 배정, 코멘트, 상태 변경 알림이 여기에 표시됩니다.</p>
            </div>
          ) : (
            <ul>
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    data-testid="inbox-item"
                    onClick={() => onRowClick(n)}
                    className={cn(
                      'flex w-full items-start gap-2 border-b px-3 py-2 text-left text-sm hover:bg-accent/50',
                      !n.read && 'bg-accent/20',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      {n.type === 'REMINDER' ? (
                        // 일정 알림 — 액터 없이 일정 제목 + 시작 시각 표시.
                        <>
                          <span className="font-medium">일정 알림</span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {n.eventTitle} · {formatDateTimeMinute(n.eventStartsAt)}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="font-medium">{n.actorName ?? '시스템'}</span>
                          {n.actorKind === 'AGENT' && (
                            <span className="ml-1 rounded bg-primary/10 px-1 text-xs text-primary">
                              AI
                            </span>
                          )}
                          <span className="text-muted-foreground">{ACTION_LABEL[n.type]}</span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {n.projectKey}-{n.issueNumber} {n.issueTitle}
                          </span>
                        </>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatRelativeTime(n.createdAt)}
                    </span>
                    {!n.read && (
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
