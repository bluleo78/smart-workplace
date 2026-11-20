// 알림 쿼리키. all 프리픽스 invalidate 로 목록+카운트 동시 갱신.
export const notificationKeys = {
  all: ['notifications'] as const,
  list: () => [...notificationKeys.all, 'list'] as const,
  archived: () => [...notificationKeys.all, 'archived'] as const,
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
}

/**
 * 읽음 처리 실패 토스트 id(WP-1842) — 「모두 읽음」·개별 읽음이 같은 id 를 써서, 한 화면(홈 위젯)에서 둘 다 실패하거나
 * 묶음의 id 마다 실패해도 같은 문구의 토스트가 한 장만 보인다.
 */
export const NOTIFICATION_READ_ERROR_TOAST_ID = 'notification-read-error'
