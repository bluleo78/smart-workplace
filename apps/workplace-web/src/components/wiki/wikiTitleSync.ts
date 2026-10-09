import { isPermanentClientStatus } from '@/lib/api-error'
import { backoffDelay } from '@/lib/backoff'
import { toSingleLine } from '@/lib/singleLine'

/**
 * 노트 제목 입력의 동기화 판정(WP-287) — 본문은 실시간 동기화(Yjs)지만 제목은 짧은 REST 저장(나중 값 우선)이다.
 *
 * 규칙:
 * - 화면에 보이는 제목은 `local` 하나다. 입력 중(포커스)·보내기 대기(dirty)·응답 대기(pending) 동안엔 원격 제목이 덮지 않는다.
 * - 그 밖의 때엔 원격(캐시) 제목으로 맞춘다. 단, 내가 보냈던 옛 제목이 늦게 메아리쳐 오면(SSE 순서 역전) 마지막에 보낸
 *   제목을 유지한다 — 안 그러면 "abc"→"abcd" 를 연달아 저장했을 때 "abc" 의 늦은 이벤트가 화면을 되돌린다.
 * - 내가 보낸 적 없는 제목이 오면 진짜 원격 변경이므로 반영하고 보낸 기록을 비운다.
 * - 메아리는 몇 초 안에 오므로 보낸 기록은 ECHO_WINDOW_MS 동안만 메아리로 본다 — 그 뒤 같은 제목이 오면(남이 내 옛 제목으로
 *   되돌림) 진짜 원격 변경으로 반영한다. 안 그러면 내 화면만 마지막에 보낸 제목에 머물러 서버·사이드바와 영영 어긋난다.
 * - 저장이 일시 실패하면 입력을 되돌리지 않는다(dirty 로 남기고 createTitleSaver 가 간격을 두고 다시 보낸다).
 * - 다시 보내도 소용없는 실패(권한 없음·페이지 없음 등 4xx)면 내 입력을 포기하고(abandoned) 원격 제목을 다시 따른다.
 * - 보내기 대기 중 원격 제목으로 되돌리면(revert) 보낼 것이 없다 — 원격 제목을 다시 따른다.
 * - 원격 제목은 한 줄로 맞춰 받는다(WP-315) — API·MCP 로 개행이 든 제목이 저장돼 있어도 입력란엔 한 줄로 보인다.
 *   정규화한 값을 원격 기준으로 삼으므로 열기만 해서는 저장하지 않고, 사용자가 고치면 한 줄 값이 저장된다.
 */
export interface TitleSyncState {
  /** 입력란에 보이는 제목. */
  local: string
  /** 마지막으로 본 원격(캐시) 제목. */
  remote: string
  /** 입력란 포커스 중. */
  focused: boolean
  /** 바꿨지만 아직 보내지 않음(디바운스 대기·실패 후). */
  dirty: boolean
  /** 보냈고 응답을 기다리는 요청 수. */
  pending: number
  /** 최근 보낸 제목과 보낸 시각(오래된 → 최근). 늦은 메아리 판별용. */
  sent: { title: string; at: number }[]
}

export type TitleSyncAction =
  | { type: 'focus' }
  | { type: 'blur' }
  | { type: 'change'; title: string }
  | { type: 'sent'; title: string; now: number }
  | { type: 'settled' }
  | { type: 'failed' }
  | { type: 'abandoned' }
  | { type: 'remote'; title: string; now: number }

/** 보낸 기록 보관 개수 — 메아리는 몇 초 안에 오므로 최근 몇 건이면 충분하다. */
const SENT_HISTORY = 10
/** 이 시간 안에 돌아온 내 옛 제목만 늦은 메아리로 본다. */
export const ECHO_WINDOW_MS = 10_000

const sentIncludes = (s: TitleSyncState, title: string) => s.sent.some((e) => e.title === title)

export function initTitleSync(remoteTitle: string): TitleSyncState {
  const remote = toSingleLine(remoteTitle)
  return { local: remote, remote, focused: false, dirty: false, pending: 0, sent: [] }
}

/** 내 입력이 진행 중이 아니면 원격 제목으로 맞춘다(늦은 메아리면 마지막에 보낸 제목). */
function settle(s: TitleSyncState): TitleSyncState {
  if (s.focused || s.dirty || s.pending > 0) return s
  const local = sentIncludes(s, s.remote) ? s.sent[s.sent.length - 1].title : s.remote
  return local === s.local ? s : { ...s, local }
}

export function titleSyncReducer(s: TitleSyncState, a: TitleSyncAction): TitleSyncState {
  switch (a.type) {
    case 'focus':
      return { ...s, focused: true }
    case 'blur':
      return settle({ ...s, focused: false })
    case 'change':
      // 응답 대기가 없는데 원격 제목으로 되돌렸으면 보낼 것이 없다(needsTitleSave 와 같은 판정).
      return { ...s, local: a.title, dirty: needsTitleSave(s, a.title) }
    case 'sent':
      return {
        ...s,
        dirty: false,
        pending: s.pending + 1,
        sent: [...s.sent, { title: a.title, at: a.now }].slice(-SENT_HISTORY),
      }
    case 'settled':
      return settle({ ...s, pending: Math.max(0, s.pending - 1) })
    case 'failed':
      return { ...s, pending: Math.max(0, s.pending - 1), dirty: true }
    case 'abandoned':
      return settle({ ...s, pending: Math.max(0, s.pending - 1), dirty: false })
    case 'remote': {
      const remote = toSingleLine(a.title)
      // 메아리로 볼 수 있는 최근 기록만 남긴다. 마지막에 보낸 제목은 판정 기준이라 시간과 무관하게 유지한다.
      const last = s.sent[s.sent.length - 1]
      const recent = s.sent.filter((e) => e === last || a.now - e.at <= ECHO_WINDOW_MS)
      // 최근에 보낸 적 없는 제목 = 진짜 원격 변경 → 보낸 기록은 더 이상 메아리 판별에 쓸 수 없다.
      const sent = recent.some((e) => e.title === remote) ? recent : []
      return settle({ ...s, remote, sent })
    }
  }
}

