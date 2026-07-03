import { useQuery } from '@tanstack/react-query'

import { driveApi } from '../../api/drive'
import type { DriveSpace } from '../../types/drive'

// #460: 드라이브 스페이스 목록 — show_drive(spaceId 미지정) 위젯용.
export function useDriveSpaces(options?: { enabled?: boolean }) {
  return useQuery<DriveSpace[]>({
    queryKey: ['drive', 'spaces'],
    queryFn: () => driveApi.listSpaces().then((r) => r.data),
    retry: false,
    enabled: options?.enabled ?? true,
  })
}
