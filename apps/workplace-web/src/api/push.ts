// src/api/push.ts
// Web Push REST 호출. 구독·설정은 사용자 단위(테넌트 무관) API.
import type { PushConfig, PushPreferences } from '../types/push'
import { client } from './client'

export const pushApi = {
  config: () => client.get<PushConfig>('/push/config').then((r) => r.data),
  subscribe: (json: PushSubscriptionJSON) =>
    client.post<void>('/push/subscriptions', { endpoint: json.endpoint, keys: json.keys }).then(() => undefined),
  unsubscribe: (endpoint: string) =>
    client.delete<void>('/push/subscriptions', { data: { endpoint } }).then(() => undefined),
  preferences: () => client.get<PushPreferences>('/push/preferences').then((r) => r.data),
  updatePreferences: (p: Partial<PushPreferences>) =>
    client.put<PushPreferences>('/push/preferences', p).then((r) => r.data),
}
