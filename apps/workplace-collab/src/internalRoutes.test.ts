import './dom-install'

import { CLOSE_FORBIDDEN, CLOSE_TOKEN_EXPIRED, COLLAB_ROLE_CHANGED_TYPE } from '@smart-workplace/wiki-editor-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { CollabConfig } from './config'
import { yDocToMarkdown } from './markdownCodec'
import { apiAuthenticator, createCollabServer, type CollabServer } from './server'
import { ApiClient } from './apiClient'
import { connectClient, typeAt, type TestClient } from './testing/clients'
import { startFakeApi, type FakeApi } from './testing/fakeApi'

// 내부 HTTP — API 의 본문 저장 위임(apply-markdown replace)과 권한 회수(revalidate)를 실제 서버·provider 로 검증한다.
// 테넌트는 일부러 7 — 기본값으로 우연히 통과하지 않게.
const TENANT = 7
const DOC = 'wiki-page:1'
const BODY = '# 제목\n\n첫 문단\n\n둘째 문단'
const TOKEN = 'test-token'
const ACTOR = { userId: 5, name: '양동희' }

describe('internal routes', () => {
  let api: FakeApi
  let app: CollabServer
  let clients: TestClient[]
  // 접근 판정 API 장애 흉내 — true 면 인증기가 예외를 던진다.
  let authThrows: boolean

  const cfg = (): CollabConfig => ({
    port: 0,
    apiUrl: api.url,
    internalToken: TOKEN,
    testMode: false,
    debounceMs: 50,
    maxDebounceMs: 200,
    storeRetryBaseMs: 50,
    storeRetryMaxMs: 200,
  })

  const httpUrl = () => `http://127.0.0.1:${app.address.port}`
  const connect = (token: string, name = DOC): TestClient => {
    const c = connectClient(app.address.port, name, token)
    clients.push(c)
    return c
  }
  const synced = (c: TestClient) => expect.poll(() => c.provider.isSynced, { timeout: 5000 }).toBe(true)
  const serverDoc = (name = DOC) => app.hocuspocus.documents.get(name)
  const unloaded = (name = DOC) => expect.poll(() => app.hocuspocus.documents.has(name), { timeout: 5000 }).toBe(false)
  const postInternal = (path: string, body: unknown, token = TOKEN) =>
    fetch(`${httpUrl()}${path}`, {
      method: 'POST',
      headers: { Authorization: `Internal ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const apply = (body: string, over: Record<string, unknown> = {}, pageId = 1) =>
    postInternal(`/internal/docs/${pageId}/apply-markdown`, { tenantId: TENANT, mode: 'replace', body, actor: ACTOR, ai: false, ...over })
  /** 같은 연결의 메시지는 순서대로 처리된다 — 뒤이어 보낸 awareness 가 관찰자에 도착했으면 앞의 업데이트는 이미 처리됐다. */
  const flushThrough = async (from: TestClient, observer: TestClient, marker: string) => {
    from.provider.setAwarenessField('marker', marker)
    await expect
      .poll(() => [...observer.provider.awareness!.getStates().values()].some((s) => s.marker === marker))
      .toBe(true)
  }

  beforeEach(async () => {
    api = await startFakeApi(TOKEN)
    api.page(1, { tenantId: TENANT, body: BODY, version: 1 })
    api.page(2, { tenantId: TENANT, body: '다른 노트', version: 1 })
    api.token('editor-token', { userId: 5, name: '양동희', role: 'EDITOR', tenantId: TENANT })
    api.token('editor2-token', { userId: 8, name: '이영희', role: 'EDITOR', tenantId: TENANT })
    api.token('viewer-token', { userId: 6, name: '김철수', role: 'VIEWER', tenantId: TENANT })
    clients = []
    authThrows = false
    const real = apiAuthenticator(new ApiClient(api.url, TOKEN))
    app = createCollabServer(cfg(), {
      auth: {
        authenticate: (docName, pageId, token) => {
          if (authThrows) return Promise.reject(new Error('collab-access failed 500'))
          return real.authenticate(docName, pageId, token)
        },
      },
    })
    await app.listen()
  })

  afterEach(async () => {
    for (const c of clients) c.provider.destroy()
    await app.destroy()
    await api.close()
  })

  describe('http surface', () => {
    it('rejects /internal requests without a valid internal token', async () => {
      const none = await fetch(`${httpUrl()}/internal/docs/1/apply-markdown`, { method: 'POST', body: '{}' })
      expect(none.status).toBe(401)
      expect((await postInternal('/internal/docs/revalidate', { tenantId: TENANT, spaceId: 2 }, 'wrong')).status).toBe(401)
      expect((await postInternal('/internal/docs/1/apply-markdown', { tenantId: TENANT }, 'wrong')).status).toBe(401)
      expect(api.stores).toEqual([])
      const bearer = await fetch(`${httpUrl()}/internal/docs/revalidate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}` },
        body: '{}',
      })
      expect(bearer.status).toBe(401)
    })

    it('answers 404 for unknown paths instead of the Hocuspocus welcome page', async () => {
      const root = await fetch(`${httpUrl()}/`)
      expect(root.status).toBe(404)
      expect(await root.text()).not.toContain('Hocuspocus')
      expect((await postInternal('/internal/docs/unknown', {})).status).toBe(404)
      expect((await fetch(`${httpUrl()}/__test/health`)).status).toBe(404)
    })

    it('rejects modes other than replace and malformed bodies with 400', async () => {
      expect((await apply('x', { mode: 'merge', baseBody: 'y' })).status).toBe(400)
      expect((await apply('x', { actor: undefined })).status).toBe(400)
      expect((await apply('x', { tenantId: 'seven' })).status).toBe(400)
      const badJson = await fetch(`${httpUrl()}/internal/docs/1/apply-markdown`, {
        method: 'POST',
        headers: { Authorization: `Internal ${TOKEN}` },
        body: '{not json',
      })
      expect(badJson.status).toBe(400)
      expect((await postInternal('/internal/docs/revalidate', { tenantId: TENANT })).status).toBe(400)
      // 문서에 손대지 않았다(병합 미지원 요청이 replace 로 처리되지 않음).
      expect(api.stores).toEqual([])
    })

    it('rejects a namespaced docName override outside test mode', async () => {
      const res = await apply('x', { docName: 'e2e-1/wiki-page:1' })
      expect(res.status).toBe(400)
      expect(app.hocuspocus.documents.has('e2e-1/wiki-page:1')).toBe(false)
    })
  })

  describe('apply-markdown (replace)', () => {
    it('applies to an open document live, stores once and answers with that store version', async () => {
      const a = connect('editor-token')
      const b = connect('editor2-token')
      await synced(a)
      await synced(b)
      await expect.poll(() => api.stores.length).toBe(1) // 처음 열 때의 이관 저장
      const res = await apply('# 제목\n\nAPI 본문')
      expect(res.status).toBe(200)
      const out = (await res.json()) as { version: number; body: string }
      expect(out.body).toBe('# 제목\n\nAPI 본문')
      // 응답 version = 그 저장의 version(가짜 API 는 저장마다 +1).
      expect(api.stores).toHaveLength(2)
      expect(api.stores[1]).toMatchObject({ tenantId: TENANT, body: '# 제목\n\nAPI 본문', editorIds: [5] })
      expect(out.version).toBe(api.get(1).version)
      // 열려 있던 두 클라이언트 모두 실시간으로 받는다.
      await expect.poll(() => yDocToMarkdown(a.doc)).toBe('# 제목\n\nAPI 본문')
      await expect.poll(() => yDocToMarkdown(b.doc)).toBe('# 제목\n\nAPI 본문')
      // 접속자가 나가도 같은 내용을 다시 저장하지 않는다(내부 연결 해제·지연 저장이 중복 저장을 만들지 않음).
      a.provider.destroy()
      b.provider.destroy()
      await unloaded()
      expect(api.stores).toHaveLength(2)
      expect(api.get(1)).toMatchObject({ version: out.version, bodyVersion: out.version, body: out.body })
      // 다음 로드도 그 판에서 시작한다(stale 아님 → 추가 저장 없음).
      const c = connect('editor-token')
      await synced(c)
      expect(yDocToMarkdown(c.doc)).toBe(out.body)
      expect(api.stores).toHaveLength(2)
    })

    it('applies to a closed document, stores exactly once and unloads it', async () => {
      // 상태를 먼저 만들어 둔다(최초 이관 저장과 분리).
      const a = connect('editor-token')
      await synced(a)
      a.provider.destroy()
      await unloaded()
      const before = api.stores.length
      const res = await apply('닫힌 문서')
      expect(res.status).toBe(200)
      const out = (await res.json()) as { version: number; body: string }
      expect(out).toEqual({ version: api.get(1).version, body: '닫힌 문서' })
      expect(api.stores).toHaveLength(before + 1)
      expect(api.stores.at(-1)).toMatchObject({ tenantId: TENANT, body: '닫힌 문서', editorIds: [5] })
      await unloaded()
      expect(api.stores).toHaveLength(before + 1)
    })

    it('answers with the latest stored version on a fresh page (migration store + apply store)', async () => {
      const res = await apply('새 본문')
      const out = (await res.json()) as { version: number; body: string }
      expect(res.status).toBe(200)
      expect(api.stores.at(-1)?.body).toBe('새 본문')
      expect(out.version).toBe(api.get(1).version)
      await unloaded()
      expect(api.get(1).version).toBe(out.version)
    })

    it('applies the replace as one server-origin transaction', async () => {
      const a = connect('editor-token')
      await synced(a)
      const origins: unknown[] = []
      serverDoc()!.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin))
      expect((await apply('# 다른 제목\n\n첫 문단\n\n둘째 문단')).status).toBe(200)
      expect(origins).toHaveLength(1)
      expect(origins[0]).toMatchObject({ source: 'local', skipStoreHooks: true, context: { actor: ACTOR, ai: false } })
    })

    it('keeps an edit a client made concurrently in an unchanged block', async () => {
      const a = connect('editor-token')
      const b = connect('editor2-token')
      await synced(a)
      await synced(b)
      // a 가 서버와 끊긴 사이(전송 전) 셋째 블록에 입력한다.
      a.provider.disconnect()
      typeAt(a.doc, 2, 'A입력 ')
      // 그동안 서버는 첫 블록만 바꾸는 본문을 적용한다.
      const res = await apply('# 새 제목\n\n첫 문단\n\n둘째 문단')
      expect(res.status).toBe(200)
      await a.provider.connect()
      const want = '# 새 제목\n\n첫 문단\n\nA입력 둘째 문단'
      // 블록을 통째로 지우고 다시 넣는 구현이면 a 의 입력이 사라진다 — 최소 변경이라 둘 다 남는다.
      await expect.poll(() => yDocToMarkdown(serverDoc()!)).toBe(want)
      await expect.poll(() => yDocToMarkdown(b.doc)).toBe(want)
      await expect.poll(() => yDocToMarkdown(a.doc)).toBe(want)
    })

    it('puts the requesting user last in editorIds (API uses the last one as updated_by)', async () => {
      // 지연 저장을 길게 — 두 사람의 입력이 저장되지 않은 채 apply 시점까지 편집자 집합에 남게.
      await app.destroy()
      app = createCollabServer({ ...cfg(), debounceMs: 10000, maxDebounceMs: 20000 })
      await app.listen()
      const a = connect('editor-token')
      const b = connect('editor2-token')
      await synced(a)
      await synced(b)
      await expect.poll(() => api.stores.length).toBe(1)
      // 요청 사용자(5)가 먼저, 다른 편집자(8)가 나중에 입력 — 저장 전 편집자 집합 순서는 [5, 8].
      typeAt(a.doc, 1, '나 ')
      await expect.poll(() => yDocToMarkdown(serverDoc()!)).toContain('나 첫 문단')
      typeAt(b.doc, 2, '남 ')
      await expect.poll(() => yDocToMarkdown(serverDoc()!)).toContain('남 둘째 문단')
      expect((await apply('# 제목\n\n나 첫 문단\n\n남 둘째 문단\n\n추가')).status).toBe(200)
      expect(api.stores.at(-1)?.editorIds).toEqual([8, 5])
    })

    describe('ordering across a failed apply store and its retry', () => {
      const setup = async () => {
        await app.destroy()
        app = createCollabServer({ ...cfg(), debounceMs: 10000, maxDebounceMs: 20000 })
        await app.listen()
        const a = connect('editor-token')
        const b = connect('editor2-token')
        await synced(a)
        await synced(b)
        await expect.poll(() => api.stores.length).toBe(1)
        typeAt(b.doc, 1, '남 ')
        await expect.poll(() => yDocToMarkdown(serverDoc()!)).toContain('남 첫 문단')
        api.failStores = true
        expect((await apply('# 제목\n\n남 첫 문단\n\n둘째 문단\n\nAPI')).status).toBe(503)
        return { a, b }
      }

      it('keeps the requesting user last when the retry stores', async () => {
        await setup()
        api.failStores = false
        await expect.poll(() => api.stores.at(-1)?.body, { timeout: 5000 }).toContain('API')
        expect(api.stores.at(-1)?.editorIds).toEqual([8, 5])
      })

      it('puts a later editor last when someone edits after the failed apply', async () => {
        const { b } = await setup()
        typeAt(b.doc, 2, '나중 ') // 8 이 apply 뒤에 다시 고쳤다 — 가장 최근 변경의 작성자가 마지막
        await expect.poll(() => yDocToMarkdown(serverDoc()!)).toContain('나중 둘째 문단')
        api.failStores = false
        await expect.poll(() => api.stores.at(-1)?.body, { timeout: 5000 }).toContain('나중 둘째 문단')
        expect(api.stores.at(-1)?.editorIds).toEqual([5, 8])
      })

      it('puts an editor who typed while the failing store was in flight after the restored ones', async () => {
        await app.destroy()
        app = createCollabServer({ ...cfg(), debounceMs: 10000, maxDebounceMs: 20000 })
        await app.listen()
        const a = connect('editor-token')
        const b = connect('editor2-token')
        await synced(a)
        await synced(b)
        await expect.poll(() => api.stores.length).toBe(1)
        typeAt(b.doc, 1, '남 ')
        await expect.poll(() => yDocToMarkdown(serverDoc()!)).toContain('남 첫 문단')
        api.failStores = true
        api.storeDelayMs = 500
        const attempts = api.storeAttempts
        const pending = apply('# 제목\n\n남 첫 문단\n\n둘째 문단\n\nAPI')
        // apply 의 저장이 API 에 닿아 응답을 기다리는 동안 8 이 다시 고친다 — 실패 후 되돌린 [8, 5] 보다 더 최근.
        await expect.poll(() => api.storeAttempts).toBe(attempts + 1)
        typeAt(b.doc, 2, '도중 ')
        await expect.poll(() => yDocToMarkdown(serverDoc()!)).toContain('도중 ')
        expect((await pending).status).toBe(503)
        api.storeDelayMs = 0
        api.failStores = false
        await expect.poll(() => api.stores.at(-1)?.body, { timeout: 5000 }).toContain('도중 ')
        expect(api.stores.at(-1)?.editorIds).toEqual([5, 8])
      })
    })

    it('answers 404 when the page is gone at load', async () => {
      api.remove(1)
      const res = await apply('x')
      expect(res.status).toBe(404)
      expect(app.hocuspocus.documents.has(DOC)).toBe(false)
    })

    it('answers 404 when the page is gone at store, closes connections with 4403 and drops the document', async () => {
      const a = connect('editor-token')
      await synced(a)
      await expect.poll(() => api.stores.length).toBe(1)
      api.remove(1)
      const res = await apply('삭제 뒤 적용')
      expect(res.status).toBe(404)
      await expect.poll(() => a.disconnects.map((d) => d.code)).toContain(CLOSE_FORBIDDEN.code)
      await unloaded()
      await new Promise((r) => setTimeout(r, 400))
      expect(api.storeNotFound).toBe(1)
    })

    it('accepts a null actor name', async () => {
      const res = await apply('이름 없음', { actor: { userId: 5, name: null } })
      expect(res.status).toBe(200)
      expect(api.stores.at(-1)?.editorIds).toEqual([5])
    })

    it('refuses a tenant that does not own the open document', async () => {
      const a = connect('editor-token')
      await synced(a)
      const before = api.stores.length
      const res = await apply('침범', { tenantId: 99 })
      expect(res.status).toBe(404)
      expect(yDocToMarkdown(serverDoc()!)).toBe(BODY)
      expect(api.stores).toHaveLength(before)
    })

    it('answers 503 when the store fails and still persists the change once the API recovers', async () => {
      const a = connect('editor-token')
      await synced(a)
      await expect.poll(() => api.stores.length).toBe(1)
      api.failStores = true
      const res = await apply('저장 실패 본문')
      expect(res.status).toBe(503)
      api.failStores = false
      await expect.poll(() => api.stores.at(-1)?.body, { timeout: 5000 }).toBe('저장 실패 본문')
      expect(api.stores.at(-1)?.editorIds).toEqual([5])
    })

    it('answers 503 when the document cannot be loaded (transient API failure)', async () => {
      api.failLoads = true
      const res = await apply('x')
      expect(res.status).toBe(503)
      expect(app.hocuspocus.documents.has(DOC)).toBe(false)
    })
  })

  describe('revalidate', () => {
    it('closes the socket of a user who lost access with 4403 and leaves other users connected', async () => {
      const a = connect('editor-token')
      const other = connect('editor2-token')
      await synced(a)
      await synced(other)
      // 멤버에서 제거 — 토큰은 유효, 판정은 404(확정된 권한 없음).
      api.token('editor-token', { userId: 5, name: '양동희', role: 'EDITOR', tenantId: TENANT, member: false })
      const res = await postInternal('/internal/docs/revalidate', { tenantId: TENANT, spaceId: 2, userId: 5 })
      expect(res.status).toBe(204)
      await expect.poll(() => a.disconnects.map((d) => d.code)).toContain(CLOSE_FORBIDDEN.code)
      expect(a.disconnects.find((d) => d.code === CLOSE_FORBIDDEN.code)?.reason).toBe(CLOSE_FORBIDDEN.reason)
      // provider 는 재접속하지만 다시 판정에서 거부된다.
      await expect.poll(() => a.authFailures).toContain('forbidden')
      // 다른 사용자는 영향 없이 계속 편집·저장한다.
      expect(other.disconnects).toEqual([])
      typeAt(other.doc, 1, '계속 ')
      await expect.poll(() => yDocToMarkdown(serverDoc()!)).toContain('계속 첫 문단')
    })

    it('closes every connection to deleted pages and leaves other pages alone', async () => {
      const a = connect('editor-token')
      const b = connect('editor2-token')
      const elsewhere = connect('editor-token', 'wiki-page:2')
      await synced(a)
      await synced(b)
      await synced(elsewhere)
      api.page(1, { tenantId: 99, body: BODY, version: 9 }) // 삭제 흉내 — 판정 404
      const res = await postInternal('/internal/docs/revalidate', { tenantId: TENANT, spaceId: 2, pageIds: [1] })
      expect(res.status).toBe(204)
      await expect.poll(() => a.disconnects.map((d) => d.code)).toContain(CLOSE_FORBIDDEN.code)
      await expect.poll(() => b.disconnects.map((d) => d.code)).toContain(CLOSE_FORBIDDEN.code)
      expect(elsewhere.disconnects).toEqual([])
      expect(elsewhere.provider.isSynced).toBe(true)
    })

    it('closes with 4401 (not 4403) when the stored token is rejected (401), so the client refreshes and reconnects', async () => {
      const a = connect('editor-token')
      const other = connect('editor2-token')
      await synced(a)
      await synced(other)
      // JWT 만료 흉내 — 실 API 는 만료 토큰을 인증 필터에서 401 로 막는다. 권한을 잃은 것이 아니다.
      api.token('editor-token', null)
      const res = await postInternal('/internal/docs/revalidate', { tenantId: TENANT, spaceId: 2, userId: 5 })
      expect(res.status).toBe(204)
      await expect.poll(() => a.disconnects.map((d) => d.code)).toContain(CLOSE_TOKEN_EXPIRED.code)
      expect(a.disconnects.find((d) => d.code === CLOSE_TOKEN_EXPIRED.code)?.reason).toBe(CLOSE_TOKEN_EXPIRED.reason)
      expect(a.disconnects.map((d) => d.code)).not.toContain(CLOSE_FORBIDDEN.code)
      expect(a.disconnects.map((d) => d.reason)).not.toContain(CLOSE_FORBIDDEN.reason)
      // 같은(낡은) 토큰으로 재접속하면 거절 사유도 권한 없음이 아니라 만료다 — 웹은 토큰을 갱신해 다시 붙는다.
      await expect.poll(() => a.authFailures).toContain('token-expired')
      expect(a.authFailures).not.toContain('forbidden')
      expect(other.disconnects).toEqual([])
    })

    it('switches a downgraded editor to read-only without closing, and drops its later updates', async () => {
      const a = connect('editor-token')
      const observer = connect('editor2-token')
      await synced(a)
      await synced(observer)
      api.token('editor-token', { userId: 5, name: '양동희', role: 'VIEWER', tenantId: TENANT })
      const res = await postInternal('/internal/docs/revalidate', { tenantId: TENANT, pageIds: [1] })
      expect(res.status).toBe(204)
      // 웹이 편집을 막도록 역할 변경을 알린다.
      expect(a.statelessMessages.map((m) => JSON.parse(m))).toContainEqual({ type: COLLAB_ROLE_CHANGED_TYPE, role: 'VIEWER' })
      typeAt(a.doc, 1, '강등 후 입력 ')
      await flushThrough(a, observer, 'after-downgrade')
      expect(yDocToMarkdown(serverDoc()!)).toBe(BODY)
      expect(yDocToMarkdown(observer.doc)).toBe(BODY)
      expect(a.provider.unsyncedChanges).toBeGreaterThan(0)
      expect(a.disconnects).toEqual([])
      // 다른 편집자는 영향 없음.
      expect(observer.statelessMessages).toEqual([])
      typeAt(observer.doc, 2, '정상 ')
      await expect.poll(() => yDocToMarkdown(a.doc)).toContain('정상 둘째 문단')
    })

    it('leaves an editor who keeps access untouched', async () => {
      const a = connect('editor-token')
      const observer = connect('editor2-token')
      await synced(a)
      await synced(observer)
      const res = await postInternal('/internal/docs/revalidate', { tenantId: TENANT, spaceId: 2, userId: 5 })
      expect(res.status).toBe(204)
      typeAt(a.doc, 1, '그대로 ')
      await expect.poll(() => yDocToMarkdown(observer.doc)).toContain('그대로 첫 문단')
      expect(a.disconnects).toEqual([])
      expect(a.statelessMessages).toEqual([])
    })

    it('only re-checks connections of the requested tenant, space and user', async () => {
      const a = connect('editor-token')
      const b = connect('editor2-token')
      await synced(a)
      await synced(b)
      api.token('editor-token', { userId: 5, name: '양동희', role: 'EDITOR', tenantId: TENANT, member: false })
      api.token('editor2-token', { userId: 8, name: '이영희', role: 'EDITOR', tenantId: TENANT, member: false })
      const before = api.accessCalls.length
      // 다른 테넌트·다른 스페이스·다른 사용자 — 어느 연결도 대상이 아니다.
      for (const body of [
        { tenantId: 99, spaceId: 2 },
        { tenantId: TENANT, spaceId: 3 },
        { tenantId: TENANT, spaceId: 2, userId: 123 },
        { tenantId: TENANT, pageIds: [2] },
      ]) {
        expect((await postInternal('/internal/docs/revalidate', body)).status).toBe(204)
      }
      expect(api.accessCalls.length).toBe(before)
      // userId 지정 → 그 사용자만.
      await postInternal('/internal/docs/revalidate', { tenantId: TENANT, spaceId: 2, userId: 8 })
      await expect.poll(() => b.disconnects.map((d) => d.code)).toContain(CLOSE_FORBIDDEN.code)
      expect(a.disconnects).toEqual([])
    })

    it('keeps connections when the access check itself fails (API error)', async () => {
      const a = connect('editor-token')
      const observer = connect('editor2-token')
      await synced(a)
      await synced(observer)
      authThrows = true
      const res = await postInternal('/internal/docs/revalidate', { tenantId: TENANT, spaceId: 2, userId: 5 })
      // 판정 불가는 API 가 재시도·로그할 수 있게 503 — 연결은 유지(일시 장애로 모두를 끊지 않음).
      expect(res.status).toBe(503)
      authThrows = false
      typeAt(a.doc, 1, '유지 ')
      await expect.poll(() => yDocToMarkdown(observer.doc)).toContain('유지 첫 문단')
      expect(a.disconnects).toEqual([])
    })
  })
})
