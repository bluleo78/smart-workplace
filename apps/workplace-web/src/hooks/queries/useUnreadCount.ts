import { useQuery } from '@tanstack/react-query'

import { notificationsApi } from '../../api/notifications'
import { notificationKeys } from './notificationKeys'

// 배지용 안읽음 수. 앱 셸에서 상시 구독.
export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: () => notificationsApi.unreadCount(),
    staleTime: 30_000,
  })
}
