import { useInfiniteQuery } from '@tanstack/react-query'

import { notificationsApi } from '../../api/notifications'
import type { NotificationResponse } from '../../types/notification'
import { notificationKeys } from './notificationKeys'

const PAGE_SIZE = 20

// 알림 무한스크롤(#610) — offset 기반 페이지네이션. 패널이 열려 있을 때만(enabled) 조회.
// data.pages 는 페이지별 배열(NotificationResponse[][]) — 소비처는 flattenNotificationPages() 로 평탄화한다.
export function useNotifications(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: notificationKeys.list(),
    queryFn: ({ pageParam }) => notificationsApi.list(PAGE_SIZE, pageParam),
    initialPageParam: 0,
    // 마지막 페이지가 PAGE_SIZE 미만이면 더 이상 없음(offset = 지금까지 로드한 총 건수).
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < PAGE_SIZE ? undefined : allPages.flat().length,
    enabled,
    staleTime: 10_000,
  })
}

// useNotifications() 의 페이지 배열을 평탄화한 단건 목록으로 변환(대시보드 위젯 등 첫 페이지만 필요한 소비처용).
export function flattenNotificationPages(
  pages: NotificationResponse[][] | undefined,
): NotificationResponse[] {
  return pages?.flat() ?? []
}
