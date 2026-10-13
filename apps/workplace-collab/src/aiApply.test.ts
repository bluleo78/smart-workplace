import './dom-install'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  COLLAB_AI_APPLY_ACK_TYPE,
  COLLAB_AI_APPLY_TYPE,
  COLLAB_AI_CANCEL_TYPE,
} from '@smart-workplace/wiki-editor-schema'

import { AiTagBoard } from './aiTagBoard'
import type { CollabConfig } from './config'
import { yDocToMarkdown } from './markdownCodec'
import { AI_TAG_TTL_MS, createCollabServer, type CollabServer } from './server'
import { connectClient, typeAt, type TestClient as Client } from './testing/clients'
import { startFakeApi, type FakeApi } from './testing/fakeApi'
import { manualClock, type ManualClock } from './testing/manualClock'
import { ARRIVAL, expectStays } from './testing/wait'

// 에디터 안 AI 적용 직전 판 ✦(WP-323) — 웹이 보내는 stateless ai-apply 를 실제 Hocuspocus 서버·provider 로 검증한다.
// 디바운스를 아주 길게 둬 사람 편집이 ai-apply 전에 저절로 저장되지 않게 한다(그래야 flush 경로가 실제로 돈다).
// 같은 이유로 AI 업데이트가 곧바로 저장되면 "즉시 저장 예약"이 동작한 것이다.
const TENANT = 7
const DOC = 'wiki-page:1'
const BODY = '# 제목\n\n본문'
const LONG = 60_000

