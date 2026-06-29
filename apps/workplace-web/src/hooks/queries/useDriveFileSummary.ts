// #526: 드라이브 파일 콘텐츠 요약(파이프라인 저장본) 조회 훅.

import { useQuery } from '@tanstack/react-query'

import { driveApi } from '../../api/drive'
import { useAiAvailable } from '../useAiAvailable'

/** 추출이 끝난(터미널) 상태 — 더 폴링하지 않는다. status null(행 없음)도 터미널. */
const TERMINAL = new Set(['DONE', 'FAILED', 'SKIPPED'])

/**
 * 파일 콘텐츠 요약 구독. AI 사용 가능 + 유효 fileId 일 때만 조회.
 * 추출 진행 중이면 3초 간격 폴링, 터미널 상태(DONE/FAILED/SKIPPED/행없음)에 도달하면 정지.
 */
export function useDriveFileSummary(fileId: number) {
  const aiAvailable = useAiAvailable()
  return useQuery({
    queryKey: ['drive-file-summary', fileId],
    queryFn: async () => (await driveApi.getFileSummary(fileId)).data,
    enabled: Number.isFinite(fileId) && fileId > 0 && aiAvailable,
    retry: false,
    refetchInterval: (q) => {
      const status = q.state.data?.status
      // data 미도착(undefined) 또는 터미널 → 폴링 안 함. 비-터미널(진행 중)만 3초 폴링.
      if (status == null || TERMINAL.has(status)) return false
      return 3000
    },
  })
}
