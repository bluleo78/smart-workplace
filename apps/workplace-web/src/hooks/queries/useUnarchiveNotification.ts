import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { notificationsApi } from '../../api/notifications'
import { notificationKeys } from './notificationKeys'

/**
 * 보관함 줄 하나 되돌리기(WP-1690) — 그 id 만 보관을 풀어 알림 목록으로 돌려보낸다.
 * 성공하면 all 프리픽스로 알림 목록·보관함·안 읽은 수를 함께 무효화한다(되돌린 줄이 보관함에서 사라지고 알림에 나타난다).
 */
export function useUnarchiveNotification() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => notificationsApi.unarchive([id]),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
    onError: () => toast.error('되돌리지 못했습니다'),
  })
}
