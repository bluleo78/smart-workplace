// @vitest-environment jsdom
import {
  COLLAB_SCHEMA_MISMATCH,
  COLLAB_SCHEMA_PARAM,
  WIKI_SCHEMA_VERSION,
} from '@smart-workplace/wiki-editor-schema/collab-protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 실제 웹소켓 없이 캐시·상태 규칙만 검증한다 — provider 는 이벤트만 흉내 내는 가짜로 바꾸고 destroy 여부를 기록한다.
const { destroyed, providers, auth } = vi.hoisted(() => ({
  destroyed: [] as string[],
  providers: [] as FakeProviderLike[],
  auth: { token: 'old' as string | null, refreshed: 0, refreshOutcome: 'ok' as 'ok' | 'rejected' | 'error' },
}))

interface FakeProviderLike {
  configuration: { name: string; token: () => Promise<string> }
}

vi.mock('@hocuspocus/provider', () => {
  /** 소켓 계층(provider.configuration.websocketProvider) — 상태와 status 이벤트만 흉내 낸다. */
  class FakeSocket {
    status = 'disconnected'
    private statusListeners = new Set<(e: { status: string }) => void>()
    on(_event: 'status', fn: (e: { status: string }) => void) {
      this.statusListeners.add(fn)
    }
    off(_event: 'status', fn: (e: { status: string }) => void) {
      this.statusListeners.delete(fn)
    }
    setStatus(status: string) {
      this.status = status
      this.statusListeners.forEach((fn) => fn({ status }))
    }
  }
  class FakeProvider {
    configuration: { name: string; token: () => Promise<string>; websocketProvider: FakeSocket }
    unsyncedChanges = 0
    isAuthenticated = false
    isSynced = false
    disconnectCalls = 0
    connectCalls = 0
    private listeners = new Map<string, Set<(...args: unknown[]) => void>>()
    constructor(config: { name: string; token: () => Promise<string> }) {
      this.configuration = { ...config, websocketProvider: new FakeSocket() }
      providers.push(this)
    }
    get hasUnsyncedChanges() {
      return this.unsyncedChanges > 0
    }
    on(event: string, fn: (...args: unknown[]) => void) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set())
      this.listeners.get(event)!.add(fn)
      return this
    }
    off(event: string, fn: (...args: unknown[]) => void) {
      this.listeners.get(event)?.delete(fn)
      return this
    }
    emit(event: string, ...args: unknown[]) {
      this.listeners.get(event)?.forEach((fn) => fn(...args))
    }
    disconnect() {
      this.disconnectCalls += 1
    }
    async connect() {
      this.connectCalls += 1
    }
    destroy() {
      destroyed.push(this.configuration.name)
      this.listeners.clear()
    }
  }
  return { HocuspocusProvider: FakeProvider }
})

vi.mock('../../api/client', () => ({
  getAccessToken: () => auth.token,
  refreshAccessTokenOutcome: async () => {
    auth.refreshed += 1
    await Promise.resolve()
    auth.token = auth.refreshOutcome === 'ok' ? `fresh-${auth.refreshed}` : null
    return auth.refreshOutcome
  },
}))

import * as Y from 'yjs'

import {
  type CollabSession,
  hasUnsentCollabChanges,
  openCollabSession,
  releaseCollabSession,
  resetCollabSessionsForTest,
  retainCollabSession,
} from './collabSession'

/** 세션을 얻고 보유자로 등록한다 — 화면이 렌더 중 열고(open) 마운트 후 잡는(retain) 순서를 한 번에. */
const acquireCollabSession = (pageId: number): CollabSession => retainCollabSession(openCollabSession(pageId))

/** 테스트에서 가짜 provider 의 조작용 메서드에 접근한다. */
type Fake = {
  unsyncedChanges: number
  isAuthenticated: boolean
  isSynced: boolean
  disconnectCalls: number
  connectCalls: number
  emit: (event: string, ...args: unknown[]) => void
  configuration: {
    token: () => Promise<string>
    websocketProvider: { status: string; setStatus: (status: string) => void }
  }
}
const fake = (s: CollabSession) => s.provider as unknown as Fake

