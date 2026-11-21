import { type InfiniteData, useMutation, useMutationState, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { notificationsApi } from '../../api/notifications'
import type { NotificationResponse } from '../../types/notification'
import { notificationKeys } from './notificationKeys'

/**
 * 보관함 줄 하나 되돌리기(WP-1690) — 그 id 만 보관을 풀어 알림 목록으로 돌려보낸다.
 * 성공하면 all 프리픽스로 알림 목록·보관함·안 읽은 수를 함께 무효화한다(되돌린 줄이 보관함에서 사라지고 알림에 나타난다).
 * WP-1845: 줄이 조용히 사라지기만 해 완료를 알 수 없었으므로 「되돌렸습니다」 토스트로 알린다.
 *
 * 성공한 줄은 재조회를 기다리지 않고 보관함 캐시에서 바로 뺀다(WP-1845 리뷰 후속). 재조회에만 맡기면, 뒤 줄의 무효화가 앞 줄의 재조회를
 * 취소했을 때 요청은 끝났는데 줄이 목록에 남아 다시 누를 수 있었다(같은 id 두 번 전송). 빼기 전에 보관함의 진행 중 조회를 취소한다 —
 * 서버 반영 전에 떠난 조회가 늦게 도착해 뺀 줄을 되살리지 않게. 그 뒤 무효화의 재조회는 반영 뒤에 떠나므로 줄을 되살리지 않는다.
 */
export function useUnarchiveNotification() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: notificationKeys.unarchiveMutation(),
    mutationFn: (id: number) => notificationsApi.unarchive([id]),
    onSuccess: async (_data, id) => {
      toast('되돌렸습니다')
      await qc.cancelQueries({ queryKey: notificationKeys.archived() })
      qc.setQueryData<InfiniteData<NotificationResponse[]>>(notificationKeys.archived(), (old) =>
        old ? { ...old, pages: old.pages.map((page) => page.filter((n) => n.id !== id)) } : old,
      )
      return qc.invalidateQueries({ queryKey: notificationKeys.all })
    },
    onError: () => toast.error('되돌리지 못했습니다'),
  })
}

/**
 * 지금 되돌리기 요청이 진행 중인 알림 id 들(WP-1845 리뷰 후속).
 * 뮤테이션 하나의 isPending·variables 는 마지막 호출만 가리켜 여러 줄을 빠르게 누르면 앞 줄 표시가 풀린다 — 그래서 뮤테이션 캐시에서
 * 진행 중인 호출을 모두 읽는다. 캐시에 있으므로 알림 창을 닫았다 다시 열어도(컴포넌트가 다시 마운트돼도) 유지된다.
 * 요청이 성공하면 끝나기 전에(onSuccess) 줄을 보관함 캐시에서 빼므로, 잠금이 풀리는 순간 그 줄은 이미 목록에 없다.
 */
export function useUnarchivingIds(): readonly number[] {
  return useMutationState({
    filters: { mutationKey: notificationKeys.unarchiveMutation(), status: 'pending' },
    select: (m) => m.state.variables as number,
  })
}