describe('in-editor AI apply (stateless ai-apply)', () => {
  let api: FakeApi
  let app: CollabServer
  let clients: Client[]
  /**
   * AI 태그 만료 시계 — 손으로 돌린다. 태그는 테스트가 advance 할 때만 만료된다. 실제 시계면 부하로 저장(재시도)이 늦어질 때 태그가
   * 먼저 만료돼(기본 5초, 만료 테스트는 150~300ms) AI 사유가 빠졌다. 만료를 다루는 테스트(f·g3)만 advance 한다.
   */
  let tagClock: ManualClock
  /** 이 서버의 AI 태그판 — 취소(ai-cancel)가 처리된 순간을 사건으로 기다릴 때 cancel 을 엿본다. */
  let tags: AiTagBoard

  const cfg = (over: Partial<CollabConfig> = {}): CollabConfig => ({
    port: 0,
    apiUrl: api.url,
    internalToken: 'test-token',
    testMode: false,
    debounceMs: LONG,
    maxDebounceMs: LONG,
    storeRetryBaseMs: 50,
    storeRetryMaxMs: 200,
    ...over,
  })

  const start = async (over: Partial<CollabConfig> = {}) => {
    tagClock = manualClock()
    const config = cfg(over)
    tags = new AiTagBoard(config.aiTagTtlMs ?? AI_TAG_TTL_MS, tagClock)
    app = createCollabServer(config, { aiTags: tags })
    await app.listen()
  }

  const connect = (token: string): Client => {
    const c = connectClient(app.address.port, DOC, token)
    clients.push(c)
    return c
  }
  const synced = (c: Client) => expect.poll(() => c.provider.isSynced, ARRIVAL).toBe(true)
  const serverText = () => yDocToMarkdown(app.hocuspocus.documents.get(DOC)!)
  /** 서버 문서에 글자가 들어올 때까지 — 다른 소켓의 메시지와 순서를 맞출 때. */
  const reached = (text: string) => expect.poll(() => serverText(), ARRIVAL).toContain(text)
  /** 파생 저장(body 있는 저장)만 — 첫 저장은 항상 상태만 저장하는 이관이다. */
  const derived = () => api.stores.filter((s) => !s.stateOnly)

  const send = (c: Client, type: string, requestId: string) => c.provider.sendStateless(JSON.stringify({ type, requestId }))
  const acks = (c: Client) =>
    c.statelessMessages
      .map((m) => JSON.parse(m) as { type: string; requestId?: string })
      .filter((m) => m.type === COLLAB_AI_APPLY_ACK_TYPE)
      .map((m) => m.requestId)
  const acked = (c: Client, requestId: string) =>
    expect.poll(() => acks(c), ARRIVAL).toContain(requestId)
  /** 연결하고 첫 동기화까지 기다린다. */
  const openEditor = async (token: string): Promise<Client> => {
    const c = connect(token)
    await synced(c)
    return c
  }
  /** ai-apply 를 보내고 그 ack 까지 기다린다. */
  const applyAcked = async (c: Client, requestId: string) => {
    send(c, COLLAB_AI_APPLY_TYPE, requestId)
    await acked(c, requestId)
  }
  /** 서버가 ai-cancel 을 n 번 처리할 때까지 — 다른 소켓의 메시지와 처리 순서를 시간 대신 사건으로 맞춘다. */
  const cancelsHandled = (n: number) => {
    const cancel = vi.spyOn(tags, 'cancel')
    return () => expect.poll(() => cancel.mock.calls.length, ARRIVAL).toBe(n)
  }

  beforeEach(async () => {
    api = await startFakeApi('test-token')
    api.page(1, { tenantId: TENANT, body: BODY, version: 1 })
    api.token('editor-token', { userId: 5, name: '양동희', role: 'EDITOR', tenantId: TENANT })
    api.token('editor2-token', { userId: 8, name: '이영희', role: 'EDITOR', tenantId: TENANT })
    api.token('viewer-token', { userId: 6, name: '김철수', role: 'VIEWER', tenantId: TENANT })
    clients = []
  })

  afterEach(async () => {
    api.failStores = false
    api.releaseStores()
    for (const c of clients) c.provider.destroy()
    await app.destroy()
    await api.close()
  })

  it('a) flushes a pending human edit without a reason, then stores the AI update with the AI reason', async () => {
    await start()
    const a = await openEditor('editor-token')
    typeAt(a.doc, 1, '사람 ')
    await applyAcked(a, 'r1')
    // ack 시점엔 사람 편집이 사유 없이 이미 저장돼 있다(그 판이 ✦ 대상).
    expect(derived()).toHaveLength(1)
    expect(derived()[0].body).toContain('사람 ')
    expect(derived()[0].snapshotReason).toBeUndefined()
    expect(derived()[0].aiActorId).toBeUndefined()
    // AI 결과 삽입 — 디바운스(60초)를 기다리지 않고 곧바로 AI 사유로 저장된다.
    typeAt(a.doc, 1, 'AI결과 ')
    await expect.poll(() => derived().length, ARRIVAL).toBe(2)
    expect(derived()[1]).toMatchObject({ snapshot: true, snapshotReason: 'AI', aiActorId: 5 })
    expect(derived()[1].body).toContain('AI결과 ')
  })

  it('b) acks at once when nothing is pending, and the next store carries the AI tag', async () => {
    await start()
    const a = await openEditor('editor-token')
    await applyAcked(a, 'r1')
    expect(derived()).toHaveLength(0)
    typeAt(a.doc, 1, 'AI결과 ')
    await expect.poll(() => derived().length, ARRIVAL).toBe(1)
    expect(derived()[0]).toMatchObject({ snapshotReason: 'AI', aiActorId: 5 })
  })

  it('c) ignores ai-apply from a read-only connection — no flush, no tag, no ack', async () => {
    await start()
    const e = await openEditor('editor-token')
    const v = await openEditor('viewer-token')
    typeAt(e.doc, 1, '사람 ')
    await reached('사람 ')
    send(v, COLLAB_AI_APPLY_TYPE, 'rv')
    // 무시된 메시지는 남기는 사건이 없다 — ack·저장이 나오지 않음을 부재 창으로 본다.
    await expectStays(() => [acks(v), derived().length], [[], 0])
    // 편집자의 이후 저장은 사유 없음.
    typeAt(e.doc, 1, '더 ')
    await reached('더 ')
    await app.closeDocument(DOC)
    expect(derived().length).toBeGreaterThan(0)
    for (const s of derived()) expect(s.snapshotReason).toBeUndefined()
  })

  it('d) two users overlap — the first store after A\'s tag is A\'s, the store with B\'s update is B\'s', async () => {
    await start()
    const a = await openEditor('editor-token')
    const b = await openEditor('editor2-token')
    await applyAcked(a, 'ra')
    // A 의 태그가 달린 뒤 처음 저장되는 판(여기선 B 의 사람 편집) — A 로 표기된다. API 는 그 직전 저장 판(= A 의 AI 직전 판)에 ✦ 를 단다.
    typeAt(b.doc, 1, 'B사람 ')
    await expect.poll(() => derived().length, ARRIVAL).toBe(1)
    expect(derived()[0]).toMatchObject({ snapshotReason: 'AI', aiActorId: 5 })
    await applyAcked(b, 'rb')
    // B 의 ack 전에는 B 로 표기된 저장이 없다.
    expect(derived().filter((s) => s.aiActorId === 8)).toHaveLength(0)
    typeAt(b.doc, 1, 'B결과 ')
    await expect.poll(() => derived().length, ARRIVAL).toBe(2)
    expect(derived()[1]).toMatchObject({ snapshotReason: 'AI', aiActorId: 8 })
    expect(derived()[1].body).toContain('B결과 ')
  })

  it('e) ai-cancel removes the tag — the next human store has no reason', async () => {
    await start()
    const a = await openEditor('editor-token')
    await applyAcked(a, 'r1')
    send(a, COLLAB_AI_CANCEL_TYPE, 'r1')
    // 취소가 먼저 처리되도록 — 같은 소켓의 메시지는 순서대로 처리된다.
    typeAt(a.doc, 1, '사람 ')
    await reached('사람 ')
    await app.closeDocument(DOC)
    expect(derived()).toHaveLength(1)
    expect(derived()[0].snapshotReason).toBeUndefined()
  })

  it('e2) ai-cancel from another user or another request does not remove the tag', async () => {
    await start()
    const a = await openEditor('editor-token')
    const b = await openEditor('editor2-token')
    await applyAcked(a, 'r1')
    const handled = cancelsHandled(2)
    send(b, COLLAB_AI_CANCEL_TYPE, 'r1')
    send(a, COLLAB_AI_CANCEL_TYPE, 'old')
    // 두 취소가 서버에서 처리된 뒤 입력한다 — 그래도 태그가 남아 AI 사유로 저장돼야 한다.
    await handled()
    typeAt(a.doc, 1, 'AI결과 ')
    await expect.poll(() => derived().length, ARRIVAL).toBe(1)
    expect(derived()[0]).toMatchObject({ snapshotReason: 'AI', aiActorId: 5 })
  })

  it('f) the tag expires after the TTL — a later human store has no reason', async () => {
    await start({ aiTagTtlMs: 150 })
    const a = await openEditor('editor-token')
    await applyAcked(a, 'r1')
    // 만료 직전까지는 태그가 살아 있고, 만료 시각에 내려간다(만료 타이머가 태그·즉시 저장 예약을 지운다).
    tagClock.advance(149)
    tagClock.advance(1)
    typeAt(a.doc, 1, '사람 ')
    await reached('사람 ')
    // 만료로 즉시 저장 예약도 풀렸다 — 디바운스(60초) 동안 저장되지 않는다.
    await expectStays(() => derived().length, 0)
    await app.closeDocument(DOC)
    expect(derived()).toHaveLength(1)
    expect(derived()[0].snapshotReason).toBeUndefined()
  })

  it('g) acks only after the flush store finishes', async () => {
    await start()
    const a = await openEditor('editor-token')
    typeAt(a.doc, 1, '사람 ')
    api.holdStores()
    const before = api.storeAttempts
    send(a, COLLAB_AI_APPLY_TYPE, 'r1')
    await expect.poll(() => api.storeAttempts, ARRIVAL).toBeGreaterThan(before)
    // flush 저장이 붙잡혀 있는 동안은 ack 가 없다.
    await expectStays(() => acks(a), [])
    api.releaseStores()
    await acked(a, 'r1')
    expect(derived()).toHaveLength(1)
    expect(derived()[0].snapshotReason).toBeUndefined()
  })

  // 감수한 저하 동작(바라는 결과가 아님): flush 가 실패하면 태그가 남아, 장애가 풀린 뒤 재시도가 사람 편집(AI 직전 판)을 AI 사유로 저장한다.
  // API 는 그 직전 저장 판(사람 편집 전)에 ✦ 를 달아 ✦ 대상이 한 판 이르다. ack 는 실패해도 보낸다(웹이 3초를 헛되이 기다리지 않게).
  it('g2) degraded: when the flush fails it still acks, and the retry stores the human edit under the AI tag (accepted)', async () => {
    await start()
    const a = await openEditor('editor-token')
    typeAt(a.doc, 1, '사람 ')
    api.failStores = true
    const before = api.storeFailures
    await applyAcked(a, 'r1')
    expect(api.storeFailures).toBeGreaterThan(before)
    // 태그는 남아 있다(실패한 저장이 소비한 태그는 만료를 새로 잡아 되돌린다 — g3) — 장애가 풀린 뒤 재시도가 저장하는 판이 AI 사유를 싣는다.
    api.failStores = false
    await expect.poll(() => derived().length, ARRIVAL).toBe(1)
    expect(derived()[0]).toMatchObject({ snapshotReason: 'AI', aiActorId: 5 })
    expect(derived()[0].body).toContain('사람 ')
  })

  // 실패한 저장이 소비한 태그는 만료를 새로 잡아 되돌린다 — 장애가 처음 TTL 보다 길어도 재시도 저장이 AI 사유를 싣는다.
  it('g3) a failed AI store restores the tag with a fresh expiry — the retry after the original TTL still carries the AI reason', async () => {
    await start({ aiTagTtlMs: 300 })
    const a = await openEditor('editor-token')
    await applyAcked(a, 'r1') // 태그 만료 = 300(태그 시계)
    // 태그를 단 뒤 시간이 흐른 다음 저장이 실패해야 "새로 센 만료"와 "처음 만료"가 갈린다.
    tagClock.advance(200)
    api.failStores = true
    typeAt(a.doc, 1, 'AI결과 ')
    // 실패한 저장이 태그를 되돌리며 만료를 지금부터 다시 센다(200 + 300 = 500). 재시도도 실패할 때마다 같은 만료로 되돌린다.
    await expect.poll(() => api.storeFailures, ARRIVAL).toBeGreaterThan(0)
    // 처음 만료(300)를 넘긴다 — 처음 만료 시각을 그대로 쓰면 여기서 태그가 무효가 된다.
    tagClock.advance(200)
    api.failStores = false
    await expect.poll(() => derived().length, ARRIVAL).toBe(1)
    expect(derived()[0]).toMatchObject({ snapshotReason: 'AI', aiActorId: 5 })
    expect(derived()[0].body).toContain('AI결과 ')
  })

  it('d-literal) A update store is A\'s, B flush behind it has no reason, B update is B\'s', async () => {
    await start()
    const a = await openEditor('editor-token')
    const b = await openEditor('editor2-token')
    await applyAcked(a, 'ra')
    // A 의 결과 삽입 — 즉시 저장이 A 태그를 소비한 채 API 에 붙잡힌다.
    api.holdStores()
    const before = api.storeAttempts
    typeAt(a.doc, 1, 'A결과 ')
    await expect.poll(() => api.storeAttempts, ARRIVAL).toBeGreaterThan(before)
    // 그동안 B 가 편집하고 ai-apply — B 의 flush 는 A 의 저장 뒤에 줄 선다(태그는 이미 소비됨 → 사유 없음).
    typeAt(b.doc, 1, 'B사람 ')
    await reached('B사람 ')
    send(b, COLLAB_AI_APPLY_TYPE, 'rb')
    await expectStays(() => acks(b), [])
    api.releaseStores()
    await acked(b, 'rb')
    expect(derived()).toHaveLength(2)
    expect(derived()[0]).toMatchObject({ snapshotReason: 'AI', aiActorId: 5 })
    expect(derived()[0].body).toContain('A결과 ')
    expect(derived()[1].snapshotReason).toBeUndefined()
    expect(derived()[1].body).toContain('B사람 ')
    typeAt(b.doc, 1, 'B결과 ')
    await expect.poll(() => derived().length, ARRIVAL).toBe(3)
    expect(derived()[2]).toMatchObject({ snapshotReason: 'AI', aiActorId: 8 })
  })

  it('e3) a cancel arriving during the flush is not lost — no tag, no ack', async () => {
    await start()
    const a = await openEditor('editor-token')
    typeAt(a.doc, 1, '사람 ')
    api.holdStores()
    const before = api.storeAttempts
    send(a, COLLAB_AI_APPLY_TYPE, 'r1')
    await expect.poll(() => api.storeAttempts, ARRIVAL).toBeGreaterThan(before)
    const handled = cancelsHandled(1)
    send(a, COLLAB_AI_CANCEL_TYPE, 'r1')
    // 취소가 서버에서 처리된 뒤에 flush 저장을 풀어 준다 — 시간(100ms)으로 기다리면 부하에서 취소가 flush 가 끝난 뒤 도착해 ack 가 나갔다.
    await handled()
    api.releaseStores()
    await expect.poll(() => derived().length, ARRIVAL).toBe(1)
    await expectStays(() => acks(a), [])
    // 태그가 없으니 다음 변경은 즉시 저장되지 않고, 결국 저장돼도 사유 없음.
    typeAt(a.doc, 1, '더 ')
    await reached('더 ')
    await app.closeDocument(DOC)
    expect(derived()).toHaveLength(2)
    for (const s of derived()) expect(s.snapshotReason).toBeUndefined()
  })

  it('c2) an editor demoted to VIEWER mid-session gets no flush, tag or ack', async () => {
    await start()
    const a = await openEditor('editor-token')
    typeAt(a.doc, 1, '사람 ')
    await reached('사람 ')
    // 역할 강등(revalidate) — 연결이 읽기 전용으로 바뀌고 새 역할을 통지받는다.
    api.token('editor-token', { userId: 5, name: '양동희', role: 'VIEWER', tenantId: TENANT })
    await app.revalidate({ tenantId: TENANT, pageIds: [1] })
    await expect.poll(() => a.statelessMessages.some((m) => m.includes('collab:role')), ARRIVAL).toBe(true)
    send(a, COLLAB_AI_APPLY_TYPE, 'r1')
    await expectStays(() => [acks(a), derived().length], [[], 0])
    await app.closeDocument(DOC)
    expect(derived()).toHaveLength(1)
    expect(derived()[0].snapshotReason).toBeUndefined()
  })

  it('ignores malformed stateless payloads without crashing', async () => {
    await start()
    const a = await openEditor('editor-token')
    a.provider.sendStateless('not json')
    a.provider.sendStateless(JSON.stringify({ type: COLLAB_AI_APPLY_TYPE }))
    a.provider.sendStateless(JSON.stringify({ type: COLLAB_AI_APPLY_TYPE, requestId: 'x'.repeat(500) }))
    // 클라이언트가 보낸 ack 는 ai-apply 로 처리하지 않는다(flush·태그·ack 없음).
    send(a, COLLAB_AI_APPLY_ACK_TYPE, 'fake')
    await applyAcked(a, 'ok')
    expect(acks(a)).toEqual(['ok'])
  })
})
