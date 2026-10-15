// #526: 드라이브 파일 콘텐츠 요약(파이프라인 저장본) 조회 훅.

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { driveApi } from '../../api/drive'
import { isSummaryPollingExhausted, summaryRefetchInterval } from '../../lib/driveSummary'
import { useAiAvailable } from '../useAiAvailable'

/**
 * 파일 콘텐츠 요약 구독. AI 사용 가능 + 유효 fileId 일 때만 조회.
 * 추출 진행 중이면 3초 간격 폴링(최대 IN_PROGRESS_POLLS 회), 터미널 상태(DONE/FAILED/SKIPPED)면 정지 —
 * 판정은 summaryRefetchInterval(lib/driveSummary) 이 맡는다.
 *
 * 반환값에 `pollingExhausted` 를 덧붙인다 — 폴링 상한을 넘겼다는 뜻으로, 호출측이 "진행 중" 표시를
 * 지연 안내로 전환하는 근거로 쓴다. dataUpdateCount 는 useQuery 결과에 노출되지 않아 캐시 상태에서 읽는다.
 */
export function useDriveFileSummary(fileId: number) {
  const aiAvailable = useAiAvailable()
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['drive-file-summary', fileId],
    queryFn: async () => (await driveApi.getFileSummary(fileId)).data,
    enabled: Number.isFinite(fileId) && fileId > 0 && aiAvailable,
    retry: false,
    refetchInterval: (q) => summaryRefetchInterval(q.state.data?.status, q.state.dataUpdateCount),
  })
  const updates = client.getQueryState(['drive-file-summary', fileId])?.dataUpdateCount ?? 0
  return { ...query, pollingExhausted: isSummaryPollingExhausted(updates) }
}
