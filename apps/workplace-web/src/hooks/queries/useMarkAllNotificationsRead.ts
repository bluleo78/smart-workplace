import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { notificationsApi } from '../../api/notifications'
import { notificationKeys } from './notificationKeys'

/**
 * 「모두 읽음」 — 성공하면 목록+안 읽은 수를 함께 무효화한다.
 * WP-1842: 실패하면 배지·목록이 그대로라 사용자가 성공으로 오인했다 — 보관(「보관하지 못했습니다」)과 같은 오류 토스트로 알린다.
 */
export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
    onError: () => toast.error('읽음 처리하지 못했습니다'),
  })
}
