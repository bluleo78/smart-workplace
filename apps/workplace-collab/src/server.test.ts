import './dom-install'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import type { CollabConfig } from './config'
import { CLOSE_DELETED, COLLAB_SCHEMA_MISMATCH, WIKI_SCHEMA_VERSION } from '@smart-workplace/wiki-editor-schema'

import { FRAGMENT, yDocToMarkdown } from './markdownCodec'
import { apiAuthenticator, createCollabServer, SCHEMA_MISMATCH_LOG_MS, type CollabServer } from './server'
import { ApiClient } from './apiClient'
import { connectClient, typeAt, type TestClient as Client } from './testing/clients'
import { startFakeApi, type FakeApi } from './testing/fakeApi'

// 실제 Hocuspocus 서버(포트 0) + Node 클라이언트(전역 WebSocket)로 인증·이관·저장·읽기 전용·만료를 검증한다.
// 테넌트는 일부러 1 이 아닌 7 — 기본값(0·1)으로 우연히 통과하지 않게.
const TENANT = 7
const DOC = 'wiki-page:1'
const BODY = '# 제목\n\n본문'

/** Y 조각 안 특정 노드 이름의 개수(멘션 칩 중복 검사). */
function countNodes(doc: Y.Doc, nodeName: string): number {
  let n = 0
  const walk = (el: Y.XmlElement | Y.XmlFragment) => {
    for (const child of el.toArray()) {
      if (child instanceof Y.XmlElement) {
        if (child.nodeName === nodeName) n += 1
        walk(child)
      }
    }
  }
  walk(doc.getXmlFragment(FRAGMENT))
  return n
}

