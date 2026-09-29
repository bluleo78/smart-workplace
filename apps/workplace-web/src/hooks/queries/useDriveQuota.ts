import { useQuery } from '@tanstack/react-query'

import { driveApi } from '../../api/drive'
import type { DriveQuota } from '../../types/drive'
import { driveKeys } from './driveKeys'

// #820: 사이드바 사용량 바 — TanStack Query 로 전환해 업로드/삭제/롤백 등
// 사용량에 영향을 주는 mutation 성공 시 invalidateQueries(driveQuotaKeys.all) 로
// 재조회를 트리거할 수 있게 한다(마운트 시 1회성 fetch 대신 공유 쿼리 키 사용).
export const driveQuotaKeys = {
  all: driveKeys.quota,
}

export function useDriveQuota() {
  return useQuery<DriveQuota>({
    queryKey: driveQuotaKeys.all,
    queryFn: () => driveApi.getQuota().then((r) => r.data),
    retry: false,
  })
}
