// 알림 쿼리키. all 프리픽스 invalidate 로 목록+카운트 동시 갱신.
export const notificationKeys = {
  all: ['notifications'] as const,
  list: () => [...notificationKeys.all, 'list'] as const,
  archived: () => [...notificationKeys.all, 'archived'] as const,
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
  // 쿼리키가 아니라 mutationKey — 보관함 줄 되돌리기의 진행 중 호출을 뮤테이션 캐시에서 찾는다(useUnarchivingIds, WP-1845).
  unarchiveMutation: () => [...notificationKeys.all, 'unarchive'] as const,
}
