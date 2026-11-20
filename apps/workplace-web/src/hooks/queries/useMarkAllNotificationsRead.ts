import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { notificationsApi } from '../../api/notifications'
import { notificationKeys } from './notificationKeys'
import { toastNotificationReadError } from './notificationReadError'

/**
 * 「모두 읽음」 — 끝나면(성공·실패 모두) 목록+안 읽은 수를 함께 무효화한다.
 * 성공: 「읽음 처리했습니다」 토스트(WP-1845 — 눌러도 반응이 안 보이던 문제)를 띄우고 무효화 promise 를 그대로 돌려준다 —
 *   InboxList 의 markAllAndRefocus(호출별 onSuccess)가 재조회로 버튼이 비활성이 된 뒤에 포커스를 옮기게.
 * 실패: 무효화 promise 는 돌려주지 않는다(void) — 돌려주면 다시 받기가 끝날 때까지 isPending 이 남아 실패 뒤 바로 다시 누를 수 없다.
 *   실패나 응답 유실(서버는 처리했는데 응답이 끊김) 때도 배지·목록을 서버 값으로 맞추려고 무효화는 한다.
 *   토스트는 개별 읽음과 같은 고정 id 로 두어 연속·동시 실패해도 한 장만 보인다(WP-1842).
 */
export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      toast('읽음 처리했습니다')
      return qc.invalidateQueries({ queryKey: notificationKeys.all })
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.all })
      toastNotificationReadError()
    },
  })
}
