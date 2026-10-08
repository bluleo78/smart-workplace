import { HocuspocusProvider } from '@hocuspocus/provider'
import {
  CLOSE_DELETED,
  CLOSE_FORBIDDEN,
  CLOSE_TOKEN_EXPIRED,
  COLLAB_NS_STORAGE_KEY,
  COLLAB_SCHEMA_MISMATCH,
  COLLAB_SCHEMA_PARAM,
  collabDocName,
  WIKI_SCHEMA_VERSION,
} from '@smart-workplace/wiki-editor-schema/collab-protocol'
import * as Y from 'yjs'

import { getAccessToken, refreshAccessTokenOutcome } from '../../api/client'
import { backoffDelay } from '../backoff'
import { type CollabTerminal, isEditRole, parseRoleMessage } from './collabStatus'

/**
 * 노트별 동기화 세션(Y.Doc + provider) 캐시.
 *
 * 화면 폭이 lg 경계를 넘으면 데스크톱↔모바일 셸이 바뀌며 에디터가 재마운트된다(WP-162). 그때마다 새 문서·연결을
 * 만들면 오프라인 중 아직 못 보낸 입력이 사라지므로, 해제 후 잠깐(GRACE_MS) 살려 두었다가 다시 잡으면 재사용한다.
 * 못 보낸 입력이 남아 있으면 유예도 세지 않고 서버가 다 받을 때까지 붙잡는다 — 다른 노트로 이동해도 탭이 열려 있는 한
 * 입력을 잃지 않는다(오프라인 보관은 메모리만, IndexedDB 없음 — 설계 §7.3).
 *
 * 연결 사실(연결 여부·끊긴 시각·미전송·서버가 알린 권한·접근 거부)도 세션이 들고 있다. 재마운트 직전에 받은
 * 역할 변경·4403 을 훅 상태에 두면 재마운트와 함께 사라지기 때문이다. 훅은 구독해서 읽기만 한다.
 */

/** 세션이 모은 연결 사실 — 상태 칩 판정(deriveSyncStatus)의 입력. 바뀔 때마다 새 객체(스냅샷)로 교체된다. */
export interface CollabSessionState {
  /** 인증과 첫 동기화가 끝나 실시간으로 주고받는 중. */
  connected: boolean
  /** 끊긴(또는 아직 못 붙은) 시각(ms). 연결 중이면 null. */
  disconnectedSince: number | null
  /** 한 번이라도 인증·동기화를 마쳤다(이후 끊겨도 true) — 그 전엔 문서가 비어 있어 화면이 본문 대신 skeleton 을 보인다. */
  everSynced: boolean
  /** 내가 입력했는데 서버가 아직 확인하지 않은 변경이 있다. */
  unsynced: boolean
  /** 서버가 알려 준 읽기 전용 여부(인증 scope·역할 변경 알림). 아직 모르면 null. */
  serverReadOnly: boolean | null
  /** 재연결하지 않는 종단 상태(권한 없음 / 삭제 / 로그인 상실 / 스키마 판 불일치). 아니면 null. 종류는 CollabTerminal 참조. */
  terminal: CollabTerminal | null
}

export interface CollabSession {
  /** 노트 id — 정리된 세션을 다시 잡으려 할 때 같은 페이지의 새 세션을 여는 데 쓴다. */
  pageId: number
  doc: Y.Doc
  provider: HocuspocusProvider
  docName: string
  /** 현재 상태 스냅샷 — 바뀌지 않았으면 같은 객체(useSyncExternalStore 용). */
  getState(): CollabSessionState
  /** 상태 변경 구독. 반환 함수로 해지한다. */
  subscribe(listener: () => void): () => void
}

/** 아무도 쓰지 않는 세션을 살려 두는 시간 — 셸 전환 재마운트를 덮을 만큼만. */
const GRACE_MS = 5000
/** 인증이 일시적 이유(불러오기 실패 등)로 거절됐을 때 다시 붙기까지의 첫 간격 — 연달아 실패하면 두 배씩 늘린다. */
const AUTH_RETRY_MS = 3000
/** 연속 인증 실패 재시도 간격 상한 — 장애가 길어져도 API·동기화 서버를 3초마다 두드리지 않게. */
const AUTH_RETRY_MAX_MS = 60_000

