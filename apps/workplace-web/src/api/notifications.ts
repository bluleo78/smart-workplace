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
  // 읽은 알림 모두 보관(WP-1689) — 응답은 실제로 보관된 id 목록(되돌리기 토스트가 그 묶음만 되살린다).
  archiveRead: () =>
    client
      .post<{ archivedIds: number[] }>('/notifications/archive-read')
      .then((r) => r.data),
  // 보관 되돌리기 — 내 것이면서 보관된 id 만 서버가 되살린다(남의 id 는 무시).
  unarchive: (ids: number[]) =>
    client.post('/notifications/unarchive', { ids }).then((r) => r.data),
}
