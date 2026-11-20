import { useMutation, useQueryClient } from '@tanstack/react-query'

import { notificationsApi } from '../../api/notifications'
import { notificationKeys } from './notificationKeys'
import { toastNotificationReadError } from './notificationReadError'

/**
 * 알림 하나 읽음 처리 — 끝나면(성공·실패 모두) 목록+안 읽은 수를 함께 무효화한다.
 * onSettled 인 이유: 실패나 응답 유실 때도 배지·목록을 서버 값으로 맞춘다. 무효화 약속은 돌려주지 않는다(isPending 을 붙잡지 않게).
 * WP-1842: 실패하면 오류 토스트로 알린다(조용히 실패하면 성공으로 오인한다).
 * 홈 알림 위젯은 묶음의 id 마다 따로 부르므로 「모두 읽음」과 같은 토스트 id 로 겹쳐 쌓이지 않게 한다.
 */
export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => notificationsApi.markRead(id),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.all })
    },
    onError: toastNotificationReadError,
  })
}