/**
 * 마지막으로 보낸 토큰의 출처 — 'forbidden' 거절이 진짜 권한 없음인지 낡은 토큰 탓인지 가르는 데 쓴다.
 * 'refresh-failed' 는 갱신의 일시 실패(네트워크·5xx), 'refresh-rejected' 는 서버가 refresh 쿠키를 거절(로그인 상실).
 */
type TokenSource = 'fresh' | 'stale' | 'refresh-failed' | 'refresh-rejected'

interface Entry {
  pageId: number
  session: CollabSession
  /** 이 세션을 쓰는 화면 수. 0 이 되면 유예 후(미전송 없을 때) 정리한다. */
  holders: number
  /** 유예 정리 타이머. */
  timer: ReturnType<typeof setTimeout> | null
  /** 인증 재시도 타이머. */
  retryTimer: ReturnType<typeof setTimeout> | null
  /** 인증 성공 이후 연속 인증 실패 수 — 재시도 간격(지수 증가)을 정한다. 인증되면 0. */
  authFailures: number
  state: CollabSessionState
  listeners: Set<() => void>
  /** 다음 재접속 때 토큰을 갱신해야 함(4401·token-expired·낡은 토큰의 forbidden 이후). */
  needsRefresh: boolean
  /** 마지막 인증에 보낸 토큰의 출처. */
  lastToken: TokenSource
  /** 마지막으로 서버가 다 받은 뒤 내 입력이 있었는지 — 핸드셰이크만으로 생긴 대기 수를 미전송으로 오인하지 않게 한다. */
  dirty: boolean
  destroyed: boolean
}

/** 종단으로 닫는 종료 코드 → 종단 상태, 우선순위 순(삭제가 권한 회수보다 먼저). */
const CLOSE_TERMINAL: readonly (readonly [{ code: number; reason: string }, CollabTerminal])[] = [
  [CLOSE_DELETED, 'deleted'],
  [CLOSE_FORBIDDEN, 'forbidden'],
]

/** 페이지별 현재 세션(재사용 대상). 종단 세션은 여기서 빠진다. */
const current = new Map<number, Entry>()
/** 살아 있는 모든 세션 — 캐시에서 빠졌지만 아직 화면이 쥔 종단 세션 포함. */
const entries = new Map<CollabSession, Entry>()

/**
 * 토큰 갱신 단일화 — 모든 세션이 같은 JWT 를 쓰므로 만료(4401)도 동시에 맞는다. 세션마다 따로 갱신하면 refresh 토큰을
 * 회전하는 서버에서 두 번째 호출이 실패해 로그아웃(setAccessToken(null))될 수 있어, 진행 중인 갱신을 함께 기다린다.
 */
let refreshing: Promise<'ok' | 'rejected' | 'error'> | null = null
function refreshOnce(): Promise<'ok' | 'rejected' | 'error'> {
  refreshing ??= refreshAccessTokenOutcome().finally(() => {
    refreshing = null
  })
  return refreshing
}

/** 문서 이름 — E2E 빌드는 테스트마다 네임스페이스를 붙여 병렬 테스트끼리 문서가 섞이지 않게 한다(규약은 collab-protocol). */
function docNameFor(pageId: number): string {
  const ns = __E2E__ ? (globalThis.localStorage?.getItem(COLLAB_NS_STORAGE_KEY) ?? '') : ''
  return collabDocName(ns, pageId)
}

/**
 * 동기화 서버 주소 — 같은 출처의 /collab(개발은 vite 프록시, 운영은 nginx 가 넘긴다).
 * 이 탭이 빌드된 스키마 판을 쿼리로 싣는다(WP-313) — 서버는 판이 다르면 문서를 주기 전에 거부한다.
 * Hocuspocus 4 provider 엔 접속 파라미터 옵션이 없어 URL 쿼리로 보낸다(토큰에 섞으면 API 인증 토큰 규약이 흐려진다).
 */
