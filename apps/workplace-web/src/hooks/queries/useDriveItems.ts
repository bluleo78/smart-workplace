import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { driveApi } from '../../api/drive'
import type { DriveItemList } from '../../types/drive'

// #460: 드라이브 폴더 내용 — show_drive(spaceId 지정) 위젯용. spaceId 없으면 비활성.
// options.keepPrevious: 폴더 전환 중 새 목록이 올 때까지 이전 목록을 유지(DrivePage 전용). 기본은 꺼짐.
export function useDriveItems(spaceId?: number, folderId?: number, options?: { keepPrevious?: boolean }) {
  return useQuery<DriveItemList>({
    queryKey: ['drive', 'items', spaceId, folderId ?? null],
    queryFn: () => driveApi.listItems(spaceId as number, folderId ?? null).then((r) => r.data),
    enabled: typeof spaceId === 'number',
    retry: false,
    // 같은 공간 안의 폴더 전환일 때만 이전 목록을 유지 — 공간이 바뀌면 다른 공간 행이 새 sid 의 액션과 섞이므로 비운다.
    placeholderData: (prev, prevQuery) =>
      options?.keepPrevious && prevQuery?.queryKey[2] === spaceId ? keepPreviousData(prev) : undefined,
  })
}
