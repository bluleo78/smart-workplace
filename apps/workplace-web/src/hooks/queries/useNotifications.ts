import { useInfiniteQuery } from '@tanstack/react-query'

import { notificationsApi } from '../../api/notifications'
import type { NotificationResponse } from '../../types/notification'
import { notificationKeys } from './notificationKeys'

const PAGE_SIZE = 20

/**
 * 알림 목록류 무한스크롤 공용 본체 — offset 기반 페이지네이션. 알림 목록과 보관함(WP-1690)은 쿼리키·가져오는 함수만 다르고
 * 페이지 크기·다음 쪽 판정·캐시 시간이 같아 한 곳에 둔다. 쓰는 쪽은 아래 공개 훅을 부른다.
 */
function useNotificationPages(
  queryKey: readonly unknown[],
  fetchPage: (limit: number, offset: number) => Promise<NotificationResponse[]>,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(PAGE_SIZE, pageParam),
    initialPageParam: 0,
    // 마지막 페이지가 PAGE_SIZE 미만이면 더 이상 없음(offset = 지금까지 로드한 총 건수).
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < PAGE_SIZE ? undefined : allPages.flat().length,
    enabled,
    staleTime: 10_000,
  })
}

// 알림 무한스크롤(#610) — 패널이 열려 있을 때만(enabled) 조회.
// data.pages 는 페이지별 배열(NotificationResponse[][]) — 소비처는 flattenNotificationPages() 로 평탄화한다.
export function useNotifications(enabled: boolean) {
  return useNotificationPages(notificationKeys.list(), notificationsApi.list, enabled)
}

/**
 * 보관함 무한스크롤(WP-1690) — 알림 목록과 같은 모양. 보관함 탭을 열었을 때만(enabled) 조회한다.
 * 키가 notificationKeys.all 아래라 보관·되돌리기 뒤 prefix 무효화로 갱신된다.
 */
export function useArchivedNotifications(enabled: boolean) {
  return useNotificationPages(notificationKeys.archived(), notificationsApi.listArchived, enabled)
}

// useNotifications() 의 페이지 배열을 평탄화한 단건 목록으로 변환(대시보드 위젯 등 첫 페이지만 필요한 소비처용).
export function flattenNotificationPages(
  pages: NotificationResponse[][] | undefined,
): NotificationResponse[] {
  return pages?.flat() ?? []
}
