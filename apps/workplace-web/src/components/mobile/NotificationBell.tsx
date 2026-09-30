// 모바일 헤더 알림 벨 — 알림을 탭 대신 헤더에 둔다(탭바 5칸 대칭 유지, 스펙 2절). 클릭 → /notifications.
import { Bell } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { useUnreadCount } from '@/hooks/queries/useUnreadCount'

/** 안읽음 수 배지가 붙은 헤더 우측 벨 버튼. 배지는 99 초과 시 '99+' 로 축약한다. */
export function NotificationBell() {
  const navigate = useNavigate()
  const { data: unread = 0 } = useUnreadCount()
  return (
    <button
      type="button"
      data-testid="mobile-bell"
      aria-label={unread > 0 ? `알림, 읽지 않음 ${unread}` : '알림'}
      onClick={() => navigate('/notifications')}
      className="relative flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground"
    >
      <Bell className="h-5 w-5" />
      {unread > 0 && (
        <span data-testid="mobile-bell-badge" className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-destructive px-1 text-[9px] leading-4 text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  )
}
