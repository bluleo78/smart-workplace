import { useQuery } from '@tanstack/react-query'

import { driveApi } from '../../api/drive'
import type { DriveSpace } from '../../types/drive'
import { driveKeys } from './driveKeys'

// 드라이브 공간 단건 메타데이터 (WP-63) — archived 여부로 읽기 전용 배너·액션 비활성을 결정.
// resource.changed(drive) 가 ['drive','space',spaceId] 로 무효화한다.
// retry:false — 실패 시 배너 미표시로 폴백하던 기존 동작과 같게 재시도하지 않는다.
export function useDriveSpace(spaceId: number | undefined) {
  return useQuery<DriveSpace>({
    queryKey: driveKeys.space(spaceId),
    queryFn: () => driveApi.getSpace(spaceId as number).then((r) => r.data),
    enabled: typeof spaceId === 'number',
    retry: false,
  })
}
