// 알림 인박스 REST 호출. client(baseURL /api/v1) 사용.
import { client } from './client'
import type { NotificationResponse } from '../types/notification'

export const notificationsApi = {
  list: (limit = 20) =>
    client
      .get<NotificationResponse[]>('/notifications', { params: { limit } })
      .then((r) => r.data),
  unreadCount: () =>
    client.get<{ count: number }>('/notifications/unread-count').then((r) => r.data.count),
  markRead: (id: number) => client.post(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => client.post('/notifications/read-all').then((r) => r.data),
}
