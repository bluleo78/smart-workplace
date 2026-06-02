import { useQuery } from '@tanstack/react-query'

import { notificationsApi } from '../../api/notifications'
import { notificationKeys } from './notificationKeys'

// 패널이 열려 있을 때만(enabled) 최근 20건을 가져온다.
export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: notificationKeys.list(),
    queryFn: () => notificationsApi.list(20),
    enabled,
    staleTime: 10_000,
  })
}
