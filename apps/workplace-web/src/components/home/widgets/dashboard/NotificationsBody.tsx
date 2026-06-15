import { Bell } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { useNotifications } from '@/hooks/queries/useNotifications'
import { useUnreadCount } from '@/hooks/queries/useUnreadCount'

import { notifLabel, notifTarget } from '../../notifTarget'
import { WidgetError } from '../WidgetError'

/** 알림 인박스 요약 본문 — 안 읽은 수 + 최근 3건. 프레임/딥링크는 Dashboard 담당. */
export default function NotificationsBody({ count = 5 }: { count?: number }) {
  // 대시보드 위젯은 항상 표시되므로 enabled=true 로 최근 알림을 가져온다.
  const list = useNotifications(true)
  const unread = useUnreadCount()

  // I3(a11y): 로딩 영역에 aria-busy + 라벨.
  if (list.isLoading)
    return (
      <div aria-busy="true" aria-label="불러오는 중">
        <Skeleton className="h-20 w-full" />
      </div>
    )
  if (list.isError) return <WidgetError onRetry={() => list.refetch()} testId="dash-notif-error" />

  const items = list.data ?? []
  const unreadCount = unread.data ?? 0

  if (items.length === 0)
    return (
      <div
        // I3(a11y): 빈 상태 role="status".
        role="status"
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
      <ul className="space-y-0.5">
        {items.slice(0, count).map((n) => (
          // 행 클릭/Enter → 알림 대상(이슈 상세/캘린더)으로 이동.
          <li key={n.id}>
            <Link
              to={notifTarget(n)}
              aria-label={`알림 열기: ${notifLabel(n)}`}
              className="flex min-h-6 items-center rounded px-1 py-1 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className={`truncate ${n.read ? 'text-muted-foreground' : 'font-medium'}`}>
                {notifLabel(n)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
