import { useQuery } from '@tanstack/react-query'

import { driveApi } from '../../api/drive'
import type { DriveItemList } from '../../types/drive'

// #460: 드라이브 폴더 내용 — show_drive(spaceId 지정) 위젯용. spaceId 없으면 비활성.
export function useDriveItems(spaceId?: number, folderId?: number) {
  return useQuery<DriveItemList>({
    queryKey: ['drive', 'items', spaceId, folderId ?? null],
    queryFn: () => driveApi.listItems(spaceId as number, folderId ?? null).then((r) => r.data),
    enabled: typeof spaceId === 'number',
    retry: false,
  })
}