function collabUrl(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab?${COLLAB_SCHEMA_PARAM}=${WIKI_SCHEMA_VERSION}`
}

/**
 * 서버가 다 받기 전에 놓으면 안 되는 입력이 있는지 — 읽기 전용·권한 없음(forbidden)·삭제(deleted) 세션의 입력은 영원히 확인되지 않으므로 제외.
 * 로그인 상실(authLost)은 포함한다 — 다시 로그인하러 떠날 때(axios 인터셉터의 /login 이동·안내의 "다시 로그인") 탭 이탈 경고로
 * 미전송 입력이 있음을 알려야 한다. 보유자가 없는 종단 세션의 정리는 onStateChanged 가 isTerminal 로 먼저 판단한다.
 */
function isPending(entry: Entry): boolean {
  const { unsynced, serverReadOnly, terminal } = entry.state
  // 스키마 판이 달라진 세션(schemaStale)도 입력이 영원히 확인되지 않는다 — 새로고침 안내가 그 사실을 함께 알린다.
  // 삭제(deleted)는 보낼 문서가 없어 탭 이탈 경고 대상이 아니다.
  return unsynced && serverReadOnly !== true && (terminal === null || terminal === 'authLost')
}

/** 재연결하지 않는 종단 상태(권한 없음, 삭제, 로그인 상실, 스키마 판 불일치). */
function isTerminal(entry: Entry): boolean {
  return entry.state.terminal !== null
}

/**
 * 상태 일부를 바꾸고, 실제로 바뀌었을 때만 새 스냅샷을 만들어 알린다.
 * 입력마다(syncUnsynced) 불리는 경로라 바뀐 키가 없으면 새 객체를 만들지 않는다.
 */
function patch(entry: Entry, next: Partial<CollabSessionState>): void {
  if (entry.destroyed) return
  const keys = Object.keys(next) as (keyof CollabSessionState)[]
  if (keys.every((k) => next[k] === entry.state[k])) return
  entry.state = { ...entry.state, ...next }
  entry.listeners.forEach((fn) => fn())
  onStateChanged(entry)
}

function markDisconnected(entry: Entry): void {
  patch(entry, { connected: false, disconnectedSince: entry.state.disconnectedSince ?? Date.now() })
}

function markConnectedIfReady(entry: Entry): void {
  const { provider } = entry.session
  if (provider.isAuthenticated && provider.isSynced) {
    patch(entry, { connected: true, everSynced: true, disconnectedSince: null })
  }
}

function syncUnsynced(entry: Entry): void {
  patch(entry, { unsynced: entry.dirty && entry.session.provider.hasUnsyncedChanges })
}

/**
 * 종단 상태로 멈춘다 — 재시도 타이머를 끄고, 동기로 끊어 provider 의 자동 재연결을 막고, 캐시에서 뺀다(다시 열면 새 세션으로 처음부터 판정).
 * disconnect() 는 동기로 불러야 provider 가 소켓 종료 처리 중 예약하는 자동 재연결을 막는다.
 * - forbidden: 권한 없음, 또는 삭제 여부를 모르는 거절.
 * - deleted: 페이지 삭제(4404) — 다시 붙을 문서가 없다.
 * - authLost: 로그인 상실(refresh 쿠키 거절) — 다시 로그인하기 전엔 어떤 토큰으로도 붙을 수 없다. 계속 재시도하면 /auth/refresh 와
 *   collab-access 를 끝없이 두드린다. 앱의 다른 곳(axios 인터셉터·SSE)도 refresh 실패 뒤엔 재시도하지 않는다.
 * - schemaStale: 동기화 서버의 스키마 판이 다름(WP-313) — 새로고침해 새 에디터를 받기 전엔 몇 번을 다시 붙어도 거절된다.
 */
function stopTerminal(entry: Entry, terminal: CollabTerminal): void {
  if (entry.state.terminal) return
  if (entry.retryTimer) clearTimeout(entry.retryTimer)
  entry.retryTimer = null
  entry.session.provider.disconnect()
  if (current.get(entry.pageId) === entry) current.delete(entry.pageId)
  patch(entry, { terminal })
}

/** 일시적 인증 거절 — 소켓을 끊었다가 잠시 뒤 다시 붙는다(provider 는 인증 실패 뒤 스스로 재시도하지 않는다). */
function scheduleAuthRetry(entry: Entry, delayMs = AUTH_RETRY_MS): void {
  if (entry.retryTimer) clearTimeout(entry.retryTimer)
  const { provider } = entry.session
  provider.disconnect()
  const reconnect = () => {
    if (!entry.destroyed && !isTerminal(entry)) void provider.connect()
  }
  entry.retryTimer = setTimeout(() => {
    entry.retryTimer = null
    // disconnect() 의 소켓 닫힘은 비동기다. 아직 닫히는 중(connected)에 connect() 하면 provider 가 "이미 연결됨"으로
    // 무시하고, 닫힌 뒤엔 disconnect() 가 끈 자동 재연결도 없어 영영 다시 붙지 않는다 — 닫힌 다음에 붙는다.
    const ws = provider.configuration.websocketProvider
    if (ws?.status !== 'connected') {
      reconnect()
      return
    }
    const onStatus = ({ status }: { status: string }) => {
      if (status !== 'disconnected') return
      ws.off('status', onStatus)
      reconnect()
    }
    ws.on('status', onStatus)
  }, delayMs)
}

/**
 * 인증 거절 처리.
 * - schema-mismatch: 동기화 서버의 스키마 판이 이 탭과 다름(배포) → 종단(새로고침 안내).
 * - invalid-document: 문서 이름 자체가 틀림 → 종단.
 * - forbidden: 갓 갱신한 토큰으로도 거절됐을 때만 종단. API 는 만료 토큰도 401 → 'forbidden' 으로 돌려주므로,
 *   토큰 수명보다 긴 오프라인 뒤 재접속(4401 을 못 받은 경우)을 '삭제·권한 없음'으로 오판하면 미전송 입력까지 버리게 된다.
 *   낡은 토큰이었으면 갱신해 곧바로 다시 붙는다.
 * - 갱신이 거절됐으면(refresh 4xx — 로그아웃·만료) 무엇으로 거절됐든 로그인 상실 종단. 갱신의 일시 실패(네트워크·5xx)는
 *   권한 판정이 아니므로 종단으로 두지 않는다.
 * - token-expired·그 밖(불러오기 실패·갱신 일시 실패 등): 일시적 → 갱신 표시 후 간격을 두고 재시도. 간격은 연속 실패마다 두 배(상한 있음).
 */
function onAuthFailed(entry: Entry, reason: string): void {
  // 스키마 판 불일치는 토큰과 무관한 맨 앞 판정(서버가 인증 전에 거부) — 토큰 출처보다 먼저 본다.
  if (reason === COLLAB_SCHEMA_MISMATCH) {
    stopTerminal(entry, 'schemaStale')
    return
  }
  if (entry.lastToken === 'refresh-rejected') {
    stopTerminal(entry, 'authLost')
    return
  }
  if (reason === 'invalid-document' || (reason === 'forbidden' && entry.lastToken === 'fresh')) {
    stopTerminal(entry, 'forbidden')
    return
  }
  if (reason === 'forbidden' || reason === 'token-expired') entry.needsRefresh = true
  if (reason === 'forbidden' && entry.lastToken === 'stale') {
    // 낡은 토큰 탓 — 갱신해 곧바로 다시 붙는다(실패로 세지 않는다).
    scheduleAuthRetry(entry, 0)
    return
  }
  entry.authFailures += 1
  scheduleAuthRetry(entry, authRetryDelay(entry.authFailures))
}

/** n 번째 연속 인증 실패 뒤 재시도 간격 — 3s, 6s, 12s … 상한 AUTH_RETRY_MAX_MS. */
function authRetryDelay(failures: number): number {
  return backoffDelay(AUTH_RETRY_MS, AUTH_RETRY_MAX_MS, failures)
}

/** 아무도 안 쓰는 세션의 정리 시점 판단 — 상태가 바뀔 때마다, 그리고 마지막 보유자가 놓을 때 부른다. */
function onStateChanged(entry: Entry): void {
  updateBeforeUnload()
  if (entry.holders > 0 || entry.destroyed) return
  if (isTerminal(entry)) {
    destroyEntry(entry)
    return
  }
  if (isPending(entry)) {
    // 못 보낸 입력이 생기면 유예를 멈추고 서버가 받을 때까지 붙잡는다(R15).
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = null
    return
  }
  if (!entry.timer) entry.timer = setTimeout(() => destroyEntry(entry), GRACE_MS)
}

function destroyEntry(entry: Entry): void {
  if (entry.destroyed) return
  if (entry.timer) clearTimeout(entry.timer)
  if (entry.retryTimer) clearTimeout(entry.retryTimer)
  entry.timer = entry.retryTimer = null
  entry.destroyed = true
  entry.listeners.clear()
  entries.delete(entry.session)
  if (current.get(entry.pageId) === entry) current.delete(entry.pageId)
  entry.session.provider.destroy()
  entry.session.doc.destroy()
  updateBeforeUnload()
}

/** 새 세션 생성 — provider 이벤트를 상태로 옮기는 배선까지 한다. */
function createEntry(pageId: number): Entry {
  const doc = new Y.Doc()
  const docName = docNameFor(pageId)
  // entry 는 아래에서 채운다 — token 콜백과 이벤트 핸들러가 같은 entry 를 참조해야 한다.
  // eslint-disable-next-line prefer-const
  let entry: Entry
  const provider = new HocuspocusProvider({
    url: collabUrl(),
    name: docName,
    document: doc,
    // 재접속마다 호출된다. 만료(4401)로 끊겼거나 메모리에 토큰이 없으면 갱신 후 보낸다 — 만료 토큰은 여전히
    // 메모리에 남아 있어(null 이 아님) 그냥 꺼내 쓰면 같은 거절이 반복된다. provider 가 이 Promise 를 기다리므로 경합이 없다.
    token: async () => {
      if (entry.needsRefresh || !getAccessToken()) {
        entry.needsRefresh = false
        const outcome = await refreshOnce()
        entry.lastToken = outcome === 'ok' ? 'fresh' : outcome === 'rejected' ? 'refresh-rejected' : 'refresh-failed'
      } else {
        entry.lastToken = 'stale'
      }
      return getAccessToken() ?? ''
    },
  })
  const session: CollabSession = {
    pageId,
    doc,
    provider,
    docName,
    getState: () => entry.state,
    subscribe: (listener) => {
      entry.listeners.add(listener)
      return () => entry.listeners.delete(listener)
    },
  }
  entry = {
    pageId,
    session,
    holders: 0,
    timer: null,
    retryTimer: null,
    authFailures: 0,
    state: {
      connected: false,
      everSynced: false,
      disconnectedSince: Date.now(),
      unsynced: false,
      serverReadOnly: null,
      terminal: null,
    },
    listeners: new Set(),
    needsRefresh: false,
    lastToken: 'stale',
    dirty: false,
    destroyed: false,
  }

  // 내 입력(원격 반영은 provider 가 origin) — 서버가 다 받을 때까지 미전송 후보.
  doc.on('update', (_update: Uint8Array, origin: unknown) => {
    if (origin === provider) return
    entry.dirty = true
    syncUnsynced(entry)
  })
  provider.on('unsyncedChanges', ({ number }: { number: number }) => {
    if (number === 0) entry.dirty = false
    syncUnsynced(entry)
  })
  provider.on('status', ({ status }: { status: string }) => {
    if (status !== 'connected') markDisconnected(entry)
  })
  provider.on('authenticated', ({ scope }: { scope: string }) => {
    entry.authFailures = 0
    patch(entry, { serverReadOnly: scope === 'readonly' })
    markConnectedIfReady(entry)
  })
  provider.on('synced', () => markConnectedIfReady(entry))
  // 소켓 종료 — 4401 은 다음 재접속(provider 자동)에 새 토큰, 4403(권한 회수)·4404(삭제)는 종단.
  provider.on('disconnect', ({ event }: { event: { code: number } }) => {
    markDisconnected(entry)
    if (event.code === CLOSE_TOKEN_EXPIRED.code) entry.needsRefresh = true
    const hit = CLOSE_TERMINAL.find(([c]) => c.code === event.code)
    if (hit) stopTerminal(entry, hit[1])
  })
  // 문서 단위 종료(CLOSE 메시지, 코드 1000)는 소켓이 열린 채 남고 provider 가 다시 붙지 않는다 — 직접 다시 붙인다.
  provider.on('close', ({ event }: { event: { code: number; reason?: string } }) => {
    markDisconnected(entry)
    // 문서 단위 종료는 코드가 1000 이라 사유로도 맞춘다.
    const hit = CLOSE_TERMINAL.find(([c]) => c.code === event.code || c.reason === event.reason)
    if (hit) stopTerminal(entry, hit[1])
    else if (provider.configuration.websocketProvider?.status === 'connected') scheduleAuthRetry(entry)
  })
  provider.on('authenticationFailed', ({ reason }: { reason: string }) => {
    markDisconnected(entry)
    onAuthFailed(entry, reason)
  })
  // 세션 도중 역할 변경 알림 — Hocuspocus 는 연결 중 권한을 바꾸는 메시지가 없어 서버가 stateless 로 알린다.
  provider.on('stateless', ({ payload }: { payload: string }) => {
    const role = parseRoleMessage(payload)
    if (role !== null) patch(entry, { serverReadOnly: !isEditRole(role) })
  })

  entries.set(session, entry)
  current.set(pageId, entry)
  return entry
}

/**
 * 세션을 얻되 보유자로 등록하지는 않는다 — 렌더 중 세션이 필요할 때(에디터 생성) 쓴다.
 * 새로 만든 세션은 곧 retain 되지 않으면 유예 후 정리된다(StrictMode 이중 렌더로 생긴 세션도 새지 않는다).
 */
export function openCollabSession(pageId: number): CollabSession {
  return openEntry(pageId).session
}

/** 페이지의 현재 세션 항목 — 없으면 만들고 아무도 잡지 않으면 유예 정리를 건다. */
function openEntry(pageId: number): Entry {
  const hit = current.get(pageId)
  if (hit) return hit
  const entry = createEntry(pageId)
  onStateChanged(entry)
  return entry
}

/**
 * 이 세션을 쓰기 시작한다 — 유예 정리를 취소하고, 실제로 보유하게 된 세션을 돌려준다.
 * 넘긴 세션이 이미 정리됐으면(렌더와 보유 사이에 유예가 지났거나, 숨겨졌던 화면이 유예 뒤 다시 보일 때) 같은 페이지의
 * 살아 있는 세션을 대신 잡아 돌려준다 — 죽은 provider 를 쥐고 영영 동기화되지 않는 화면이 생기지 않게. 호출자는 반환값을 써야 한다.
 */
export function retainCollabSession(session: CollabSession): CollabSession {
  const entry = entries.get(session) ?? openEntry(session.pageId)
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = null
  entry.holders += 1
  return entry.session
}

/**
 * 보유 해제 — 보유했던 그 세션을 넘긴다(페이지 번호로 놓으면 4403 뒤 같은 페이지의 새 세션을 대신 놓을 수 있다).
 * 마지막 보유자가 놓으면 유예(GRACE_MS) 후 정리 — 단, 못 보낸 입력이 있으면 서버가 받을 때까지 미룬다.
 */
export function releaseCollabSession(session: CollabSession): void {
  const entry = entries.get(session)
  if (!entry || entry.holders === 0) return
  entry.holders -= 1
  onStateChanged(entry)
}

/** 못 보낸 입력이 남은 세션이 있는지(놓인 세션 포함). */
export function hasUnsentCollabChanges(): boolean {
  for (const entry of entries.values()) if (isPending(entry)) return true
  return false
}

// 탭 닫기·새로고침 경고 — 화면이 떠난 뒤 붙잡아 둔 세션도 대상이라 훅이 아니라 캐시 단위로 건다.
// 리스너가 있으면 일부 브라우저가 bfcache 를 끄므로 미전송이 있는 동안만 붙인다.
function onBeforeUnload(e: BeforeUnloadEvent): void {
  e.preventDefault()
  // 구형 브라우저 호환 — returnValue 를 채워야 확인 창을 띄운다.
  e.returnValue = ''
}
let beforeUnloadAttached = false
function updateBeforeUnload(): void {
  if (typeof window === 'undefined') return
  const want = hasUnsentCollabChanges()
  if (want === beforeUnloadAttached) return
  beforeUnloadAttached = want
  if (want) window.addEventListener('beforeunload', onBeforeUnload)
  else window.removeEventListener('beforeunload', onBeforeUnload)
}

/** 테스트 전용 — 모든 세션을 즉시 정리한다. */
export function resetCollabSessionsForTest(): void {
  for (const entry of [...entries.values()]) destroyEntry(entry)
}
