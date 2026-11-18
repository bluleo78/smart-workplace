// 알림 인박스 REST 호출. client(baseURL /api/v1) 사용.
import type { NotificationResponse } from '../types/notification'
import { client } from './client'

/** 되돌리기 한 번에 보낼 수 있는 id 수 — API `UnarchiveNotificationsRequest` 의 `@Size(max = 1000)` 과 같다. */
const UNARCHIVE_BATCH = 1000

export const notificationsApi = {
  // offset(#610): 무한스크롤 다음 페이지 조회용, 기본 0(첫 페이지).
  list: (limit = 20, offset = 0) =>
    client
      .get<NotificationResponse[]>('/notifications', { params: { limit, offset } })
      .then((r) => r.data),
  // 보관함 목록(WP-1690) — 응답 모양은 list 와 같고 최근 보관순. 무한스크롤용 offset.
  listArchived: (limit = 20, offset = 0) =>
    client
      .get<NotificationResponse[]>('/notifications/archived', { params: { limit, offset } })
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
  // 서버는 한 번에 UNARCHIVE_BATCH 개까지 받는데 보관은 개수 제한이 없어, 1,000개 넘게 보관한 묶음도 되돌리도록
  // 그만큼씩 나눠 차례로 보낸다(동시에 보내면 서버에 한꺼번에 몰린다).
  unarchive: async (ids: number[]) => {
    for (let i = 0; i < ids.length; i += UNARCHIVE_BATCH) {
      await client.post('/notifications/unarchive', { ids: ids.slice(i, i + UNARCHIVE_BATCH) })
    }
  },
}
