// "깊은 화면" 히스토리 판정 — useHistoryParam 의 열기·닫기 규칙을 순수 함수로 둔다(WP-205).
// 왜: 웹앱 back(엣지 스와이프·Android back)은 history.back() 이라, 깊은 화면은 반드시 자기 히스토리 항목을 가져야
// 그 화면만 닫힌다. 판정을 react-router 밖으로 빼 vitest(node·DOM 라이브러리 없음)로 고정하고, 훅은 실행만 한다.

export type HistoryParamMode = 'query' | 'state'
export type RouterState = Record<string, unknown> | null

export interface HistoryParamOptions {
  /** 열 때·콜드 닫기 때 함께 지울 쿼리 키(예: 드로워 안 폴더 `filesFolder`). */
  clear?: readonly string[]
  /** query = `?key=value`(기본), state = 같은 URL 에 router state 로만 표시(전역 오버레이). */
  mode?: HistoryParamMode
}

/** 현재 위치 스냅숏 — location.search·location.state 와 BrowserRouter 가 history.state 에 심는 idx. */
export interface HistorySnapshot {
  search: string
  state: unknown
  idx: number | null
}

/** 훅이 navigate 로 옮길 실행 계획. */
export type HistoryPlan =
  | { kind: 'none' }
  | { kind: 'go'; delta: number }
  | { kind: 'push' | 'replace'; search: string; state: RouterState }

/** 열림 마크 키 — 값은 "열기"로 push 한 항목의 history.state.idx(openIdx). 하위 push 는 state 를 spread 해 이어받는다. */
export const markKey = (key: string) => `historyParam:${key}`

export function asState(state: unknown): RouterState {
  return state && typeof state === 'object' ? (state as Record<string, unknown>) : null
}

/** 앱 안에서 "열기"(push)로 연 항목인가 — 열림 마크 유무. 전환(replace)·하위 push 는 마크를 이어받고,
 *  콜드 딥링크(홈 위젯·알림·새 탭)는 마크가 없다. 같은 쿼리라도 출처에 따라 화면 해석이 갈릴 때 쓴다(WP-218). */
export function hasOpenMark(state: unknown, key: string): boolean {
  return typeof asState(state)?.[markKey(key)] === 'number'
}

/** URLSearchParams → location.search 문자열(비면 '' — `?` 만 남지 않게). */
export function toSearch(params: URLSearchParams): string {
  const s = params.toString()
  return s ? `?${s}` : ''
}

/** 현재 값 — query 모드는 ?key, state 모드는 state[key](문자열만). */
export function readHistoryParam(
  snap: Pick<HistorySnapshot, 'search' | 'state'>,
  key: string,
  mode: HistoryParamMode = 'query',
): string | null {
  if (mode === 'state') {
    const v = asState(snap.state)?.[key]
    return typeof v === 'string' ? v : null
  }
  return new URLSearchParams(snap.search).get(key)
}

/**
 * 열기·전환 계획.
 * - 같은 값: 무동작(재클릭으로 항목이 쌓이지 않게).
 * - 이미 열림(다른 값): replace + 마크 보존 — 2단 화면에서 행을 바꿀 때마다 back 이 늘지 않게.
 * - 닫힘: push + 마크 = 현재 idx + 1. react-router push 가 `index = getIndex() + 1` 로 새 항목 idx 를 정하므로
 *   push 직전에 결정적으로 안다(별도 replace 로 마크를 심지 않는다 — 그 사이 back 이 오면 마크 없는 항목이 남는다).
 */
export function planOpen(snap: HistorySnapshot, key: string, value: string, opts: HistoryParamOptions = {}): HistoryPlan {
  const mode = opts.mode ?? 'query'
  const current = readHistoryParam(snap, key, mode)
  if (current === value) return { kind: 'none' }
  const prev = asState(snap.state)
  let search = snap.search
  if (mode === 'query') {
    const params = new URLSearchParams(snap.search)
    for (const k of opts.clear ?? []) params.delete(k)
    params.set(key, value)
    search = toSearch(params)
  }
  const valueState = mode === 'state' ? { [key]: value } : {}
  if (current != null) return { kind: 'replace', search, state: { ...prev, ...valueState } }
  const openIdx = (snap.idx ?? 0) + 1
  return { kind: 'push', search, state: { ...prev, ...valueState, [markKey(key)]: openIdx } }
}

