import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { notificationsApi } from '../../api/notifications'
import { notificationKeys } from './notificationKeys'

/**
 * 「읽은 알림 보관」(WP-1689) — 확인 창 없이 바로 보관하고 「보관했습니다 · 되돌리기」 토스트를 띄운다.
 * 데스크톱 알림 창과 모바일 /notifications 머리가 같은 동작을 쓰도록 토스트까지 훅 안에 둔다.
 * 되돌리기는 지금 캐시가 아니라 이 요청의 응답(archivedIds)으로 한다 — 그 사이 새로 읽은 알림까지 되살리지 않게.
 * 보관·되돌리기 뒤에는 목록과 안 읽은 수를 함께 무효화한다(같은 all 프리픽스).
 */
export function useArchiveReadNotifications() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: notificationKeys.all })
  return useMutation({
    mutationFn: () => notificationsApi.archiveRead(),
    onSuccess: ({ archivedIds }) => {
      void invalidate()
      // 다른 탭이 먼저 보관해 실제로 보관된 것이 없으면 되돌릴 것도 없으니 토스트를 띄우지 않는다.
      if (archivedIds.length === 0) return
      toast('보관했습니다', {
        action: {
          label: '되돌리기',
          onClick: () => {
            notificationsApi
              .unarchive(archivedIds)
              .then(invalidate)
              .catch(() => toast.error('되돌리지 못했습니다'))
          },
        },
      })
    },
    onError: () => toast.error('보관하지 못했습니다'),
  })
}
