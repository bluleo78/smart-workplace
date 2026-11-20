import { useMutation, useQueryClient } from '@tanstack/react-query'

import { notificationsApi } from '../../api/notifications'
import { notificationKeys } from './notificationKeys'
import { toastNotificationReadError } from './notificationReadError'

/**
 * 「모두 읽음」 — 끝나면(성공·실패 모두) 목록+안 읽은 수를 함께 무효화한다.
 * onSettled 인 이유: 실패나 응답 유실(서버는 처리했는데 응답이 끊김) 때도 배지·목록을 서버 값으로 맞춘다.
 * 무효화 약속은 돌려주지 않는다(void) — 돌려주면 다시 받기가 끝날 때까지 isPending 이 남아 실패 뒤 「모두 읽음」을 바로 다시 누를 수 없다.
 * 토스트는 개별 읽음과 같은 고정 id 로 두어 연속·동시 실패해도 한 장만 보인다.
 * WP-1842: 실패하면 배지·목록이 그대로라 사용자가 성공으로 오인했다 — 보관(「보관하지 못했습니다」)과 같은 오류 토스트로 알린다.
 */
export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.all })
    },
    onError: toastNotificationReadError,
  })
}
