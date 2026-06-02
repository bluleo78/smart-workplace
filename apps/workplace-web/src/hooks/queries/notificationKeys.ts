// 알림 쿼리키. all 프리픽스 invalidate 로 목록+카운트 동시 갱신.
export const notificationKeys = {
  all: ['notifications'] as const,
  list: () => [...notificationKeys.all, 'list'] as const,
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
}