describe('collab server', () => {
  let api: FakeApi
  let app: CollabServer
  let extraApps: CollabServer[]
  let clients: Client[]

  const cfg = (port = 0, over: Partial<CollabConfig> = {}): CollabConfig => ({
    port,
    apiUrl: api.url,
    internalToken: 'test-token',
    testMode: false,
    debounceMs: 50,
    maxDebounceMs: 200,
    storeRetryBaseMs: 50,
    storeRetryMaxMs: 200,
    ...over,
  })

  const connect = (
    token: string,
    opts: { name?: string; doc?: Y.Doc; target?: CollabServer; schemaVersion?: number | string | null } = {},
  ): Client => {
    const c = connectClient((opts.target ?? app).address.port, opts.name ?? DOC, token, {
      doc: opts.doc,
      schemaVersion: opts.schemaVersion,
    })
    clients.push(c)
    return c
  }
  const synced = (c: Client) => expect.poll(() => c.provider.isSynced, { timeout: 5000 }).toBe(true)
  const serverDoc = (name = DOC) => app.hocuspocus.documents.get(name)
  const unloaded = (name = DOC) => expect.poll(() => app.hocuspocus.documents.has(name), { timeout: 5000 }).toBe(false)

  beforeEach(async () => {
    api = await startFakeApi('test-token')
    api.page(1, { tenantId: TENANT, body: BODY, version: 1 })
    api.token('editor-token', { userId: 5, name: '양동희', role: 'EDITOR', tenantId: TENANT })
    api.token('viewer-token', { userId: 6, name: '김철수', role: 'VIEWER', tenantId: TENANT })
    clients = []
    extraApps = []
    app = createCollabServer(cfg())
    await app.listen()
  })

  afterEach(async () => {
    for (const c of clients) c.provider.destroy()
    // 서버를 먼저 내린다 — destroy 는 남은 저장을 마치고 문서가 모두 내려갈 때까지 기다리므로 가짜 API 가 살아 있어야 한다.
    for (const a of [app, ...extraApps]) await a.destroy()
    await api.close()
  })

  it('migrates markdown body into the Y.Doc on first load and persists only the state at once', async () => {
    const a = connect('editor-token')
    await synced(a)
    expect(yDocToMarkdown(a.doc)).toBe(BODY)
    // R4: 편집이 없어도 이관 상태를 즉시 1회 저장 — 다음 로드가 같은 상태에서 시작하게. 단 상태만(body·version 그대로).
    await expect.poll(() => api.stores.length).toBe(1)
    expect(api.stores[0]).toMatchObject({ pageId: 1, tenantId: TENANT, stateOnly: true, bodyVersion: 1 })
    expect(api.stores[0].body).toBeUndefined()
    expect(api.get(1)).toMatchObject({ body: BODY, version: 1, bodyVersion: 1 })
    expect(api.loads).toEqual([{ pageId: 1, tenantId: TENANT }])
  })

  describe('opening without editing never rewrites the stored body', () => {
    // 왕복 변환에서 손실되는 본문 — 원문 HTML 은 벗겨지고 체크리스트는 이스케이프된다(재직렬화 body 를 저장하면 열기만 해도 손실).
    const RAW = '# 제목\n\n<span>x</span> 본문\n\n- [ ] 할 일'

    it('stores the migrated state only and keeps the raw body on a no-edit visit', async () => {
      api.page(1, { tenantId: TENANT, body: RAW, version: 4 })
      const a = connect('editor-token')
      await synced(a)
      await expect.poll(() => api.stores.length).toBe(1)
      a.provider.destroy()
      await unloaded()
      expect(api.stores).toHaveLength(1)
      expect(api.stores[0]).toMatchObject({ stateOnly: true, bodyVersion: 4 })
      expect(api.get(1)).toMatchObject({ body: RAW, version: 4, bodyVersion: 4 })
      // 다시 열어도 stale 이 아니라(bodyVersion = version) 저장이 더 일어나지 않는다.
      const b = connect('editor-token')
      await synced(b)
      expect(api.loads).toHaveLength(2)
      b.provider.destroy()
      await unloaded()
      expect(api.stores).toHaveLength(1)
      expect(api.get(1).body).toBe(RAW)
    })

    it('derives the body normally once a real edit follows the migration', async () => {
      api.page(1, { tenantId: TENANT, body: RAW, version: 4 })
      const a = connect('editor-token')
      await synced(a)
      typeAt(a.doc, 1, '수정 ')
      a.provider.destroy()
      await expect.poll(() => api.stores.length, { timeout: 3000 }).toBe(2)
      expect(api.stores[0]).toMatchObject({ stateOnly: true })
      expect(api.stores[1]).toMatchObject({ stateOnly: false, editorIds: [5] })
      expect(api.stores[1].body).toContain('수정 ')
      expect(api.get(1)).toMatchObject({ body: api.stores[1].body, version: 5, bodyVersion: 5 })
    })

    it('still derives an edit made while the slow migration store is in flight', async () => {
      // 이관 저장은 로드 안에서 끝나야 동기화가 시작된다 — 그동안 편집이 끼어들 수 없고, 첫 편집은 일반 파생 저장으로 간다.
      api.page(1, { tenantId: TENANT, body: RAW, version: 4 })
      api.storeDelayMs = 300
      const a = connect('editor-token')
      await synced(a)
      typeAt(a.doc, 1, '곧바로 ')
      a.provider.destroy()
      await expect.poll(() => api.stores.length, { timeout: 5000 }).toBe(2)
      expect(api.stores.map((s) => s.stateOnly)).toEqual([true, false])
      expect(api.stores[1].body).toContain('곧바로 ')
    })

    it('retries a failed migration as state-only when the client reconnects', async () => {
      api.page(1, { tenantId: TENANT, body: RAW, version: 4 })
      api.failStores = true
      const a = connect('editor-token')
      await expect.poll(() => a.authFailures).toContain('load-failed')
      a.provider.destroy()
      api.failStores = false
      const b = connect('editor-token')
      await synced(b)
      await expect.poll(() => api.stores.length).toBe(1)
      expect(api.stores[0]).toMatchObject({ stateOnly: true, bodyVersion: 4 })
      expect(api.get(1)).toMatchObject({ body: RAW, version: 4, bodyVersion: 4 })
    })
  })

  it('does not duplicate blocks when a client with a cached doc reconnects after reload', async () => {
    const a = connect('editor-token')
    await synced(a)
    const blocks = a.doc.getXmlFragment(FRAGMENT).length
    a.provider.destroy()
    await unloaded()
    // 같은 Y.Doc(오프라인 탭·그레이스 캐시)으로 다시 붙는다 — 서버가 재이관하면 블록이 통째로 중복된다.
    const again = connect('editor-token', { doc: a.doc })
    await synced(again)
    expect(a.doc.getXmlFragment(FRAGMENT).length).toBe(blocks)
    expect(yDocToMarkdown(a.doc)).toBe(BODY)
    expect(yDocToMarkdown(serverDoc()!)).toBe(BODY)
  })

  it('parses mention tokens once on load (no duplicate chips)', async () => {
    api.page(1, { tenantId: TENANT, body: '담당 <@5> 문서 <#page:12>', version: 1 })
    const a = connect('editor-token')
    const b = connect('editor-token')
    await synced(a)
    await synced(b)
    expect(countNodes(serverDoc()!, 'wikiMention')).toBe(2)
    expect(countNodes(a.doc, 'wikiMention')).toBe(2)
    expect(countNodes(b.doc, 'wikiMention')).toBe(2)
    expect(yDocToMarkdown(b.doc)).toBe('담당 <@5> 문서 <#page:12>')
  })

  it('syncs edits between two editors', async () => {
    const a = connect('editor-token')
    const b = connect('editor-token')
    await synced(a)
    await synced(b)
    typeAt(a.doc, 1, '추가 ')
    await expect.poll(() => yDocToMarkdown(b.doc)).toBe('# 제목\n\n추가 본문')
  })

  it('rejects unknown token', async () => {
    const a = connect('bad-token')
    await expect.poll(() => a.authFailures.length).toBeGreaterThan(0)
    expect(a.provider.isSynced).toBe(false)
    expect(api.loads).toEqual([])
  })

  it('rejects a namespaced document name outside test mode without asking the API', async () => {
    const a = connect('editor-token', { name: 'e2e-1/wiki-page:1' })
    const bad = connect('editor-token', { name: 'wiki-page:abc' })
    await expect.poll(() => a.authFailures.length).toBeGreaterThan(0)
    await expect.poll(() => bad.authFailures.length).toBeGreaterThan(0)
    expect(api.accessCalls).toEqual([])
  })

  it('accepts a namespaced document name in test mode', async () => {
    const testApp = createCollabServer(cfg(0, { testMode: true }))
    extraApps.push(testApp)
    await testApp.listen()
    const a = connect('editor-token', { name: 'e2e-1/wiki-page:1', target: testApp })
    await synced(a)
    expect(yDocToMarkdown(a.doc)).toBe(BODY)
    expect(api.accessCalls).toEqual([{ pageId: 1, token: 'editor-token' }])
  })

  // WP-313 — 스키마 판이 다른 클라이언트는 모르는 서식의 글자를 지우고 그 삭제를 퍼뜨린다. 문서를 주기 전에 거부해야 한다.
  describe('schema version handshake', () => {
    // console.warn 감시를 다음 테스트로 새지 않게 되돌린다(다른 테스트가 경고 횟수를 센다).
    afterEach(() => vi.restoreAllMocks())

    it.each([
      ['missing', null],
      ['older', WIKI_SCHEMA_VERSION - 1],
      ['newer', WIKI_SCHEMA_VERSION + 1],
    ])('rejects a %s schema version before auth, load or sync', async (_label, version) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const a = connect('editor-token', { schemaVersion: version })
      await expect.poll(() => a.authFailures).toEqual([COLLAB_SCHEMA_MISMATCH])
      expect(a.provider.isSynced).toBe(false)
      expect(yDocToMarkdown(a.doc)).toBe('')
      // 인증 API 도 문서 로드도 일어나지 않고, 서버 메모리에 문서가 열리지 않는다.
      expect(api.accessCalls).toEqual([])
      expect(api.loads).toEqual([])
      expect(serverDoc()).toBeUndefined()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('schema mismatch'))
    })

    // 인증 전 거부라 미인증 클라이언트가 유발한다 — 위조 값으로 로그 줄을 꾸미거나 대량 접속으로 로그를 채우지 못하게.
    it('logs forged values clipped as JSON and at most once per interval', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const forged = `1\n[collab] FAKE ${'x'.repeat(200)}`
      // 위조 값이 먼저 로그에 남도록 거부를 기다린 뒤 나머지를 붙인다.
      const first = connect('editor-token', { schemaVersion: forged })
      await expect.poll(() => first.authFailures).toEqual([COLLAB_SCHEMA_MISMATCH])
      const rest = [1, 2, 3].map(() => connect('editor-token', { schemaVersion: null }))
      for (const c of rest) await expect.poll(() => c.authFailures).toEqual([COLLAB_SCHEMA_MISMATCH])
      const lines = warn.mock.calls.map(([m]) => String(m)).filter((m) => m.includes('schema mismatch'))
      expect(lines).toHaveLength(1)
      // JSON 으로 감싸 개행이 이스케이프되고(가짜 로그 줄 불가), 긴 값은 잘린다.
      expect(lines[0]).toContain('client "1\\n[collab] FAKE')
      expect(lines[0]).not.toContain('\n')
      expect(lines[0]).not.toContain('x'.repeat(40))
      // 간격이 지나면 다시 한 줄 — 그사이 건너뛴 건수를 함께 남긴다.
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + SCHEMA_MISMATCH_LOG_MS + 1)
      const late = connect('editor-token', { schemaVersion: null })
      await expect.poll(() => late.authFailures).toEqual([COLLAB_SCHEMA_MISMATCH])
      const after = warn.mock.calls.map(([m]) => String(m)).filter((m) => m.includes('schema mismatch'))
      expect(after).toHaveLength(2)
      expect(after[1]).toContain('(+3 more since last log)')
    })

    it('connects and syncs with the matching schema version', async () => {
      const a = connect('editor-token', { schemaVersion: WIKI_SCHEMA_VERSION })
      await synced(a)
      expect(a.authFailures).toEqual([])
      expect(yDocToMarkdown(a.doc)).toBe(BODY)
    })

    it('honours a per-document schema version only in test mode', async () => {
      const testApp = createCollabServer(cfg(0, { testMode: true }), { schemaVersion: () => WIKI_SCHEMA_VERSION + 1 })
      const prodApp = createCollabServer(cfg(), { schemaVersion: () => WIKI_SCHEMA_VERSION + 1 })
      extraApps.push(testApp, prodApp)
      await Promise.all([testApp.listen(), prodApp.listen()])
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const stale = connect('editor-token', { name: 'e2e-1/wiki-page:1', target: testApp })
      await expect.poll(() => stale.authFailures).toEqual([COLLAB_SCHEMA_MISMATCH])
      // 운영 모드는 주입된 판을 무시하고 빌드된 판으로 판정한다.
      const ok = connect('editor-token', { target: prodApp })
      await synced(ok)
    })
  })

  it('drops updates from read-only connection', async () => {
    const editor = connect('editor-token')
    const viewer = connect('viewer-token')
    await synced(editor)
    await synced(viewer)
    expect(viewer.provider.authorizedScope).toBe('readonly')
    await expect.poll(() => api.stores.length).toBe(1) // 이관 저장
    // 조작된 클라이언트: 기본 provider 는 readonly 범위여도 업데이트를 그대로 보낸다.
    typeAt(viewer.doc, 1, '해킹 ')
    // 같은 연결의 메시지는 순서대로 처리된다 — 뒤이어 보낸 awareness 가 에디터에 도착했으면 앞의 업데이트는 이미 처리(폐기)됐다.
    viewer.provider.setAwarenessField('marker', 'after-update')
    await expect
      .poll(() => [...editor.provider.awareness!.getStates().values()].some((s) => s.marker === 'after-update'))
      .toBe(true)
    expect(yDocToMarkdown(serverDoc()!)).toBe(BODY)
    expect(yDocToMarkdown(editor.doc)).toBe(BODY)
    // 서버가 "적용됨" 확인을 보내지 않았으므로 뷰어 쪽엔 미확인 변경이 남는다.
    expect(viewer.provider.unsyncedChanges).toBeGreaterThan(0)
    // 다른 접속자는 영향 없이 계속 편집·동기화된다.
    typeAt(editor.doc, 1, '정상 ')
    await expect.poll(() => yDocToMarkdown(viewer.doc)).toContain('정상 ')
    const fresh = connect('editor-token')
    await synced(fresh)
    expect(yDocToMarkdown(fresh.doc)).toBe('# 제목\n\n정상 본문')
    editor.provider.destroy()
    viewer.provider.destroy()
    fresh.provider.destroy()
    await unloaded()
    expect(api.stores.at(-1)).toMatchObject({ body: '# 제목\n\n정상 본문', editorIds: [5] })
    expect(api.stores.every((s) => !(s.body ?? '').includes('해킹'))).toBe(true)
  })

  it('stores after last client disconnects with the doc tenant and editor ids', async () => {
    const a = connect('editor-token')
    await synced(a)
    await expect.poll(() => api.stores.length).toBe(1)
    typeAt(a.doc, 1, '수정 ')
    a.provider.destroy()
    // 접속자가 없어진 뒤의 저장도 문서에 보관한 tenantId 로 간다(가짜 API 는 테넌트 불일치면 404 — 0행 성공 없음).
    await expect.poll(() => api.stores.length, { timeout: 3000 }).toBe(2)
    expect(api.stores[1]).toMatchObject({ pageId: 1, tenantId: TENANT, body: '# 제목\n\n수정 본문', editorIds: [5] })
    expect(api.get(1)).toMatchObject({ body: '# 제목\n\n수정 본문', version: 2, bodyVersion: 2 }) // 이관은 상태만이라 version 은 편집 저장에서만 오른다
    await unloaded()
  })

  it('stores with the doc tenant even when the last change carries no connection context', async () => {
    const a = connect('editor-token')
    await synced(a)
    await expect.poll(() => api.stores.length).toBe(1)
    typeAt(a.doc, 1, '수정 ')
    await expect.poll(() => yDocToMarkdown(serverDoc()!)).toBe('# 제목\n\n수정 본문')
    // 출처 없는 서버측 변경이 마지막 변경이 되면 Hocuspocus 의 저장 페이로드 lastContext 는 {} 다 —
    // 저장이 연결 컨텍스트에서 테넌트를 읽으면 여기서 테넌트 없이 호출돼 가짜 API(RLS 흉내)가 거부한다.
    const doc = serverDoc()!
    doc.transact(() => typeAt(doc, 0, '서버 '))
    a.provider.destroy()
    await expect.poll(() => api.stores.length, { timeout: 3000 }).toBe(2)
    expect(api.stores[1]).toMatchObject({ tenantId: TENANT, body: '# 서버 제목\n\n수정 본문', editorIds: [5] })
    await unloaded()
  })

  describe('when the API cannot store', () => {
    it('keeps an unsaved document in memory through a no-edit visit and stores it once the API recovers', async () => {
      const a = connect('editor-token')
      await synced(a)
      await expect.poll(() => api.stores.length).toBe(1)
      api.failStores = true
      typeAt(a.doc, 1, '수정 ')
      a.provider.destroy()
      // 마지막 접속자 종료 → 즉시 저장 시도 → 실패. Hocuspocus 4.7 은 로그만 남기고 재시도하지 않는다.
      await expect.poll(() => api.storeFailures).toBeGreaterThan(0)
      // 편집 없이 들어왔다 나가는 접속 — 4.7 기본 동작이면 예약된 저장이 없어 문서를 바로 내린다(편집 유실).
      const b = connect('viewer-token')
      await synced(b)
      expect(yDocToMarkdown(b.doc)).toBe('# 제목\n\n수정 본문')
      b.provider.destroy()
      await expect.poll(() => serverDoc()?.getConnectionsCount()).toBe(0)
      // 재시도가 몇 번 더 실패하는 동안에도 문서는 메모리에 남는다.
      const failures = api.storeFailures
      await expect.poll(() => api.storeFailures, { timeout: 3000 }).toBeGreaterThan(failures + 1)
      expect(app.hocuspocus.documents.has(DOC)).toBe(true)
      // API 복구 → 재시도가 문서의 테넌트·편집자로 저장하고, 그 뒤에야 문서가 내려간다.
      api.failStores = false
      await expect.poll(() => api.stores.length, { timeout: 3000 }).toBe(2)
      expect(api.stores[1]).toMatchObject({ pageId: 1, tenantId: TENANT, body: '# 제목\n\n수정 본문', editorIds: [5] })
      await unloaded()
    })

    it('makes a final store attempt on shutdown', async () => {
      // 재시도 간격을 길게 — 종료 시점의 최종 저장 시도만으로 저장돼야 한다.
      const slow = createCollabServer(cfg(0, { storeRetryBaseMs: 60000, storeRetryMaxMs: 60000, shutdownTimeoutMs: 3000 }))
      extraApps.push(slow)
      await slow.listen()
      const a = connect('editor-token', { target: slow })
      await synced(a)
      await expect.poll(() => api.stores.length).toBe(1)
      api.failStores = true
      typeAt(a.doc, 1, '수정 ')
      a.provider.destroy()
      await expect.poll(() => api.storeFailures).toBeGreaterThan(0)
      expect(slow.hocuspocus.documents.has(DOC)).toBe(true)
      api.failStores = false
      await slow.destroy()
      expect(api.stores.at(-1)).toMatchObject({ tenantId: TENANT, body: '# 제목\n\n수정 본문', editorIds: [5] })
      expect(slow.hocuspocus.documents.size).toBe(0)
    })

    it('shuts down within the timeout and reports unsaved documents while the API stays down', async () => {
      const bounded = createCollabServer(cfg(0, { shutdownTimeoutMs: 300 }))
      extraApps.push(bounded)
      await bounded.listen()
      const a = connect('editor-token', { target: bounded })
      await synced(a)
      await expect.poll(() => api.stores.length).toBe(1)
      api.failStores = true
      typeAt(a.doc, 1, '수정 ')
      a.provider.destroy()
      await expect.poll(() => api.storeFailures).toBeGreaterThan(0)
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const t0 = Date.now()
        await bounded.destroy()
        expect(Date.now() - t0).toBeLessThan(2000)
        const logged = errors.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
        expect(logged).toMatch(/UNSAVED.*wiki-page:1/)
      } finally {
        errors.mockRestore()
      }
    })
  })

  describe('when the page is gone (API 404 on store)', () => {
    it('drops the unsaved document once, unloads it, never retries and shuts down without an UNSAVED warning', async () => {
      const gone = createCollabServer(cfg(0, { shutdownTimeoutMs: 5000 }))
      extraApps.push(gone)
      await gone.listen()
      const a = connect('editor-token', { target: gone })
      await synced(a)
      await expect.poll(() => api.stores.length).toBe(1)
      typeAt(a.doc, 1, '수정 ')
      api.remove(1) // 다른 곳에서 노트 삭제
      const warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        a.provider.destroy()
        await expect.poll(() => api.storeNotFound).toBe(1)
        // 영구 실패 — 재시도 없이 메모리에서 내린다.
        await expect.poll(() => gone.hocuspocus.documents.has(DOC), { timeout: 3000 }).toBe(false)
        // 재시도 간격(50ms)의 몇 배를 기다려도 추가 저장 시도가 없다.
        await new Promise((r) => setTimeout(r, 400))
        expect(api.storeNotFound).toBe(1)
        const t0 = Date.now()
        await gone.destroy()
        expect(Date.now() - t0).toBeLessThan(1000)
        const logged = errors.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
        expect(logged).not.toMatch(/UNSAVED/)
        // 한 번만 경고로 남긴다.
        const goneWarns = warns.mock.calls.map((c) => c.map(String).join(' ')).filter((l) => l.includes('wiki-page:1'))
        expect(goneWarns).toHaveLength(1)
      } finally {
        warns.mockRestore()
        errors.mockRestore()
      }
    })

    it('closes remaining connections with 4404 (deleted) when a debounced store finds the page gone', async () => {
      const a = connect('editor-token')
      await synced(a)
      await expect.poll(() => api.stores.length).toBe(1)
      api.remove(1)
      const warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        typeAt(a.doc, 1, '수정 ') // 접속 중 지연 저장 → 404
        await expect.poll(() => a.disconnects.map((d) => d.code)).toContain(CLOSE_DELETED.code)
        await unloaded()
        await new Promise((r) => setTimeout(r, 400))
        expect(api.storeNotFound).toBe(1)
      } finally {
        warns.mockRestore()
      }
    })
  })

  it('puts the author of the most recent change last in editorIds (API uses the last one as updated_by)', async () => {
    // 지연 저장을 길게 — 세 번의 입력이 한 번의 저장으로 묶이게.
    const slow = createCollabServer(cfg(0, { debounceMs: 10000, maxDebounceMs: 20000 }))
    extraApps.push(slow)
    await slow.listen()
    api.token('editor2-token', { userId: 8, name: '이영희', role: 'EDITOR', tenantId: TENANT })
    const a = connect('editor-token', { target: slow })
    const b = connect('editor2-token', { target: slow })
    await synced(a)
    await synced(b)
    await expect.poll(() => api.stores.length).toBe(1)
    const server = () => yDocToMarkdown(slow.hocuspocus.documents.get(DOC)!)
    typeAt(a.doc, 1, '가 ')
    await expect.poll(server).toContain('가 ')
    typeAt(b.doc, 1, '나 ')
    await expect.poll(server).toContain('나 ')
    typeAt(a.doc, 1, '다 ') // 5 가 마지막으로 바꿨다
    await expect.poll(server).toContain('다 ')
    a.provider.destroy()
    b.provider.destroy()
    await expect.poll(() => api.stores.length, { timeout: 5000 }).toBe(2)
    expect(api.stores[1].editorIds).toEqual([8, 5])
  })

  it('reconciles stale state with newer body', async () => {
    // 1) 편집으로 상태를 저장시킨다.
    const a = connect('editor-token')
    await synced(a)
    typeAt(a.doc, 1, '수정 ')
    await expect.poll(() => api.get(1).body).toBe('# 제목\n\n수정 본문')
    await app.closeDocument(DOC)
    expect(app.hocuspocus.documents.has(DOC)).toBe(false)
    const stored = api.get(1)
    expect(stored.state).toBeTruthy()
    expect(stored.bodyVersion).toBe(stored.version)
    // 2) collab 밖(롤백 기간 등)에서 body 가 더 새로 바뀌었다 — 왕복 변환에서 손실되는 원문 HTML 포함.
    const outside = '# 제목\n\n<span>밖에서</span> 바뀜'
    api.page(1, { ...stored, body: outside, version: stored.version + 1 })
    const storesBefore = api.stores.length
    // 3) 다시 열면 옛 상태가 아니라 새 body 로 맞춰지고, 그 상태만 즉시 저장한다 — body·version 은 그대로,
    //    bodyVersion 만 현재 version 으로 맞춰 다음 로드가 stale 로 보지 않는다.
    const b = connect('editor-token')
    await synced(b)
    expect(yDocToMarkdown(b.doc)).toBe('# 제목\n\n밖에서 바뀜')
    await expect.poll(() => api.stores.length).toBe(storesBefore + 1)
    expect(api.stores.at(-1)).toMatchObject({ stateOnly: true, bodyVersion: stored.version + 1 })
    expect(api.get(1)).toMatchObject({ body: outside, version: stored.version + 1, bodyVersion: stored.version + 1 })
    // 편집 없이 닫아도 body 를 다시 쓰지 않는다.
    b.provider.destroy()
    // 4) 옛 상태를 들고 있던 클라이언트가 다시 붙어도 블록이 중복되지 않고 새 본문으로 수렴한다.
    a.provider.destroy()
    const again = connect('editor-token', { doc: a.doc })
    await synced(again)
    await expect.poll(() => yDocToMarkdown(a.doc)).toBe('# 제목\n\n밖에서 바뀜')
    await app.closeDocument(DOC)
    expect(api.get(1).body).toBe(outside)
  })

  it('closes the connection when the access token expires, and the expired token cannot reconnect', async () => {
    api.token('short-token', {
      userId: 5,
      name: '양동희',
      role: 'EDITOR',
      tenantId: TENANT,
      tokenExp: Math.floor(Date.now() / 1000) + 2,
    })
    const a = connect('short-token')
    await synced(a)
    expect(a.disconnects).toEqual([])
    await expect.poll(() => a.disconnects.map((d) => d.code), { timeout: 4000 }).toContain(4401)
    expect(a.disconnects.find((d) => d.code === 4401)?.reason).toBe('token expired')
    // provider 는 자동 재접속한다 — 만료 토큰 그대로면 API 가 401 → 인증 실패(웹은 이때 토큰을 갱신해 다시 붙는다).
    await expect.poll(() => a.authFailures.length, { timeout: 4000 }).toBeGreaterThan(0)
  })

  it('fails the load (not silently in memory) when the migration cannot be persisted', async () => {
    // 주입한 저장소 — load 는 정상, store 는 실패(API 장애). Task 6 테스트 모드가 쓰는 같은 주입 지점.
    const failing = createCollabServer(cfg(), {
      store: {
        load: async () => ({ state: null, body: BODY, version: 1, stale: false }),
        store: async () => {
          throw new Error('api down')
        },
        storeState: async () => {
          throw new Error('api down')
        },
      },
    })
    extraApps.push(failing)
    await failing.listen()
    const a = connect('editor-token', { target: failing })
    await expect.poll(() => a.authFailures).toContain('load-failed')
    expect(a.provider.isSynced).toBe(false)
    expect(failing.hocuspocus.documents.has(DOC)).toBe(false)
  })

  it('keeps a connection open when the token has no expiry', async () => {
    const auth = apiAuthenticator(new ApiClient(api.url, 'test-token'))
    expect(await auth.authenticate(DOC, 1, 'editor-token')).toMatchObject({ userId: 5, tenantId: TENANT, expiresAt: null })
    api.token('jwt', { userId: 5, name: '양동희', role: 'EDITOR', tenantId: TENANT, tokenExp: 4102444800 })
    expect((await auth.authenticate(DOC, 1, 'jwt'))?.expiresAt).toBe(4102444800 * 1000)
    // 다른 페이지 id 를 요청하면(문서 이름 조작) 거부.
    api.page(2, { tenantId: 99, body: 'x', version: 1 })
    expect(await auth.authenticate('wiki-page:2', 2, 'editor-token')).toBeNull()
  })
})
