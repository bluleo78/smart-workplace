import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
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
 *
 * 처리 중 재진입 막기(WP-1961): isPending 은 React 상태라 같은 틱의 두 번째 클릭 때는 아직 false 다 — 그대로 두면 요청이
 * 두 번 가고, 두 번째 mutate 가 첫 호출의 호출별 onSuccess(포커스 옮기기)를 덮어 성공 토스트가 두 장 뜨거나 두 번째만 실패했을 때
 * 성공·실패 토스트가 함께 뜨고 포커스가 BODY 로 떨어졌다. 그래서 mutate 를 동기 ref 로 감싸 처리 중(끝날 때까지 — 성공 땐 무효화
 * 재조회까지)에 온 호출은 버린다. 이 훅을 쓰는 모든 버튼(알림 제목 행·모바일 머리·홈 알림 위젯)이 함께 막힌다.
 * 막는 것은 mutate 뿐이다 — mutateAsync 를 쓰는 곳이 없어 감싸지 않았다. 쓰게 되면 같은 ref 로 함께 감싼다.
 * 성공 토스트의 고정 id 는 같은 토스트가 떠 있는 동안 다시 성공해도 쌓이지 않게 하는 마지막 안전판이다.
 */
export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()
  // 처리 중 표시 — 렌더를 기다리지 않고 바로 읽고 쓰려고 상태가 아니라 ref 다.
  const inFlight = useRef(false)
  const mutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      toast('읽음 처리했습니다', { id: 'notification-read-all' })
      return qc.invalidateQueries({ queryKey: notificationKeys.all })
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.all })
      toastNotificationReadError()
    },
    // 성공(무효화 끝)·실패 어느 쪽이든 끝나면 다시 누를 수 있게 푼다.
    onSettled: () => {
      inFlight.current = false
    },
  })
  const { mutate: rawMutate } = mutation
  const mutate = useCallback<typeof rawMutate>(
    (variables, options) => {
      if (inFlight.current) return
      inFlight.current = true
      rawMutate(variables, options)
    },
    [rawMutate],
  )
  return { ...mutation, mutate }
}
