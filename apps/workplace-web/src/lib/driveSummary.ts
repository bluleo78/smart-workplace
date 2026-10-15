// #526·#735: 드라이브 파일 요약 카드의 폴링 주기·표시 상태를 정하는 순수 함수.
// useDriveFileSummary(폴링)와 ViewerSidePanel 의 SummaryCard(표시)가 같은 상한을 공유하도록 한곳에 둔다 —
// 두 판정이 어긋나면 "폴링은 멈췄는데 스켈레톤이 계속 도는" #735 영구 스켈레톤이 되살아난다.

/** 추출이 끝난(터미널) 상태 — 더 폴링하지 않는다. */
const TERMINAL = new Set(['DONE', 'FAILED', 'SKIPPED'])

/** 진행 중(추출/요약 미완) 상태 — 카드가 스켈레톤을 그리고 폴링을 이어 가는 대상. */
const IN_PROGRESS = new Set(['PENDING', 'EXTRACTING', 'TEXT_READY', 'SUMMARIZING'])

/** 요약 불가 상태 — 카드를 유지해 사유를 알린다(#735). */
const UNAVAILABLE = new Set(['SKIPPED', 'FAILED'])

/** 폴링 간격(ms). */
const POLL_INTERVAL_MS = 3000

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
export const IN_PROGRESS_POLLS = 40

/** 폴링 상한을 넘겨 처리기가 멈춘 정황일 때 스켈레톤 대신 보이는 안내. */
export const SUMMARY_STALLED_TEXT = '요약 생성이 지연되고 있습니다. 잠시 후 다시 열어 주세요.'

/** 서버가 요약 불가 사유(reason)를 주지 않았을 때의 폴백 문구. */
export const SUMMARY_UNAVAILABLE_FALLBACK = '요약을 사용할 수 없습니다.'

/**
 * react-query refetchInterval 판정 — 다음 폴링까지의 간격(ms) 또는 정지(false).
 * dataUpdateCount 는 지금까지 받은 응답 수다(폴링 횟수 상한 판정용).
 */
export function summaryRefetchInterval(status: string | null | undefined, dataUpdateCount: number): number | false {
  // 행 미생성(null) — 업로드 직후 AFTER_COMMIT 커밋보다 GET 이 먼저 도착하는 레이스(#735).
  // 무조건 정지하면 그 세션 동안 영구 공백이 되므로 짧게 NULL_STATUS_POLLS 회만 재확인한다.
  if (status == null) return dataUpdateCount < NULL_STATUS_POLLS ? POLL_INTERVAL_MS : false
  if (TERMINAL.has(status)) return false
  // 진행 중 — 상한까지만 폴링. 초과하면 정지하고 UI 가 지연 안내로 전환한다.
  return isSummaryPollingExhausted(dataUpdateCount) ? false : POLL_INTERVAL_MS
}

/** 진행 중 폴링 상한을 넘겼는지 — refetchInterval 정지 조건과 같은 기준이어야 카드가 지연 안내로 넘어간다. */
export function isSummaryPollingExhausted(dataUpdateCount: number): boolean {
  return dataUpdateCount >= IN_PROGRESS_POLLS
}

/** 요약 카드가 그릴 모양. none = 아무것도 그리지 않음(첫 로딩 중), empty = "요약이 아직 없습니다." 한 줄. */
export type SummaryCardView =
  | { kind: 'none' }
  | { kind: 'empty' }
  | { kind: 'summary'; summary: string }
  | { kind: 'reason'; text: string }
  | { kind: 'loading' }

/**
 * 요약 조회 결과 → 카드 표시 상태. 요약 본문이 있으면 상태와 무관하게 본문이 우선한다.
 * - 진행 중 + 폴링 상한 초과(stalled) → 지연 안내(#735)
 * - 요약 불가(SKIPPED/FAILED) → 서버 사유 평문, 없으면 폴백 문구(#735 — 카드가 사라지면 이유를 구분할 수 없다)
 * - 진행 중 → 스켈레톤
 * - 그 외(상태 행 없음 등) → 로딩 중이면 그리지 않고, 끝났으면 한 줄 안내
 */
export function summaryCardView(input: {
  summary: string | null
  status: string | null
  reason: string | null
  pollingExhausted: boolean
  isLoading: boolean
}): SummaryCardView {
  const { summary, status, reason, pollingExhausted, isLoading } = input
  if (summary != null) return { kind: 'summary', summary }
  const inProgress = status != null && IN_PROGRESS.has(status)
  if (inProgress && pollingExhausted) return { kind: 'reason', text: SUMMARY_STALLED_TEXT }
  if (status != null && UNAVAILABLE.has(status)) return { kind: 'reason', text: reason ?? SUMMARY_UNAVAILABLE_FALLBACK }
  if (inProgress) return { kind: 'loading' }
  return isLoading ? { kind: 'none' } : { kind: 'empty' }
}