/** 서버 인증·첫 동기화가 끝난 상태로 만든다. */
function goLive(s: CollabSession, scope: 'read-write' | 'readonly' = 'read-write') {
  const p = fake(s)
  p.isAuthenticated = true
  p.emit('authenticated', { scope })
  p.isSynced = true
  p.emit('synced', { state: true })
}

/** 서버 확인 대기 수를 바꾼다. n>0 이면 그 원인이 된 로컬 입력도 문서에 넣는다(실제 provider 와 같은 순서). */
function setUnsynced(s: CollabSession, n: number) {
  if (n > 0) s.doc.getText('t').insert(0, 'x')
  fake(s).unsyncedChanges = n
  fake(s).emit('unsyncedChanges', { number: n })
}

describe('collab session cache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    destroyed.length = 0
    providers.length = 0
    auth.token = 'old'
    auth.refreshed = 0
    auth.refreshOutcome = 'ok'
  })
  afterEach(() => {
    resetCollabSessionsForTest()
    vi.useRealTimers()
  })

  it('reuses cached session within grace period', () => {
    const a = acquireCollabSession(1)
    releaseCollabSession(a)
    vi.advanceTimersByTime(3000)
    expect(acquireCollabSession(1)).toBe(a)
    expect(destroyed).toEqual([])
  })

  it('destroys after grace period', () => {
    const a = acquireCollabSession(2)
    releaseCollabSession(a)
    vi.advanceTimersByTime(4999)
    expect(destroyed).toEqual([])
    vi.advanceTimersByTime(2)
    expect(destroyed).toEqual(['wiki-page:2'])
  })

  it('keeps session while another holder remains', () => {
    const a = acquireCollabSession(3)
    acquireCollabSession(3)
    releaseCollabSession(a)
    vi.advanceTimersByTime(10_000)
    expect(acquireCollabSession(3)).toBe(a)
    expect(destroyed).toEqual([])
  })

  it('creates a new session after the old one was destroyed', () => {
    const a = acquireCollabSession(4)
    releaseCollabSession(a)
    vi.advanceTimersByTime(5001)
    const b = acquireCollabSession(4)
    expect(b).not.toBe(a)
    expect(b.docName).toBe('wiki-page:4')
  })

  // R15 — 아직 못 보낸 입력이 있으면 다른 페이지로 이동해도 문서·연결을 버리지 않는다.
  it('keeps a released session with unsent changes until they sync, then applies the grace period', () => {
    const a = acquireCollabSession(5)
    goLive(a)
    fake(a).emit('disconnect', { event: { code: 1006, reason: '' } })
    setUnsynced(a, 2)
    releaseCollabSession(a)
    vi.advanceTimersByTime(60_000)
    expect(destroyed).toEqual([])
    expect(hasUnsentCollabChanges()).toBe(true)

    // 그 사이 다시 열면 같은 세션(입력 보존)
    expect(acquireCollabSession(5)).toBe(a)
    releaseCollabSession(a)
    vi.advanceTimersByTime(60_000)
    expect(destroyed).toEqual([])

    // 재연결 후 서버가 다 받으면 그때부터 유예를 센다
    goLive(a)
    setUnsynced(a, 0)
    expect(hasUnsentCollabChanges()).toBe(false)
    vi.advanceTimersByTime(4999)
    expect(destroyed).toEqual([])
    vi.advanceTimersByTime(2)
    expect(destroyed).toEqual(['wiki-page:5'])
  })

  it('cancels the pending grace timer when changes appear after release', () => {
    const a = acquireCollabSession(6)
    goLive(a)
    releaseCollabSession(a)
    vi.advanceTimersByTime(3000)
    setUnsynced(a, 1)
    vi.advanceTimersByTime(10_000)
    expect(destroyed).toEqual([])
    setUnsynced(a, 0)
    vi.advanceTimersByTime(5001)
    expect(destroyed).toEqual(['wiki-page:6'])
  })

  // 읽기 전용 연결의 수정은 서버가 확인해 주지 않아 영원히 미전송으로 남는다 — 그걸 이유로 붙잡지 않는다.
  it('does not hold a read-only session for changes the server will never ack', () => {
    const a = acquireCollabSession(7)
    goLive(a, 'readonly')
    setUnsynced(a, 1)
    expect(hasUnsentCollabChanges()).toBe(false)
    releaseCollabSession(a)
    vi.advanceTimersByTime(5001)
    expect(destroyed).toEqual(['wiki-page:7'])
  })

  it('tracks connection facts in the session state', () => {
    const a = acquireCollabSession(8)
    const created = a.getState()
    expect(created.connected).toBe(false)
    expect(created.disconnectedSince).toBe(Date.now())

    const seen: number[] = []
    const unsub = a.subscribe(() => seen.push(1))
    goLive(a)
    expect(a.getState()).toMatchObject({ connected: true, disconnectedSince: null, serverReadOnly: false })
    expect(seen.length).toBeGreaterThan(0)

    vi.advanceTimersByTime(1234)
    const dropAt = Date.now()
    fake(a).emit('disconnect', { event: { code: 1006, reason: '' } })
    expect(a.getState()).toMatchObject({ connected: false, disconnectedSince: dropAt })
    // 같은 끊김 동안 close 가 이어 와도 끊긴 시각은 처음 값을 유지한다
    vi.advanceTimersByTime(500)
    fake(a).emit('close', { event: { code: 1006, reason: '' } })
    expect(a.getState().disconnectedSince).toBe(dropAt)
    unsub()
  })

  it('keeps the snapshot object stable when nothing changed', () => {
    const a = acquireCollabSession(9)
    const s1 = a.getState()
    fake(a).emit('status', { status: 'connecting' })
    expect(a.getState()).toBe(s1)
  })

  // 서버가 세션 도중 역할을 바꾸면(collab:role) 편집 가능 여부를 갱신한다.
  it('follows role changes from the server', () => {
    const a = acquireCollabSession(10)
    expect(a.getState().serverReadOnly).toBeNull()
    goLive(a)
    expect(a.getState().serverReadOnly).toBe(false)
    fake(a).emit('stateless', { payload: '{"type":"collab:role","role":"VIEWER"}' })
    expect(a.getState().serverReadOnly).toBe(true)
    fake(a).emit('stateless', { payload: '{"type":"something-else"}' })
    expect(a.getState().serverReadOnly).toBe(true)
    fake(a).emit('stateless', { payload: '{"type":"collab:role","role":"EDITOR"}' })
    expect(a.getState().serverReadOnly).toBe(false)
  })

  // 4403 — 삭제됐거나 권한이 없다. 재연결을 멈추고 종단 상태로 두며 캐시에서 재사용하지 않는다.
  it('stops reconnecting on 4403 and never reuses the forbidden session', () => {
    const a = acquireCollabSession(11)
    goLive(a)
    setUnsynced(a, 1)
    fake(a).emit('disconnect', { event: { code: 4403, reason: 'forbidden' } })
    expect(fake(a).disconnectCalls).toBe(1)
    expect(a.getState().terminal).toBe('forbidden')
    // 다시 보낼 길이 없는 입력으로 탭 닫기를 막지 않는다
    expect(hasUnsentCollabChanges()).toBe(false)

    const b = acquireCollabSession(11)
    expect(b).not.toBe(a)
    expect(b.getState().terminal).not.toBe('forbidden')

    // 옛 세션의 보유자가 놓으면 유예 없이 바로 정리되고, 새 세션은 그대로 남는다
    releaseCollabSession(a)
    expect(destroyed).toEqual(['wiki-page:11'])
    vi.advanceTimersByTime(10_000)
    expect(destroyed).toEqual(['wiki-page:11'])
    expect(acquireCollabSession(11)).toBe(b)
  })

  // 4404 — 페이지가 삭제됐다. 4403 과 같이 재연결을 멈추되 종단을 'deleted' 로 둬 화면이 "삭제되었습니다"를 고른다.
  it('stops reconnecting on 4404 as deleted and never reuses that session', () => {
    const a = acquireCollabSession(12)
    goLive(a)
    setUnsynced(a, 1)
    fake(a).emit('disconnect', { event: { code: 4404, reason: 'deleted' } })
    expect(fake(a).disconnectCalls).toBe(1)
    expect(a.getState().terminal).toBe('deleted')
    // 보낼 곳이 사라진 입력으로 탭 닫기를 막지 않는다
    expect(hasUnsentCollabChanges()).toBe(false)
    const b = acquireCollabSession(12)
    expect(b).not.toBe(a)
    expect(b.getState().terminal).toBeNull()
    releaseCollabSession(a)
    releaseCollabSession(b)
  })

  // 먼저 닿은 종단이 남는다 — 4404 뒤 provider 재접속의 인증 거절(forbidden)로 '삭제됨'이 흐려지지 않는다.
  it('keeps deleted when a later forbidden arrives', () => {
    const a = acquireCollabSession(13)
    goLive(a)
    fake(a).emit('close', { event: { code: 1000, reason: 'deleted' } })
    expect(a.getState().terminal).toBe('deleted')
    fake(a).emit('disconnect', { event: { code: 4403, reason: 'forbidden' } })
    expect(a.getState().terminal).toBe('deleted')
    releaseCollabSession(a)
  })

  // WP-313 — 동기화 서버가 다른 스키마 판이면 몇 번을 다시 붙어도 거절된다. 재연결을 멈추고 새로고침 안내 상태로 둔다.
  it('stops reconnecting on a schema mismatch, even mid-session, and never reuses the stale session', async () => {
    const a = acquireCollabSession(12)
    goLive(a)
    setUnsynced(a, 1)
    // 세션 도중 서버가 새 판으로 재시작 — 끊긴 뒤 재접속이 schema-mismatch 로 거절된다.
    fake(a).emit('disconnect', { event: { code: 1006, reason: '' } })
    fake(a).emit('authenticationFailed', { reason: COLLAB_SCHEMA_MISMATCH })
    expect(a.getState().terminal).toBe('schemaStale')
    expect(fake(a).disconnectCalls).toBe(1)
    // 토큰 갱신·재시도 없이 멈춘다.
    await vi.advanceTimersByTimeAsync(120_000)
    expect(fake(a).connectCalls).toBe(0)
    expect(auth.refreshed).toBe(0)
    // 저장될 길이 없는 입력으로 탭 닫기·새로고침을 막지 않는다(새로고침 안내가 그 사실을 알린다).
    expect(hasUnsentCollabChanges()).toBe(false)
    expect(acquireCollabSession(12)).not.toBe(a)
  })

  it('sends its schema version on connect', () => {
    const a = acquireCollabSession(13)
    expect((fake(a).configuration as unknown as { url: string }).url).toMatch(new RegExp(`/collab\\?${COLLAB_SCHEMA_PARAM}=${WIKI_SCHEMA_VERSION}$`))
  })

  // 4403 으로 바뀐 뒤 옛 세션을 쥔 화면이 놓아도, 같은 페이지의 새 세션(다른 화면이 쥔)을 대신 놓지 않는다 — 세션 식별로 놓는다.
  it('releases exactly the session it held, never the replacement after a 4403', () => {
    const a = acquireCollabSession(31)
    fake(a).emit('disconnect', { event: { code: 4403, reason: 'forbidden' } })
    const b = acquireCollabSession(31)
    releaseCollabSession(a)
    expect(destroyed).toEqual(['wiki-page:31'])
    // 새 세션은 보유자가 그대로라 유예가 지나도 남는다
    vi.advanceTimersByTime(10_000)
    expect(destroyed).toEqual(['wiki-page:31'])
    expect(acquireCollabSession(31)).toBe(b)
  })

  // 렌더 때 연 세션이 보유 전에 정리됐으면(유예 경과) 죽은 provider 대신 같은 페이지의 살아 있는 세션을 잡아 돌려준다.
  it('retaining an already destroyed session yields and holds a live one', () => {
    const a = openCollabSession(32)
    vi.advanceTimersByTime(5001)
    expect(destroyed).toEqual(['wiki-page:32'])
    const live = retainCollabSession(a)
    expect(live).not.toBe(a)
    expect(live.docName).toBe('wiki-page:32')
    // 보유 중이라 유예가 지나도 정리되지 않고, 다시 열면 같은 세션
    vi.advanceTimersByTime(10_000)
    expect(destroyed).toEqual(['wiki-page:32'])
    expect(openCollabSession(32)).toBe(live)
  })

  // 'forbidden' 은 갓 갱신한 토큰으로도 거절됐을 때만 종단 — 만료 토큰도 API 가 401 → 'forbidden' 으로 돌려주기 때문.
  it('treats a forbidden auth failure as terminal only after a fresh token', async () => {
    const a = acquireCollabSession(12)
    await fake(a).configuration.token() // 메모리의 기존 토큰
    fake(a).emit('authenticationFailed', { reason: 'forbidden' })
    expect(a.getState().terminal).not.toBe('forbidden')
    vi.advanceTimersByTime(0)
    expect(fake(a).connectCalls).toBe(1) // 곧바로 다시 붙는다

    await expect(fake(a).configuration.token()).resolves.toBe('fresh-1')
    fake(a).emit('authenticationFailed', { reason: 'forbidden' })
    expect(a.getState().terminal).toBe('forbidden')
    vi.advanceTimersByTime(10_000)
    expect(fake(a).connectCalls).toBe(1)
  })

  // disconnect() 의 소켓 닫힘은 비동기라, 닫히기 전에 connect() 하면 provider 가 "이미 연결됨"으로 무시하고
  // 닫힌 뒤엔 shouldConnect=false 라 스스로 붙지도 않는다 — 곧바로 재시도는 소켓이 닫힌 다음에 붙어야 한다(실브라우저에서 발견).
  it('reconnects an immediate auth retry only after the closing socket has closed', async () => {
    const a = acquireCollabSession(30)
    fake(a).configuration.websocketProvider.status = 'connected'
    await fake(a).configuration.token() // 메모리의 기존 토큰
    fake(a).emit('authenticationFailed', { reason: 'forbidden' })
    vi.advanceTimersByTime(0)
    expect(fake(a).connectCalls).toBe(0)
    fake(a).configuration.websocketProvider.setStatus('disconnected')
    expect(fake(a).connectCalls).toBe(1)
  })

  // 토큰 수명보다 긴 오프라인(4401 없이 1006 으로 끊김) 뒤 재접속이 낡은 토큰으로 거절돼도 미전송 입력을 버리지 않는다.
  it('keeps unsent edits when a long offline drop comes back with an expired token', async () => {
    const a = acquireCollabSession(23)
    goLive(a)
    fake(a).emit('disconnect', { event: { code: 1006, reason: '' } })
    setUnsynced(a, 1)
    releaseCollabSession(a)
    await fake(a).configuration.token()
    fake(a).emit('authenticationFailed', { reason: 'forbidden' })
    expect(a.getState().terminal).not.toBe('forbidden')
    expect(destroyed).toEqual([])
    expect(hasUnsentCollabChanges()).toBe(true)
    await expect(fake(a).configuration.token()).resolves.toBe('fresh-1')
  })

  // 갱신이 일시 실패(네트워크·5xx)하면 서버 거절을 '삭제·권한 없음'으로 보지 않고 간격을 두고 재시도한다.
  it('does not go terminal when the refresh itself failed transiently', async () => {
    auth.refreshOutcome = 'error'
    const a = acquireCollabSession(24)
    fake(a).emit('disconnect', { event: { code: 4401, reason: 'token expired' } })
    await expect(fake(a).configuration.token()).resolves.toBe('')
    fake(a).emit('authenticationFailed', { reason: 'forbidden' })
    expect(a.getState().terminal).not.toBe('forbidden')
    vi.advanceTimersByTime(2999)
    expect(fake(a).connectCalls).toBe(0)
    vi.advanceTimersByTime(1)
    expect(fake(a).connectCalls).toBe(1)
  })

  // 갱신이 거절되면(로그아웃·refresh 쿠키 만료) 다시 로그인하기 전엔 붙을 수 없다 — /auth/refresh·collab-access 를 끝없이 두드리지 않고
  // 로그인 상실 종단으로 멈춘다(삭제·권한 없음과는 구분).
  it('stops reconnecting and reports a lost login when the refresh is rejected', async () => {
    auth.refreshOutcome = 'rejected'
    const a = acquireCollabSession(27)
    fake(a).emit('disconnect', { event: { code: 4401, reason: 'token expired' } })
    await expect(fake(a).configuration.token()).resolves.toBe('')
    fake(a).emit('authenticationFailed', { reason: 'forbidden' })
    expect(a.getState().terminal).toBe('authLost')
    expect(a.getState().terminal).not.toBe('forbidden')
    vi.advanceTimersByTime(10 * 60_000)
    expect(fake(a).connectCalls).toBe(0)
    expect(auth.refreshed).toBe(1)
    // 다시 열면(재로그인 뒤) 새 세션으로 처음부터.
    releaseCollabSession(a)
    expect(acquireCollabSession(27)).not.toBe(a)
  })

  // 로그인을 잃었어도 보유 중인 화면의 미전송 입력은 탭 이탈 경고 대상이다 — 다시 로그인하러 떠날 때 잃는다는 걸 알린다.
  it('still warns about unsent edits after losing the login', async () => {
    auth.refreshOutcome = 'rejected'
    const a = acquireCollabSession(29)
    goLive(a)
    fake(a).emit('disconnect', { event: { code: 4401, reason: 'token expired' } })
    setUnsynced(a, 1)
    await fake(a).configuration.token()
    fake(a).emit('authenticationFailed', { reason: 'token-expired' })
    expect(a.getState().terminal).toBe('authLost')
    expect(hasUnsentCollabChanges()).toBe(true)
  })

  // 일시적 인증 실패가 이어지면 간격을 두 배씩(상한 60초) 늘린다 — 3초 고정으로 영원히 두드리지 않는다. 인증되면 처음 간격으로.
  it('backs off exponentially on consecutive transient auth failures and resets once authenticated', () => {
    const a = acquireCollabSession(28)
    const failAndWait = (expectedDelay: number) => {
      const before = fake(a).connectCalls
      fake(a).emit('authenticationFailed', { reason: 'load-failed' })
      vi.advanceTimersByTime(expectedDelay - 1)
      expect(fake(a).connectCalls).toBe(before)
      vi.advanceTimersByTime(1)
      expect(fake(a).connectCalls).toBe(before + 1)
    }
    failAndWait(3000)
    failAndWait(6000)
    failAndWait(12_000)
    failAndWait(24_000)
    failAndWait(48_000)
    failAndWait(60_000)
    failAndWait(60_000)
    goLive(a)
    failAndWait(3000)
  })

  // 같은 JWT 를 쓰는 세션들이 동시에 4401 을 받아도 갱신은 한 번만 한다(refresh 토큰 회전 시 이중 호출 = 로그아웃).
  it('shares one token refresh across sessions', async () => {
    const a = acquireCollabSession(25)
    const b = acquireCollabSession(26)
    for (const s of [a, b]) fake(s).emit('disconnect', { event: { code: 4401, reason: 'token expired' } })
    const tokens = await Promise.all([fake(a).configuration.token(), fake(b).configuration.token()])
    expect(tokens).toEqual(['fresh-1', 'fresh-1'])
    expect(auth.refreshed).toBe(1)
  })

  it('destroys a forbidden session at once when nobody holds it', () => {
    const a = acquireCollabSession(13)
    releaseCollabSession(a)
    fake(a).emit('authenticationFailed', { reason: 'invalid-document' })
    expect(destroyed).toEqual(['wiki-page:13'])
  })

  // 4401 — 토큰 만료로 끊기면 provider 가 스스로 재접속할 때 새 토큰을 받아 보낸다.
  it('refreshes the access token on the reconnect after 4401', async () => {
    const a = acquireCollabSession(14)
    await expect(fake(a).configuration.token()).resolves.toBe('old')
    expect(auth.refreshed).toBe(0)

    fake(a).emit('disconnect', { event: { code: 4401, reason: 'token expired' } })
    expect(a.getState().terminal).not.toBe('forbidden')
    expect(fake(a).disconnectCalls).toBe(0) // 재연결은 provider 에 맡긴다
    await expect(fake(a).configuration.token()).resolves.toBe('fresh-1')
    // 한 번 갱신했으면 다음 재접속은 그 토큰을 그대로 쓴다
    await expect(fake(a).configuration.token()).resolves.toBe('fresh-1')
    expect(auth.refreshed).toBe(1)
  })

  it('refreshes when no access token is in memory', async () => {
    auth.token = null
    const a = acquireCollabSession(15)
    await expect(fake(a).configuration.token()).resolves.toBe('fresh-1')
  })

  // 만료 토큰이 재접속에 실려 인증 실패하면(4401 을 못 받은 경우) 갱신 후 다시 붙는다.
  it('reconnects with a fresh token after a token-expired auth failure', async () => {
    const a = acquireCollabSession(16)
    fake(a).emit('authenticationFailed', { reason: 'token-expired' })
    expect(a.getState().terminal).not.toBe('forbidden')
    expect(fake(a).disconnectCalls).toBe(1)
    expect(fake(a).connectCalls).toBe(0)
    vi.advanceTimersByTime(3000)
    expect(fake(a).connectCalls).toBe(1)
    await expect(fake(a).configuration.token()).resolves.toBe('fresh-1')
  })

  it('does not reconnect a session destroyed while an auth retry was pending', () => {
    const a = acquireCollabSession(17)
    releaseCollabSession(a) // t=0 → 유예 정리 t=5000
    vi.advanceTimersByTime(4000)
    fake(a).emit('authenticationFailed', { reason: 'load-failed' }) // 재시도 예약 t=7000
    vi.advanceTimersByTime(1001)
    expect(destroyed).toEqual(['wiki-page:17'])
    vi.advanceTimersByTime(5000)
    expect(fake(a).connectCalls).toBe(0)
  })

  // 문서 단위 CLOSE(코드 1000)는 소켓이 열린 채 남고 provider 가 다시 붙지 않는다 — 직접 다시 붙인다.
  it('reconnects after a document-level close on an open socket', () => {
    const a = acquireCollabSession(20)
    goLive(a)
    const ws = fake(a).configuration.websocketProvider
    ws.status = 'connected'
    fake(a).emit('close', { event: { code: 1000, reason: 'kicked' } })
    expect(a.getState().connected).toBe(false)
    expect(fake(a).disconnectCalls).toBe(1)
    ws.setStatus('disconnected') // disconnect() 가 연 소켓 닫힘이 끝난다
    vi.advanceTimersByTime(3000)
    expect(fake(a).connectCalls).toBe(1)
  })

  it('treats a document-level close with reason forbidden as terminal', () => {
    const a = acquireCollabSession(21)
    fake(a).emit('close', { event: { code: 1000, reason: 'forbidden' } })
    expect(a.getState().terminal).toBe('forbidden')
  })

  // 소켓이 닫힐 때의 close 는 provider 자동 재연결에 맡긴다(이중 재접속 금지).
  it('leaves socket-level closes to the provider', () => {
    const a = acquireCollabSession(22)
    const cfg = fake(a).configuration as unknown as { websocketProvider: { status: string } }
    cfg.websocketProvider = { status: 'disconnected' }
    fake(a).emit('close', { event: { code: 1006, reason: '' } })
    vi.advanceTimersByTime(10_000)
    expect(fake(a).disconnectCalls).toBe(0)
    expect(fake(a).connectCalls).toBe(0)
  })

  // 재접속 핸드셰이크 중(startSync 가 대기 수를 1로 놓음) 끊겨도 내 입력이 없으면 '미전송'이 아니다.
  it('does not count a handshake-only pending sync as unsent', () => {
    const a = acquireCollabSession(19)
    // 원격 갱신(provider 가 origin)은 내 입력이 아니다
    Y.transact(a.doc, () => a.doc.getText('t').insert(0, 'remote'), a.provider)
    fake(a).unsyncedChanges = 1
    fake(a).emit('unsyncedChanges', { number: 1 })
    fake(a).emit('disconnect', { event: { code: 1006, reason: '' } })
    expect(a.getState().unsynced).toBe(false)
    expect(hasUnsentCollabChanges()).toBe(false)
    releaseCollabSession(a)
    vi.advanceTimersByTime(5001)
    expect(destroyed).toEqual(['wiki-page:19'])
  })

  // 미전송 입력이 있는 채로 탭을 닫으려 하면 브라우저 경고를 띄운다(세션을 놓은 뒤에도).
  it('warns on page leave while any writable session has unsent changes', () => {
    const a = acquireCollabSession(18)
    goLive(a)
    const leave = () => {
      const e = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(e)
      return e.defaultPrevented
    }
    expect(leave()).toBe(false)
    setUnsynced(a, 1)
    releaseCollabSession(a)
    expect(leave()).toBe(true)
    setUnsynced(a, 0)
    expect(leave()).toBe(false)
  })
})
