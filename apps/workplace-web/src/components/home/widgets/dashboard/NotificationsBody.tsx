import { Bell } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { useNotifications } from '@/hooks/queries/useNotifications'
import { useUnreadCount } from '@/hooks/queries/useUnreadCount'

import { WidgetError } from '../WidgetError'

/** 알림 인박스 요약 본문 — 안 읽은 수 + 최근 3건. 프레임/딥링크는 Dashboard 담당. */
export default function NotificationsBody() {
  // 대시보드 위젯은 항상 표시되므로 enabled=true 로 최근 알림을 가져온다.
  const list = useNotifications(true)
  const unread = useUnreadCount()

  if (list.isLoading) return <Skeleton className="h-20 w-full" />
  if (list.isError) return <WidgetError onRetry={() => list.refetch()} testId="dash-notif-error" />

  const items = list.data ?? []
  const unreadCount = unread.data ?? 0

  if (items.length === 0)
    return (
      <div
        className="flex flex-col items-center gap-2 py-6 text-center"
        data-testid="dash-notif-empty"
      >
        <Bell className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">새 알림이 없어요</p>
      </div>
    )

  return (
    <div data-testid="dash-notif">
      <div className="mb-2 text-sm text-muted-foreground">안 읽음 {unreadCount}건</div>
      <ul className="space-y-1">
        {items.slice(0, 3).map((n) => (
          <li key={n.id} className="truncate text-sm">
            <span className={n.read ? 'text-muted-foreground' : 'font-medium'}>
              {n.issueTitle}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
