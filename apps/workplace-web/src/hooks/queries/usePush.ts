// src/hooks/queries/usePush.ts
// 푸시 쿼리/뮤테이션 — 서버 config 와 "이 기기" 구독 상태(브라우저 PushManager)를 함께 다룬다.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { pushApi } from '../../api/push'
import { handleApiError } from '../../lib/api-error'
import { currentSubscription, disablePush, enablePush } from '../../lib/push/subscription'

export const pushKeys = {
  all: ['push'] as const,
  config: ['push', 'config'] as const,
  device: ['push', 'device'] as const,
}

export function usePushConfig() {
  return useQuery({ queryKey: pushKeys.config, queryFn: pushApi.config, staleTime: 5 * 60_000 })
}

/** 이 기기 구독 여부(브라우저 기준). */
export function useDevicePush() {
  return useQuery({
    queryKey: pushKeys.device,
    queryFn: async () => ({ subscribed: (await currentSubscription()) != null }),
    staleTime: Infinity,
  })
}

/**
 * 호출자는 클릭 핸들러에서 requestPushPermission() 을 먼저 호출해 permission 으로 넘긴다.
 * successToast(기본 true): 성공 토스트를 훅 수준 onSuccess 에서 띄운다 — 호출 컴포넌트(인박스 배너 등)가 구독 도중
 * 언마운트돼도 토스트가 사라지지 않게. 설정 화면 토글은 스위치 상태 자체가 피드백이고(즉시 적용 설정 패턴)
 * 우상단 토스트가 오른쪽 끝 토글을 가리므로 false 로 끈다.
 */
export function useEnablePush({ successToast = true }: { successToast?: boolean } = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ vapidPublicKey, permission }: { vapidPublicKey: string; permission: Promise<NotificationPermission> }) =>
      enablePush(vapidPublicKey, permission),
    onSuccess: () => {
      qc.setQueryData(pushKeys.device, { subscribed: true })
      if (successToast) toast.success('이 기기에서 알림을 받습니다')
    },
    onError: (e) => {
      if (e instanceof Error && e.message === 'PERMISSION_DENIED') return // 화면이 거부 안내를 보여준다
      handleApiError(e, '알림을 켜지 못했습니다')
    },
  })
}

export function useDisablePush() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: disablePush,
    onSuccess: () => qc.setQueryData(pushKeys.device, { subscribed: false }),
    onError: (e) => handleApiError(e, '알림을 끄지 못했습니다'),
  })
}
