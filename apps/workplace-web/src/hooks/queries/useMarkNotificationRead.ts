import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { notificationsApi } from '../../api/notifications'
import { notificationKeys } from './notificationKeys'

/**
 * 알림 하나 읽음 처리 — 끝나면(성공·실패 모두) 목록+안 읽은 수를 함께 무효화한다.
 * onSettled 인 이유: 실패나 응답 유실 때도 배지·목록을 서버 값으로 맞춘다.
 * WP-1842: 실패하면 오류 토스트로 알린다(조용히 실패하면 성공으로 오인한다).
 * 홈 알림 위젯은 묶음의 id 마다 따로 부르므로 같은 토스트 id 로 겹쳐 쌓이지 않게 한다.
 */
export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => notificationsApi.markRead(id),
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
    onError: () => toast.error('읽음 처리하지 못했습니다', { id: 'notification-mark-read-error' }),
  })
}
