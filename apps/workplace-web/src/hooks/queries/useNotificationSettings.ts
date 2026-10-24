// src/hooks/queries/useNotificationSettings.ts
// 알림 설정 쿼리/뮤테이션(WP-913) — 설정 화면이 읽고, 칸·앱 스위치 하나를 바꿀 때마다 부분 저장한다.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { notificationSettingsApi } from '../../api/notificationSettings'
import { handleApiError } from '../../lib/api-error'
import type { UpdateNotificationSettingsRequest } from '../../types/notificationSettings'

export const notificationSettingsKey = ['notification-settings'] as const

export function useNotificationSettings() {
  return useQuery({ queryKey: notificationSettingsKey, queryFn: notificationSettingsApi.get })
}

/** 저장 — 서버가 전체 설정을 돌려주므로 재조회 없이 캐시를 그 값으로 바꾼다. */
export function useUpdateNotificationSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: UpdateNotificationSettingsRequest) => notificationSettingsApi.update(req),
    // 진행 중인 재조회(창 포커스 등)를 취소한다 — 저장 전 값으로 늦게 도착한 GET 이 onSuccess 의 setQueryData 를 덮어
    // 스위치가 옛 값으로 되돌아가 보이는 일을 막는다.
    onMutate: () => qc.cancelQueries({ queryKey: notificationSettingsKey }),
    onSuccess: (data) => qc.setQueryData(notificationSettingsKey, data),
    onError: (e) => handleApiError(e, '알림 설정 저장에 실패했습니다'),
  })
}
