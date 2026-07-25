// #526: 드라이브 파일 콘텐츠 요약(파이프라인 저장본) 조회 훅.

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { driveApi } from '../../api/drive'
import { useAiAvailable } from '../useAiAvailable'

/** 추출이 끝난(터미널) 상태 — 더 폴링하지 않는다. */
const TERMINAL = new Set(['DONE', 'FAILED', 'SKIPPED'])

/** status null(행 미생성) 상태에서 재확인할 최대 횟수(#735). */
const NULL_STATUS_POLLS = 5

/**
 * 진행 중(PENDING/EXTRACTING/…) 상태에서 폴링을 포기하는 횟수(#735). 3초 × 40 ≈ 2분.
 *
 * 워커가 꺼져 있거나 도달 불가면 파이프라인은 행을 PENDING 으로 되돌리고 스케줄러가 계속
 * 재시도한다 — 즉 status 는 영원히 PENDING 이다. 상한이 없으면 모달을 열어둔 동안 3초마다
 * 무한 폴링하며 스켈레톤만 돌고, 사용자는 "처리 중"과 "처리기가 죽음"을 구분할 수 없다.
 * V124 백필이 레거시 SKIPPED 행을 대량으로 PENDING 으로 되살리므로 이 상한이 없으면
 * 워커 미가동 환경에서 그 파일들이 전부 영구 스켈레톤이 된다.
 */
const IN_PROGRESS_POLLS = 40

/**
 * 파일 콘텐츠 요약 구독. AI 사용 가능 + 유효 fileId 일 때만 조회.
 * 추출 진행 중이면 3초 간격 폴링(최대 IN_PROGRESS_POLLS 회), 터미널 상태(DONE/FAILED/SKIPPED)면 정지.
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
    refetchInterval: (q) => {
      const status = q.state.data?.status
      // 행 미생성(null) — 업로드 직후 AFTER_COMMIT 커밋보다 GET 이 먼저 도착하는 레이스(#735).
      // 무조건 정지하면 그 세션 동안 영구 공백이 되므로 짧게 NULL_STATUS_POLLS 회만 재확인한다.
      if (status == null) return q.state.dataUpdateCount < NULL_STATUS_POLLS ? 3000 : false
      if (TERMINAL.has(status)) return false
      // 진행 중 — 상한까지만 폴링. 초과하면 정지하고 UI 가 지연 안내로 전환한다.
      return q.state.dataUpdateCount < IN_PROGRESS_POLLS ? 3000 : false
    },
  })
  const updates = client.getQueryState(['drive-file-summary', fileId])?.dataUpdateCount ?? 0
  return { ...query, pollingExhausted: updates >= IN_PROGRESS_POLLS }
}
