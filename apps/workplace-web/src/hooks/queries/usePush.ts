// src/hooks/queries/usePush.ts
// 푸시 설정 쿼리/뮤테이션 — 서버 config·종류별 설정과 "이 기기" 구독 상태(브라우저 PushManager)를 함께 다룬다.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { pushApi } from '../../api/push'
import { handleApiError } from '../../lib/api-error'
import { currentSubscription, disablePush, enablePush } from '../../lib/push/subscription'
import type { PushCategory } from '../../types/push'

export const pushKeys = {
  all: ['push'] as const,
  config: ['push', 'config'] as const,
  preferences: ['push', 'preferences'] as const,
  device: ['push', 'device'] as const,
}

export function usePushConfig() {
  return useQuery({ queryKey: pushKeys.config, queryFn: pushApi.config, staleTime: 5 * 60_000 })
}

export function usePushPreferences(enabled: boolean) {
  return useQuery({ queryKey: pushKeys.preferences, queryFn: pushApi.preferences, enabled })
}

export function useUpdatePushPreference() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ category, enabled }: { category: PushCategory; enabled: boolean }) =>
      pushApi.updatePreferences({ [category]: enabled }),
    onSuccess: (data) => qc.setQueryData(pushKeys.preferences, data),
    onError: (e) => handleApiError(e, '알림 설정 저장에 실패했습니다'),
  })
}

/** 이 기기 구독 여부(브라우저 기준). */
export function useDevicePush() {
  return useQuery({
    queryKey: pushKeys.device,
    queryFn: async () => ({ subscribed: (await currentSubscription()) != null }),
    staleTime: Infinity,
  })
}

/** 호출자는 클릭 핸들러에서 requestPushPermission() 을 먼저 호출해 permission 으로 넘긴다. */
export function useEnablePush() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ vapidPublicKey, permission }: { vapidPublicKey: string; permission: Promise<NotificationPermission> }) =>
      enablePush(vapidPublicKey, permission),
    onSuccess: () => {
      qc.setQueryData(pushKeys.device, { subscribed: true })
      toast.success('이 기기에서 알림을 받습니다')
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
