import { useQuery } from '@tanstack/react-query'

import { driveApi } from '../../api/drive'
import type { DriveSearchResult } from '../../types/drive'

// 드라이브 파일명 검색 (WP-63) — 호출측이 디바운스·최소 길이 판정을 끝낸 검색어를 넘긴다.
// 빈 검색어면 비활성. resource.changed(drive) 가 ['drive','search',spaceId] prefix 로 무효화한다.
// 검색어 변경 중 이전 결과 유지는 호출측(DrivePage)이 표시용 state 로 처리한다 — keepPreviousData 는
// 비활성(빈 검색어)을 거쳐 다른 검색어로 갈 때 옛 결과가 새 검색어 아래 노출되므로 쓰지 않는다.
export function useDriveSearch(spaceId: number | undefined, q: string) {
  return useQuery<DriveSearchResult>({
    queryKey: ['drive', 'search', spaceId, q],
    queryFn: () => driveApi.search(spaceId as number, q).then((r) => r.data),
    enabled: typeof spaceId === 'number' && q.trim().length > 0,
    retry: false,
  })
}
