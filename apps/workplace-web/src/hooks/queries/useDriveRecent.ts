// 드라이브 「최근」(WP-1699) cursor 페이징 훅 — useInfiniteQuery.

import { useInfiniteQuery } from '@tanstack/react-query'

import { listRecentDriveFiles } from '../../api/drive'
import type { DriveRecentPage } from '../../types/drive'
import { driveKeys } from './driveKeys'

/**
 * 내가 열거나 올린 파일 목록(최근 순, 50개씩) — 아래로 내리면 nextCursor 로 다음 쪽을 받는다.
 * 파일을 열면 서버가 기록하므로 화면에 다시 들어올 때마다 새로 받는다(refetchOnMount: 'always').
 */
export function useDriveRecent() {
  return useInfiniteQuery<DriveRecentPage>({
    queryKey: driveKeys.recent(),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listRecentDriveFiles(pageParam as string | undefined),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  })
}
