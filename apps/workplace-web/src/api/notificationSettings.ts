// src/api/notificationSettings.ts
// 앱·항목·행위자별 알림 설정 REST 호출(WP-913). 사용자 단위 글로벌 설정이라 테넌트와 무관하다.
import type { NotificationSettings, UpdateNotificationSettingsRequest } from '../types/notificationSettings'
import { client } from './client'

export const notificationSettingsApi = {
  get: () => client.get<NotificationSettings>('/notification-settings').then((r) => r.data),
  /** 바뀐 앱 스위치·칸만 보내고, 서버가 돌려준 전체 설정을 받는다. */
  update: (req: UpdateNotificationSettingsRequest) =>
    client.put<NotificationSettings>('/notification-settings', req).then((r) => r.data),
}