/**
 * 이 제목을 서버로 보내야 하는가 — 원격(서버) 제목과 같고 응답 대기 중인 저장도 없으면 이미 서버 값이라 보낼 것이 없다.
 * 응답 대기 중이면 그 저장이 서버 제목을 바꿀 수 있어 되돌림도 보내야 한다.
 */
export function needsTitleSave(s: TitleSyncState, title: string): boolean {
  return title !== s.remote || s.pending > 0
}

/** 첫 재시도 간격 — 실패마다 두 배. */
export const TITLE_RETRY_BASE_MS = 1000
/** 재시도 간격 상한. */
export const TITLE_RETRY_MAX_MS = 30_000
/** 같은 제목의 자동 재시도 횟수 상한 — 넘으면 멈추고 blur·언마운트·다음 입력 때 다시 보낸다. */
export const TITLE_RETRY_MAX_ATTEMPTS = 6

/** 다시 보내도 결과가 같은 실패인가 — 4xx(요청 시간 초과 408·요청 과다 429 제외). 네트워크 오류·5xx 는 일시 실패. */
export function isPermanentTitleSaveError(err: unknown): boolean {
  return isPermanentClientStatus((err as { response?: { status?: number } } | null)?.response?.status)
}

export interface TitleSaverDeps {
  /** 제목 한 건 저장 요청. */
  send(title: string): Promise<unknown>
  /** 입력 멈춤 대기(디바운스). */
  debounceMs: number
  /** 보냄 / 성공 / 일시 실패(다시 보냄) / 포기 — titleSyncReducer 의 sent·settled·failed·abandoned 로 잇는다. */
  onSent(title: string): void
  onSettled(): void
  onFailed(): void
  onAbandoned(): void
  /** 실패 알림 — 성공하기 전까지 이어진 실패 중 첫 번째에만 부른다(재시도마다 토스트가 쌓이지 않게). */
  onError(err: unknown): void
}

export interface TitleSaver {
  /** 입력이 바뀌었다 — 디바운스 뒤 보낸다. 대기 중인 재시도는 새 입력으로 대체된다. */
  schedule(title: string): void
  /** 대기 중인(디바운스·재시도 대기) 제목을 지금 보낸다 — blur·언마운트. */
  flush(): void
  /** 보낼 것을 버린다 — 원격 제목으로 되돌렸을 때. */
  cancel(): void
  /** 언마운트 — 대기 중인 제목을 보내고, 이후 실패는 재시도하지 않는다. */
  dispose(): void
}

/**
 * 제목 저장 스케줄러(WP-287) — 디바운스·blur/언마운트 즉시 보냄·일시 실패 재시도를 맡는다.
 *
 * 왜: 예전엔 실패하면 대기 중 제목을 이미 비운 뒤라 아무도 다시 보내지 않았다. 서버엔 옛 제목이 남고, 화면은 dirty 로 남아
 * 다른 사람의 제목 변경까지 영영 막았다. 이제 실패한 제목이 가장 최근 입력이면 대기 제목으로 되돌려 1s·2s·4s…(상한 30s)
 * 간격으로 최대 TITLE_RETRY_MAX_ATTEMPTS 번 다시 보낸다. 더 최근 입력이 이미 있으면 그 입력이 서버 값을 정하므로 버린다.
 */
export function createTitleSaver(deps: TitleSaverDeps): TitleSaver {
  let pending: string | null = null
  let latest: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let attempts = 0
  let errorShown = false
  let disposed = false

  const clearTimer = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const send = (title: string) => {
    deps.onSent(title)
    deps.send(title).then(
      () => {
        if (title === latest) attempts = 0
        errorShown = false
        deps.onSettled()
      },
      (err: unknown) => {
        if (!errorShown) deps.onError(err)
        errorShown = true
        // 그새 더 최근 입력이 있으면(대기 중이든 이미 보냈든) 그 입력이 서버 값을 정한다 — 옛 제목은 다시 보내지 않고 이 요청만
        // 끝난 것으로 친다. dirty 로 표시하면 다시 보낼 사람이 없어 원격 제목을 영영 막는다.
        if (title !== latest || pending != null) {
          deps.onSettled()
          return
        }
        if (isPermanentTitleSaveError(err)) {
          // 다시 보내도 같다 — 내 입력을 포기하고 원격 제목을 따른다.
          latest = null
          deps.onAbandoned()
          return
        }
        deps.onFailed()
        pending = title
        attempts += 1
        if (disposed || attempts > TITLE_RETRY_MAX_ATTEMPTS) return
        clearTimer()
        timer = setTimeout(flush, backoffDelay(TITLE_RETRY_BASE_MS, TITLE_RETRY_MAX_MS, attempts))
      },
    )
  }

  function flush() {
    clearTimer()
    const title = pending
    pending = null
    if (title != null) send(title)
  }

  return {
    schedule(title) {
      clearTimer()
      pending = title
      latest = title
      attempts = 0
      timer = setTimeout(flush, deps.debounceMs)
    },
    flush,
    cancel() {
      clearTimer()
      pending = null
      latest = null
      attempts = 0
    },
    dispose() {
      disposed = true
      flush()
    },
  }
}
