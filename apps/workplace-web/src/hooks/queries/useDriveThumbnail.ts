// #615: 드라이브 파일 썸네일 조회 훅.
// 썸네일 생성 실패(404) 파일이 목록 재방문(리스트 재마운트)마다 동일 요청을 반복하던 문제를
// React Query 캐시로 해소 — 성공/실패(null) 모두 staleTime 동안 재요청하지 않는다.

import { useQuery } from '@tanstack/react-query'

import { driveApi } from '../../api/drive'

/**
 * 파일 썸네일 blob 구독. IMAGE 카테고리에서만 활성화.
 * 404(썸네일 없음/생성 실패)도 null 로 캐시되어 재방문 시 재요청하지 않는다(negative cache).
 */
export function useDriveThumbnail(fileId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['drive-thumbnail', fileId],
    queryFn: () => driveApi.fetchThumbnailBlob(fileId),
    enabled: enabled && Number.isFinite(fileId) && fileId > 0,
    retry: false,
    staleTime: 5 * 60_000,
  })
}
