import { useQuery } from '@tanstack/react-query'

import { driveApi } from '../../api/drive'
import type { DriveTrashList } from '../../types/drive'

// 드라이브 휴지통 목록 (WP-63) — 휴지통을 열었을 때만 조회(enabled).
// resource.changed(drive) 가 ['drive','trash',spaceId] 로 무효화한다.
// retry:false — 기존 직접 호출과 같이 실패 시 재시도 없이 즉시 실패시킨다.
export function useDriveTrash(spaceId: number | undefined, enabled: boolean) {
  return useQuery<DriveTrashList>({
    queryKey: ['drive', 'trash', spaceId],
    queryFn: () => driveApi.listTrash(spaceId as number).then((r) => r.data),
    enabled: enabled && typeof spaceId === 'number',
    retry: false,
  })
}
