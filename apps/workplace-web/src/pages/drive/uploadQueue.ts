/**
 * 드라이브 업로드 큐 상태 계산 (WP-1531).
 *
 * 한 번에 올리는 파일 묶음(배치)의 파일별 상태를 순수 리듀서로 관리한다.
 * 업로드 패널이 이 상태를 그대로 그리고, 실제 전송(순차 실행·AbortController)은 훅이 맡는다.
 */

/** 파일 한 개의 업로드 상태. */
export type UploadItemStatus = 'queued' | 'uploading' | 'done' | 'failed' | 'cancelled'

/** 배치 안 파일 한 개. */
export interface UploadItem {
  /** 배치 안 고유 id(인덱스 기반 문자열) */
  id: string
  file: File
  /** 놓은 폴더 기준 하위 폴더 경로(버튼 경로는 []) */
  path: string[]
  status: UploadItemStatus
  /** 진행률(0~100). 아직 시작 전이면 null */
  percent: number | null
  /** 실패 이유 문구 */
  error?: string
  /** 다시 시도 가능 여부(크기 초과면 false) */
  retryable?: boolean
}

/** 배치를 올릴 자리 — 시작한 순간의 공간·폴더. 올리는 중에 화면이 다른 곳으로 옮겨 가도 이 자리로 올린다. */
export interface UploadRoot {
  sid: number
  folderId: number | null
}

/** 업로드 배치 전체 상태. */
export interface UploadBatch {
  /** 배치 식별자 — start 마다 바뀌고 다시 시도는 그대로다. 패널이 key 로 써 새 배치마다 접힘 상태를 처음으로 돌린다. */
  id: number
  /** 배치의 공간·폴더(다시 시도도 같은 자리) */
  root: UploadRoot
  items: UploadItem[]
  /** 사용자가 취소했는지 */
  cancelled: boolean
  /** 순차 업로드가 진행 중인지 */
  running: boolean
}

export type UploadAction =
  | { type: 'start'; root: UploadRoot; items: Array<Pick<UploadItem, 'file' | 'path'>> }
  | { type: 'begin'; id: string }
  | { type: 'progress'; id: string; percent: number }
  | { type: 'done'; id: string }
  | { type: 'fail'; id: string; error: string; retryable: boolean }
  | { type: 'cancel' }
  | { type: 'finish' }
  | { type: 'retry'; ids: string[] }
  | { type: 'clear' }

/** 한 항목만 갱신한 새 배치를 만든다. */
function patchItem(
  state: UploadBatch,
  id: string,
  patch: (item: UploadItem) => UploadItem,
): UploadBatch {
  return { ...state, items: state.items.map((it) => (it.id === id ? patch(it) : it)) }
}

/**
 * 업로드 큐 리듀서. 배치가 없으면(null) start 외 액션은 무시한다.
 * progress 가 100 을 줘도 서버 응답(done) 전까지 status 는 uploading 으로 둔다
 * — 전송이 끝나도 서버 처리가 남아 있어 완료로 보이면 거짓이기 때문.
 */
export function uploadQueueReducer(
  state: UploadBatch | null,
  action: UploadAction,
): UploadBatch | null {
  if (action.type === 'start') {
    return {
      id: (state?.id ?? 0) + 1,
      root: action.root,
      items: action.items.map((it, i) => ({
        id: String(i),
        file: it.file,
        path: it.path,
        status: 'queued',
        percent: null,
      })),
      cancelled: false,
      running: true,
    }
  }
  if (!state) return null

  switch (action.type) {
    case 'begin':
      return patchItem(state, action.id, (it) => ({ ...it, status: 'uploading', percent: 0 }))
    case 'progress':
      // 같은 값이면 상태를 그대로 돌려줘 다시 그리지 않는다(진행 이벤트는 같은 퍼센트로 여러 번 온다).
      if (state.items.find((it) => it.id === action.id)?.percent === action.percent) return state
      return patchItem(state, action.id, (it) => ({ ...it, percent: action.percent }))
    case 'done':
      return patchItem(state, action.id, (it) => ({ ...it, status: 'done', percent: 100 }))
    case 'fail':
      return patchItem(state, action.id, (it) => ({
        ...it,
        status: 'failed',
        error: action.error,
        retryable: action.retryable,
      }))
    case 'cancel':
      // 진행 중·대기 중인 것만 취소로 — 이미 끝난(완료·실패) 결과는 보존한다
      return {
        ...state,
        items: state.items.map((it) =>
          it.status === 'queued' || it.status === 'uploading' ? { ...it, status: 'cancelled' } : it,
        ),
        cancelled: true,
        running: false,
      }
    case 'finish':
      return { ...state, running: false }
    case 'retry':
      // 지정한 파일만 대기로 되돌리고 이전 실패 정보를 지운다(같은 배치라 id 는 그대로)
      return {
        ...state,
        items: state.items.map((it) =>
          action.ids.includes(it.id)
            ? { ...it, status: 'queued', percent: null, error: undefined, retryable: undefined }
            : it,
        ),
        cancelled: false,
        running: true,
      }
    case 'clear':
      return null
  }
}

/** 패널 머리·막대용 요약. */
export interface UploadSummary {
  total: number
  done: number
  failed: number
  queued: number
  /** 지금 올리는 중인 파일(없으면 undefined) */
  uploading?: UploadItem
  /** 전체 진행률(0~100 정수, 내림) — 완료·실패·취소를 모두 「처리됨」으로 친다 */
  overallPercent: number
}

/**
 * 배치를 요약한다. overallPercent = (처리된 수 + 올리는 중 percent/100) / total × 100 을 내림한다.
 * 처리된 수는 완료·실패·취소 — 실패를 빼면 모든 파일을 다룬 뒤에도 막대가 100% 에 못 닿아 멈춘 것처럼 보인다.
 * 부동소수 오차를 피하려고 100 을 먼저 곱한 정수 식으로 계산한다.
 */
export function summarize(batch: UploadBatch): UploadSummary {
  // 한 번만 돌며 센다 — 진행 이벤트마다 불리므로 상태별 filter 를 여러 번 돌지 않는다.
  let done = 0
  let failed = 0
  let queued = 0
  let cancelled = 0
  let uploading: UploadItem | undefined
  for (const it of batch.items) {
    if (it.status === 'done') done++
    else if (it.status === 'failed') failed++
    else if (it.status === 'queued') queued++
    else if (it.status === 'cancelled') cancelled++
    else if (!uploading) uploading = it
  }
  const total = batch.items.length
  const partial = uploading?.percent ?? 0
  const processed = done + failed + cancelled
  const overallPercent = total === 0 ? 0 : Math.floor((processed * 100 + partial) / total)
  return { total, done, failed, queued, uploading, overallPercent }
}
