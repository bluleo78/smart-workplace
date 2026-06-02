import { useMutation, useQueryClient } from '@tanstack/react-query'

import { notificationsApi } from '../../api/notifications'
import { notificationKeys } from './notificationKeys'

// 읽음 처리 후 목록+카운트 갱신.
export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => notificationsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  })
}
