// src/api/push.ts
// Web Push REST 호출. 구독은 사용자 단위(테넌트 무관) API. 종류별 설정은 알림 설정 API(notificationSettings.ts, WP-913)로 옮겼다.
import type { PushConfig } from '../types/push'
import { client } from './client'

export const pushApi = {
  config: () => client.get<PushConfig>('/push/config').then((r) => r.data),
  subscribe: (json: PushSubscriptionJSON) =>
    client.post<void>('/push/subscriptions', { endpoint: json.endpoint, keys: json.keys }).then(() => undefined),
  unsubscribe: (endpoint: string) =>
    client.delete<void>('/push/subscriptions', { data: { endpoint } }).then(() => undefined),
}
