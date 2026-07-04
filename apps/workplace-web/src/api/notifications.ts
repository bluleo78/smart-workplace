// 알림 인박스 REST 호출. client(baseURL /api/v1) 사용.
import type { NotificationResponse } from '../types/notification'
import { client } from './client'

export const notificationsApi = {
  // offset(#610): 무한스크롤 다음 페이지 조회용, 기본 0(첫 페이지).
  list: (limit = 20, offset = 0) =>
    client
      .get<NotificationResponse[]>('/notifications', { params: { limit, offset } })
      .then((r) => r.data),
  unreadCount: () =>
    client.get<{ count: number }>('/notifications/unread-count').then((r) => r.data.count),
  markRead: (id: number) => client.post(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => client.post('/notifications/read-all').then((r) => r.data),
}