/**
 * 닫기 계획 — ‹·✕·ESC·바깥 클릭 공통. 원칙: ‹ = 시스템 back.
 * 1. 마크(openIdx ≤ 현재 idx)가 있으면 연 시점 직전까지 한 번에 되돌린다(하위 push 가 쌓여도 한 번에).
 * 2. 마크 없고 idx>0 이면 -1 — 다른 화면 링크로 들어온 경우 출발 화면으로(시스템 back 과 같다).
 * 3. 콜드 진입(푸시 알림·주소 붙여넣기)이면 키(+clear 하위 키)만 지우고 replace — 다른 쿼리를 보존해 앱 밖으로 나가지 않는다.
 */
export function planClose(snap: HistorySnapshot, key: string, opts: HistoryParamOptions = {}): HistoryPlan {
  const mode = opts.mode ?? 'query'
  if (readHistoryParam(snap, key, mode) == null) return { kind: 'none' }
  const prev = asState(snap.state)
  const openIdx = prev?.[markKey(key)]
  if (typeof openIdx === 'number' && snap.idx != null && openIdx >= 1 && openIdx <= snap.idx) {
    return { kind: 'go', delta: openIdx - 1 - snap.idx }
  }
  if (snap.idx != null && snap.idx > 0) return { kind: 'go', delta: -1 }
  let search = snap.search
  if (mode === 'query') {
    const params = new URLSearchParams(snap.search)
    params.delete(key)
    for (const k of opts.clear ?? []) params.delete(k)
    search = toSearch(params)
  }
  return { kind: 'replace', search, state: stripHistoryKey(prev, key, mode) }
}

/**
 * router state 에서 key 의 열림 마크(state 모드면 key 자체도)를 뺀 사본. 남는 게 없으면 null.
 * 콜드 닫기·새로고침 뒤 남은 표식 정리가 함께 쓴다 — 다른 state 는 보존한다.
 */
export function stripHistoryKey(state: unknown, key: string, mode: HistoryParamMode = 'query'): RouterState {
  const rest: Record<string, unknown> = { ...asState(state) }
  delete rest[markKey(key)]
  if (mode === 'state') delete rest[key]
  return Object.keys(rest).length > 0 ? rest : null
}

/** 숫자 id 파라미터 해석 — 양의 정수만 인정하고, 비었거나 잘못된 값은 null(닫힘). */
export function parseId(v: string | null): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * 닫기 중복 방지 — 같은 위치(location.key)에서 온 두 번째 닫기를 거절한다(‹ 연타·ESC+onOpenChange).
 * 위치가 바뀌면(닫힘 되돌림·forward 로 다시 열림) reset 해야 한다 — 안 풀면 forward 로 돌아온 같은 key 에서 닫기가 영영 무시된다.
 */
export function createCloseGuard() {
  let closedKey: string | null = null
  return {
    claim(locationKey: string): boolean {
      if (closedKey === locationKey) return false
      closedKey = locationKey
      return true
    },
    reset(): void {
      closedKey = null
    },
  }
}

// ── window.history.state 직접 접근은 아래 헬퍼로만 한다 ──
// react-router v7 BrowserRouter 는 history.state 를 { usr: router state, key: 위치 key, idx: 위치 번호 } 로 둔다.
type BrowserHistoryState = { usr?: unknown; key?: unknown; idx?: unknown } | null

function rawHistoryState(): BrowserHistoryState {
  return window.history.state as BrowserHistoryState
}

/**
 * BrowserRouter 가 history.state 에 심는 현재 위치 번호. 없으면(라우터 밖 상태) null.
 * useHistoryParam·useIssueOrigin(#885)이 함께 쓰는 단일 헬퍼 — 판정 함수와 달리 window 를 읽으므로 호출 시점에만 평가한다.
 */
export function currentHistoryIdx(): number | null {
  const idx = rawHistoryState()?.idx
  return typeof idx === 'number' ? idx : null
}

/** 지금 브라우저가 가리키는 위치 key — react-router 와 같은 규칙(없거나 빈 값이면 "default"). 낡은 콜백 판별용. */
export function liveHistoryKey(): string {
  const key = rawHistoryState()?.key
  return typeof key === 'string' && key ? key : 'default'
}

/** 지금 브라우저 항목의 router state(usr). popstate 처럼 라우터 갱신 전 시점에 읽을 때 쓴다. */
export function currentHistoryState(): RouterState {
  return asState(rawHistoryState()?.usr)
}

/** 지금 브라우저 항목에 state 모드 표식이 있는지 — 라우터 위치 갱신(transition)보다 빠른 history.state 로 판정(WP-209). */
export function hasLiveStateMark(key: string): boolean {
  return readHistoryParam({ search: '', state: currentHistoryState() }, key, 'state') != null
}
