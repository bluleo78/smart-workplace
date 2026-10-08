import './dom-install'

import {
  CLOSE_FORBIDDEN,
  CLOSE_TOKEN_EXPIRED,
  COLLAB_AI_MARKERS_FIELD,
  COLLAB_ROLE_CHANGED_TYPE,
  type CollabAiMarker,
} from '@smart-workplace/wiki-editor-schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { AiMarkerBoard } from './aiMarkers'
import type { CollabConfig } from './config'
import { FRAGMENT, normalizeMarkdown, yDocToMarkdown } from './markdownCodec'
import { createMergeRunner } from './mergeRunner'
import { apiAuthenticator, createCollabServer, type CollabServer } from './server'
import { ApiClient } from './apiClient'
import { connectClient, replaceTextAt, typeAt, type TestClient } from './testing/clients'
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
  /** 3-way 병합 적용 — AI(MCP·채팅 비서)가 base 를 읽고 body 를 보낸 것. */
  const merge = (baseBody: string, body: string, over: Record<string, unknown> = {}, pageId = 1) =>
    postInternal(`/internal/docs/${pageId}/apply-markdown`, {
      tenantId: TENANT,
      mode: 'merge',
      baseBody,
      body,
      actor: ACTOR,
      ai: true,
      ...over,
    })
  /** 지연 저장을 길게 — 사람 입력이 apply 시점까지 미저장(dirty)으로 남게. */
  const restartWithLongDebounce = async () => {
    await app.destroy()
    app = createCollabServer({ ...cfg(), debounceMs: 10000, maxDebounceMs: 20000 })
    await app.listen()
  }
  /**
   * 병합 워커를 바꿔 다시 띄운다 — 워커 안 인위 지연(동기 블로킹)·짧은 시간 제한으로 느린 병합을 재현.
   * 지연은 요청의 첫 워커 작업(정규화) 뒤부터, 즉 병합 계산에만 건다.
   */
  const restartWithSlowMerge = async (timeoutMs: number, mergeDelayMs: number, over: Partial<CollabConfig> = {}) => {
    await app.destroy()
    let jobs = 0
    app = createCollabServer(
      { ...cfg(), ...over },
      { merger: createMergeRunner({ timeoutMs, testDelayMs: () => (jobs++ === 0 ? 0 : mergeDelayMs) }) },
    )
    await app.listen()
    /** 병합 작업이 워커에 보내졌다(이제 워커가 지연 중 — 그 사이 입력은 "병합 계산 도중"이다). */
    return { mergeDispatched: () => jobs >= 2 }
  }
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

    it('rejects unknown modes, merge without baseBody and malformed bodies with 400', async () => {
      expect((await apply('x', { mode: 'patch' })).status).toBe(400)
      expect((await apply('x', { mode: 'merge' })).status).toBe(400)
      expect((await apply('x', { mode: 'merge', baseBody: 'y', altBaseBody: 3 })).status).toBe(400)
      expect((await apply('x', { actor: undefined })).status).toBe(400)
      expect((await apply('x', { tenantId: 'seven' })).status).toBe(400)
      const badJson = await fetch(`${httpUrl()}/internal/docs/1/apply-markdown`, {
        method: 'POST',
        headers: { Authorization: `Internal ${TOKEN}` },
        body: '{not json',
      })
      expect(badJson.status).toBe(400)
      expect((await postInternal('/internal/docs/revalidate', { tenantId: TENANT })).status).toBe(400)
      // 계약 위반 400 은 기계 판독 코드 invalid_request — API 는 본문 거부 코드가 아닌 400 을 서버 버그(500)로 본다.
      const bad = await apply('x', { tenantId: 'seven' })
      expect(((await bad.json()) as { code?: string }).code).toBe('invalid_request')
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
      expect(out).toEqual({ version: api.get(1).version, body: '닫힌 문서', persisted: true })
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
        expect((await apply('# 제목\n\n남 첫 문단\n\n둘째 문단\n\nAPI')).status).toBe(200)
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
        expect((await pending).status).toBe(200)
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

    it('answers 200 persisted:false when the store fails after applying, and persists the change once the API recovers', async () => {
      const a = connect('editor-token')
      await synced(a)
      await expect.poll(() => api.stores.length).toBe(1)
      api.failStores = true
      const res = await apply('저장 실패 본문')
      // 문서는 이미 바뀌었다 — 503 이면 호출자가 같은 변경을 다시 보낸다.
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ persisted: false, body: '저장 실패 본문' })
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

  describe('apply-markdown (merge)', () => {
    it("merges a person's edit in the same paragraph the AI rewrites (character level)", async () => {
      const a = connect('editor-token')
      const b = connect('editor2-token')
      await synced(a)
      await synced(b)
      typeAt(b.doc, 1, '사람 ')
      await expect.poll(() => yDocToMarkdown(serverDoc()!)).toContain('사람 첫 문단')
      // AI 는 사람 입력 전의 판(BODY)을 읽고 같은 문단 끝을 고쳤다.
      const res = await merge(BODY, '# 제목\n\n첫 문단입니다\n\n둘째 문단')
      expect(res.status).toBe(200)
      const want = '# 제목\n\n사람 첫 문단입니다\n\n둘째 문단'
      expect(((await res.json()) as { body: string }).body).toBe(want)
      await expect.poll(() => yDocToMarkdown(a.doc)).toBe(want)
      await expect.poll(() => yDocToMarkdown(b.doc)).toBe(want)
    })

    it("stores the person's unsaved edit before an AI apply and flags the apply store for a snapshot", async () => {
      await restartWithLongDebounce()
      const b = connect('editor2-token')
      await synced(b)
      await expect.poll(() => api.stores.length).toBe(1) // 처음 열 때의 상태만 저장
      // 사람이 AI 패치의 문맥 글자('문단')를 고쳤다(아직 지연 저장 전) → 같은 블록(유사도 짝)인데 정확 문맥이 깨져 정책상 AI 쪽.
      // (완전히 다른 문장으로 바꾸면 유사도 문턱 아래라 "사람 삭제 + 새 블록"이 되어 둘 다 남는다 — 그건 Task 1 정책대로다.)
      replaceTextAt(b.doc, 1, '첫 문장')
      await expect.poll(() => yDocToMarkdown(serverDoc()!)).toContain('첫 문장')
      const res = await merge(BODY, '# 제목\n\n첫 문단입니다\n\n둘째 문단')
      expect(res.status).toBe(200)
      const [flush, applied] = api.stores.slice(-2)
      // 적용 직전 저장 = API 가 리비전으로 남길 "직전 판" — 사람의 마지막 입력을 담는다.
      expect(flush).toMatchObject({ stateOnly: false, body: '# 제목\n\n첫 문장\n\n둘째 문단', editorIds: [8], snapshot: false })
      expect(applied).toMatchObject({ body: '# 제목\n\n첫 문단입니다\n\n둘째 문단', editorIds: [5], snapshot: true })
      await expect.poll(() => yDocToMarkdown(b.doc)).toBe('# 제목\n\n첫 문단입니다\n\n둘째 문단')
    })

    it('removes a block the AI deleted even if the person edited it', async () => {
      const b = connect('editor2-token')
      await synced(b)
      typeAt(b.doc, 2, '사람 ')
      await expect.poll(() => yDocToMarkdown(serverDoc()!)).toContain('사람 둘째 문단')
      expect((await merge(BODY, '# 제목\n\n첫 문단')).status).toBe(200)
      await expect.poll(() => yDocToMarkdown(b.doc)).toBe('# 제목\n\n첫 문단')
    })

    it('normalizes the AI body first so untouched rich blocks stay the person’s version', async () => {
      const raw =
        '# 노트\n\n첫 문단\n\n|a|b|\n|-|-|\n|1|2|\n\n담당 <@5> 확인\n\n![그림](/api/v1/wiki/pages/3/attachments/9/content)\n\n_강조_ 끝'
      api.page(3, { tenantId: TENANT, body: normalizeMarkdown(raw), version: 1 })
      const DOC3 = 'wiki-page:3'
      const b = connect('editor2-token', DOC3)
      await synced(b)
      const table = () => serverDoc(DOC3)!.getXmlFragment(FRAGMENT).get(2)
      typeAt(b.doc, 1, '사람 ')
      await expect.poll(() => yDocToMarkdown(serverDoc(DOC3)!)).toContain('사람 첫 문단')
      const tableBefore = table()
      // AI 는 정규화 전 표기 그대로 돌려보내며 마지막 문단만 고친다.
      const res = await merge(raw, raw.replace('_강조_ 끝', '_강조_ 끝 AI'), {}, 3)
      expect(res.status).toBe(200)
      const want = normalizeMarkdown(raw.replace('첫 문단', '사람 첫 문단').replace('_강조_ 끝', '_강조_ 끝 AI'))
      await expect.poll(() => yDocToMarkdown(b.doc)).toBe(want)
      // 표는 손대지 않았다(같은 Y 타입 — 그 안의 사람 커서·동시 입력이 유지된다). 멘션도 실제 문서에 하나 그대로.
      expect(table()).toBe(tableBefore)
      expect(yDocToMarkdown(serverDoc(DOC3)!).match(/<@5>/g)).toHaveLength(1)
    })

    it('serializes two concurrent AI merges and keeps both', async () => {
      const a = connect('editor-token')
      await synced(a)
      const [r1, r2] = await Promise.all([
        merge(BODY, '# 제목\n\n첫 문단 AI1\n\n둘째 문단'),
        merge(BODY, '# 제목\n\n첫 문단\n\n둘째 문단 AI2', { actor: { userId: 8, name: '이영희' } }),
      ])
      expect(r1.status).toBe(200)
      expect(r2.status).toBe(200)
      const v1 = ((await r1.json()) as { version: number }).version
      const v2 = ((await r2.json()) as { version: number }).version
      expect(v1).not.toBe(v2)
      await expect.poll(() => yDocToMarkdown(a.doc)).toBe('# 제목\n\n첫 문단 AI1\n\n둘째 문단 AI2')
    })

    it("merges on a large note without dropping the person's distant edit", async () => {
      const big = Array.from({ length: 1000 }, (_, i) => `문단 ${i} 내용`).join('\n\n')
      api.page(4, { tenantId: TENANT, body: big, version: 1 })
      const DOC4 = 'wiki-page:4'
      const b = connect('editor2-token', DOC4)
      await synced(b)
      typeAt(b.doc, 900, '사람 ')
      await expect.poll(() => yDocToMarkdown(serverDoc(DOC4)!)).toContain('사람 문단 900 내용')
      const started = performance.now()
      const res = await merge(big, big.replace('문단 10 내용', '문단 10 AI 내용'), {}, 4)
      expect(res.status).toBe(200)
      // 회귀 감시용 넉넉한 상한 — 정렬이 O(n²) 문자열 diff 로 퇴화하면 수십 초가 걸린다.
      expect(performance.now() - started).toBeLessThan(10_000)
      const md = yDocToMarkdown(serverDoc(DOC4)!)
      expect(md).toContain('사람 문단 900 내용')
      expect(md).toContain('문단 10 AI 내용')
    }, 30_000)

    it('keeps a person paragraph once across chained AI saves (second save continues from the merged response)', async () => {
      const b = connect('editor2-token')
      await synced(b)
      // 사람이 '둘째 문단' 앞에 새 문단을 넣고 → AI 가 그 전 판(BODY)으로 첫 저장 → 응답(병합본)에는 사람 문단이 들어 있다.
      const p = new Y.XmlElement('paragraph')
      p.insert(0, [new Y.XmlText('사람 문단입니다')])
      b.doc.getXmlFragment(FRAGMENT).insert(2, [p])
      await expect.poll(() => yDocToMarkdown(serverDoc()!)).toBe('# 제목\n\n첫 문단\n\n사람 문단입니다\n\n둘째 문단')
      const first = (await (await merge(BODY, '# 제목\n\n첫 문단 AI\n\n둘째 문단')).json()) as { version: number; body: string }
      expect(first.body).toBe('# 제목\n\n첫 문단 AI\n\n사람 문단입니다\n\n둘째 문단')
      // 둘째 저장: AI 는 응답 본문에서 이어 쓴다(사람 문단 포함). API 는 baseBody=그 판 실제 본문, altBaseBody=첫 저장 제출본을 싣는다.
      const res = await merge(first.body, '# 제목\n\n첫 문단 AI\n\n사람 문단입니다\n\n둘째 문단 AI', {
        altBaseBody: '# 제목\n\n첫 문단 AI\n\n둘째 문단',
      })
      expect(res.status).toBe(200)
      await expect
        .poll(() => yDocToMarkdown(b.doc))
        .toBe('# 제목\n\n첫 문단 AI\n\n사람 문단입니다\n\n둘째 문단 AI')
    })

    it('does not snapshot or pre-store for a non-AI (old web) merge', async () => {
      await restartWithLongDebounce()
      const b = connect('editor2-token')
      await synced(b)
      await expect.poll(() => api.stores.length).toBe(1)
      typeAt(b.doc, 2, '사람 ')
      await expect.poll(() => yDocToMarkdown(serverDoc()!)).toContain('사람 둘째 문단')
      expect((await merge(BODY, '# 제목\n\n첫 문단 웹\n\n둘째 문단', { ai: false })).status).toBe(200)
      // 사전 저장 없이 적용 저장 한 번(사람 입력도 함께 담김), snapshot 없음.
      expect(api.stores).toHaveLength(2)
      expect(api.stores[1]).toMatchObject({ body: '# 제목\n\n첫 문단 웹\n\n사람 둘째 문단', snapshot: false })
    })

    it('honors an explicit snapshot from a person (old web) merge without pre-storing', async () => {
      await restartWithLongDebounce()
      const b = connect('editor2-token')
      await synced(b)
      await expect.poll(() => api.stores.length).toBe(1)
      typeAt(b.doc, 2, '사람 ')
      await expect.poll(() => yDocToMarkdown(serverDoc()!)).toContain('사람 둘째 문단')
      expect((await merge(BODY, '# 제목\n\n첫 문단 웹\n\n둘째 문단', { ai: false, snapshot: true })).status).toBe(200)
      // 사전 저장은 AI 만 — 적용 저장 한 번에 snapshot 을 싣는다(API 가 직전 판을 리비전으로 남긴다).
      expect(api.stores).toHaveLength(2)
      expect(api.stores[1]).toMatchObject({ body: '# 제목\n\n첫 문단 웹\n\n사람 둘째 문단', snapshot: true })
    })

    it('answers 503 within the apply deadline while the document lock is held, and applies nothing', async () => {
      await app.destroy()
      app = createCollabServer({ ...cfg(), applyDeadlineMs: 400 })
      await app.listen()
      const a = connect('editor-token')
      await synced(a)
      await expect.poll(() => api.stores.length).toBe(1)
      // 다른 저장이 문서 잠금을 오래 쥐고 있다(느린 API 저장 흉내).
      let release!: () => void
      const held = serverDoc()!.saveMutex.runExclusive(() => new Promise<void>((r) => (release = r)))
      const started = performance.now()
      const res = await merge(BODY, '# 제목\n\n첫 문단 AI\n\n둘째 문단')
      expect(res.status).toBe(503)
      expect(performance.now() - started).toBeLessThan(2000)
      // 잠금이 풀린 뒤에도 기한이 지난 요청은 적용·저장하지 않는다.
      release()
      await held
      await new Promise((r) => setTimeout(r, 200))
      expect(yDocToMarkdown(serverDoc()!)).toBe(BODY)
      expect(api.stores).toHaveLength(1)
      // 잠금을 잃지 않았다 — 다음 요청은 정상 처리된다.
      expect((await merge(BODY, '# 제목\n\n첫 문단 AI\n\n둘째 문단')).status).toBe(200)
      await expect.poll(() => yDocToMarkdown(a.doc)).toBe('# 제목\n\n첫 문단 AI\n\n둘째 문단')
    })

    it('answers 200 with persisted:false when the apply store hangs past the deadline, and applies once', async () => {
      await app.destroy()
      // 적용 전 단계(워커 기동·정규화·병합)는 부하가 걸리면 수백 ms 가 걸린다 — 작업마다 300ms 지연으로 그 상황을 고정한다.
      // 기한은 그 준비가 끝나고도 남게 잡아, 이 테스트가 보려는 "적용 뒤 저장이 기한을 넘김"만 기한에 걸리게 한다.
      app = createCollabServer({ ...cfg(), applyDeadlineMs: 2500 }, { merger: createMergeRunner({ testDelayMs: 300 }) })
      await app.listen()
      const a = connect('editor-token')
      await synced(a)
      await expect.poll(() => api.stores.length).toBe(1)
      const seen = new Set<string>()
      a.provider.awareness!.on('change', () =>
        [...a.provider.awareness!.getStates().values()]
          .flatMap((st) => (st[COLLAB_AI_MARKERS_FIELD] as CollabAiMarker[] | null | undefined) ?? [])
          .forEach((m) => seen.add(m.id)),
      )
      // 적용 뒤 즉시 저장이 기한(과 최소 3초)을 넘겨 걸린다.
      api.storeDelayMs = 9000
      const started = performance.now()
      const res = await merge(BODY, '# 제목\n\n첫 문단 AI\n\n둘째 문단')
      // 저장 대기는 남은 기한(최소 3초)으로 끊긴다 — API read 타임아웃 전에 답한다.
      expect(performance.now() - started).toBeLessThan(7000)
      // 문서는 이미 바뀌었다 — 503 이 아니라 적용됨(저장은 재시도로 이어진다).
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ persisted: false, body: '# 제목\n\n첫 문단 AI\n\n둘째 문단' })
      await expect.poll(() => yDocToMarkdown(a.doc)).toBe('# 제목\n\n첫 문단 AI\n\n둘째 문단')
      api.storeDelayMs = 0
      // 재시도 저장이 같은 본문을 한 번 담는다(두 번 적용되지 않음).
      await expect.poll(() => api.stores.some((st) => st.body === '# 제목\n\n첫 문단 AI\n\n둘째 문단'), { timeout: 15000 }).toBe(true)
      expect(yDocToMarkdown(serverDoc()!).match(/첫 문단 AI/g)).toHaveLength(1)
      // 저장되지 않은 적용엔 ✦ 표식을 올리지 않는다.
      const b = connect('editor2-token')
      await synced(b)
      await flushThrough(b, a, 'after-unpersisted')
      expect(seen.size).toBe(0)
    }, 30000)

    it('rejects an empty AI body with 400 and touches nothing, unless base and current are empty too', async () => {
      const a = connect('editor-token')
      await synced(a)
      await expect.poll(() => api.stores.length).toBe(1)
      // 빈 본문을 병합하면 "AI 가 거의 모두 지움"이 된다 — 거부.
      for (const body of ['', '   \n\n  ']) {
        const res = await merge(BODY, body)
        expect(res.status).toBe(400)
        const err = (await res.json()) as { error: string; code?: string }
        expect(err.error).toMatch(/empty/)
        // 본문 거부는 코드로 구분한다 — API 는 이 코드만 호출자 400 으로 돌린다.
        expect(err.code).toBe('empty_body')
      }
      expect(yDocToMarkdown(serverDoc()!)).toBe(BODY)
      expect(api.stores).toHaveLength(1)
      // 기준본은 비었지만 현재본에 사람이 쓴 내용이 있으면 역시 거부.
      expect((await merge('', '')).status).toBe(400)
      expect(yDocToMarkdown(serverDoc()!)).toBe(BODY)
      // 기준본·현재본·AI본이 모두 비면 허용(빈 노트에 빈 저장).
      api.page(5, { tenantId: TENANT, body: '', version: 1 })
      expect((await merge('', '  ', {}, 5)).status).toBe(200)
    })

    it('keeps other clients syncing while a slow merge runs off the event loop, and keeps their edits', async () => {
      // 워커가 2초 동안 동기 블로킹(CPU 바쁜 병합 흉내) — 메인 스레드에서 돌면 그동안 실시간 동기화가 멈춘다.
      await restartWithSlowMerge(10_000, 2000)
      const a = connect('editor-token')
      const b = connect('editor2-token')
      await synced(a)
      await synced(b)
      let settled = false
      const pending = merge(BODY, '# 제목\n\n첫 문단 AI\n\n둘째 문단').then((r) => {
        settled = true
        return r
      })
      await new Promise((r) => setTimeout(r, 300))
      typeAt(a.doc, 2, '도중 ')
      // 병합이 아직 끝나지 않았는데도 다른 접속자에게 곧바로 전달된다.
      await expect.poll(() => yDocToMarkdown(b.doc), { timeout: 1000 }).toContain('도중 둘째 문단')
      expect(settled).toBe(false)
      const res = await pending
      expect(res.status).toBe(200)
      // 병합 도중 들어온 입력도 사라지지 않는다(바뀐 현재본으로 다시 병합).
      const want = '# 제목\n\n첫 문단 AI\n\n도중 둘째 문단'
      expect(((await res.json()) as { body: string }).body).toBe(want)
      await expect.poll(() => yDocToMarkdown(b.doc)).toBe(want)
    }, 20_000)

    it('stores a person edit made during the worker merge before the AI apply, so an AI-side resolution is restorable', async () => {
      // 지연 저장을 길게 — 병합 도중 입력이 지연 저장으로 우연히 남지 않게(남는다면 이 저장 경로 덕이어야 한다).
      const slow = await restartWithSlowMerge(10_000, 1500, { debounceMs: 10000, maxDebounceMs: 20000 })
      const b = connect('editor2-token')
      await synced(b)
      await expect.poll(() => api.stores.length).toBe(1)
      const pending = merge(BODY, '# 제목\n\n첫 문단입니다\n\n둘째 문단')
      await expect.poll(slow.mergeDispatched, { timeout: 5000 }).toBe(true)
      // 워커가 계산하는 동안 사람이 AI 와 같은 문단을 고친다 → 정책상 AI 쪽으로 정해져 덮인다.
      replaceTextAt(b.doc, 1, '첫 문장')
      await expect.poll(() => yDocToMarkdown(serverDoc()!)).toContain('첫 문장')
      const res = await pending
      expect(res.status).toBe(200)
      expect(((await res.json()) as { body: string }).body).toBe('# 제목\n\n첫 문단입니다\n\n둘째 문단')
      // 덮인 사람 입력은 AI 적용 저장(snapshot) 바로 앞 판에 남아 있어 리비전으로 되돌릴 수 있다.
      const [before, applied] = api.stores.slice(-2)
      expect(before).toMatchObject({ stateOnly: false, body: '# 제목\n\n첫 문장\n\n둘째 문단', editorIds: [8], snapshot: false })
      expect(applied).toMatchObject({ body: '# 제목\n\n첫 문단입니다\n\n둘째 문단', snapshot: true })
    }, 20_000)

    it('does not store or snapshot a no-op AI merge and answers with the current version', async () => {
      await restartWithLongDebounce()
      const b = connect('editor2-token')
      await synced(b)
      await expect.poll(() => api.stores.length).toBe(1)
      // 깨끗한 문서에 바뀐 것 없는 AI 저장 → 저장 없음, 지금 version.
      let res = await merge(BODY, BODY)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ version: api.get(1).version, body: BODY, persisted: true })
      expect(api.stores).toHaveLength(1)
      // 미저장 사람 입력이 있으면 적용 직전 저장(snapshot 없음)만 하고 그 version 으로 답한다.
      typeAt(b.doc, 2, '사람 ')
      await expect.poll(() => yDocToMarkdown(serverDoc()!)).toContain('사람 둘째 문단')
      res = await merge(BODY, BODY)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ version: api.get(1).version, body: '# 제목\n\n첫 문단\n\n사람 둘째 문단', persisted: true })
      expect(api.stores).toHaveLength(2)
      expect(api.stores[1]).toMatchObject({ snapshot: false, editorIds: [8] })
    })

    it('answers 500 when the merge worker crashes and serves the next merge from a fresh worker', async () => {
      await app.destroy()
      let jobs = 0
      // 둘째 워커 작업(첫 요청의 병합)에서 워커가 죽는다.
      app = createCollabServer(cfg(), { merger: createMergeRunner({ testFault: () => (jobs++ === 1 ? 'exit' : undefined) }) })
      await app.listen()
      const a = connect('editor-token')
      await synced(a)
      await expect.poll(() => api.stores.length).toBe(1)
      const crashed = await merge(BODY, '# 제목\n\n첫 문단 AI\n\n둘째 문단')
      expect(crashed.status).toBe(500)
      expect(yDocToMarkdown(serverDoc()!)).toBe(BODY)
      expect(api.stores).toHaveLength(1)
      const ok = await merge(BODY, '# 제목\n\n첫 문단 AI\n\n둘째 문단')
      expect(ok.status).toBe(200)
      await expect.poll(() => yDocToMarkdown(a.doc)).toBe('# 제목\n\n첫 문단 AI\n\n둘째 문단')
    })

    it('answers 503 on a merge timeout and leaves the document and store untouched', async () => {
      await restartWithSlowMerge(1000, 5000)
      const a = connect('editor-token')
      await synced(a)
      await expect.poll(() => api.stores.length).toBe(1)
      const origins: unknown[] = []
      serverDoc()!.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin))
      const started = performance.now()
      const res = await merge(BODY, '# 제목\n\n첫 문단 AI\n\n둘째 문단')
      expect(res.status).toBe(503)
      expect(performance.now() - started).toBeLessThan(4000)
      expect(origins).toEqual([])
      expect(yDocToMarkdown(serverDoc()!)).toBe(BODY)
      expect(yDocToMarkdown(a.doc)).toBe(BODY)
      expect(api.stores).toHaveLength(1)
    })
  })

  describe('AI marker (server awareness)', () => {
    /** 클라이언트가 받은 모든 awareness 상태의 ✦ 표식. */
    const markersOn = (c: TestClient): CollabAiMarker[] =>
      [...c.provider.awareness!.getStates().values()].flatMap(
        (s) => (s[COLLAB_AI_MARKERS_FIELD] as CollabAiMarker[] | null | undefined) ?? [],
      )
    const restartWithMarkerMs = async (ms: number, markers?: AiMarkerBoard) => {
      await app.destroy()
      app = createCollabServer({ ...cfg(), aiMarkerMs: ms }, markers ? { markers } : {})
      await app.listen()
    }

    it('shows ✦ name at the changed block to open clients for a while', async () => {
      await restartWithMarkerMs(400)
      const b = connect('editor2-token')
      await synced(b)
      expect((await merge(BODY, '# 제목\n\n첫 문단\n\n둘째 문단 AI')).status).toBe(200)
      await expect.poll(() => markersOn(b).map((m) => m.name)).toEqual(['양동희'])
      const m = markersOn(b)[0]
      expect(m.userId).toBe(5)
      // 위치 = 바뀐 블록(셋째, index 2)의 시작 — 받는 쪽 문서에서 풀린다.
      // (프래그먼트를 먼저 XmlFragment 로 꺼내 둔다 — 웹 에디터는 늘 묶여 있다. 안 꺼내면 이름 조회가 타입 없는 자리표시를 만든다.)
      const frag = b.doc.getXmlFragment(FRAGMENT)
      const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(m.anchor), b.doc)
      expect(abs?.type).toBe(frag)
      expect(abs?.index).toBe(2)
      await expect.poll(() => markersOn(b), { timeout: 3000 }).toEqual([])
      // 비면 서버 상태 자체를 지운다 — 클라이언트에 남는 건 자기 상태뿐.
      expect(b.provider.awareness!.getStates().size).toBe(1)
    })

    it('shows the marker to a client that connects while it is up', async () => {
      await restartWithMarkerMs(2000)
      const a = connect('editor-token')
      await synced(a)
      expect((await merge(BODY, '# 제목\n\n첫 문단 AI\n\n둘째 문단')).status).toBe(200)
      await expect.poll(() => markersOn(a).length).toBe(1)
      // 늦게 붙은 접속자도 연결 시 현재 awareness 를 받는다.
      const late = connect('editor2-token')
      await synced(late)
      await expect.poll(() => markersOn(late).map((m) => m.name)).toEqual(['양동희'])
    })

    it('shows no marker for a person (old web) merge or a no-op AI merge', async () => {
      await restartWithMarkerMs(400)
      const b = connect('editor2-token')
      await synced(b)
      // 받은 표식 id 를 모두 모은다.
      const seen = new Set<string>()
      b.provider.awareness!.on('change', () => markersOn(b).forEach((m) => seen.add(m.id)))
      expect((await merge(BODY, '# 제목\n\n첫 문단 웹\n\n둘째 문단', { ai: false })).status).toBe(200)
      expect((await merge('# 제목\n\n첫 문단 웹\n\n둘째 문단', '# 제목\n\n첫 문단 웹\n\n둘째 문단')).status).toBe(200)
      // 마지막에 실제로 바꾸는 AI 적용 — 같은 연결의 메시지는 순서대로 오므로, 이 표식이 도착했으면 앞의 두 적용이 보냈을 표식도 이미 왔다.
      expect((await merge('# 제목\n\n첫 문단 웹\n\n둘째 문단', '# 제목 AI\n\n첫 문단 웹\n\n둘째 문단')).status).toBe(200)
      await expect.poll(() => markersOn(b).length).toBe(1)
      expect(seen.size).toBe(1)
    })

    it('shows no marker when the apply store fails', async () => {
      await restartWithMarkerMs(2000)
      const a = connect('editor-token')
      const b = connect('editor2-token')
      await synced(a)
      await synced(b)
      await expect.poll(() => api.stores.length).toBe(1)
      const seen = new Set<string>()
      b.provider.awareness!.on('change', () => markersOn(b).forEach((m) => seen.add(m.id)))
      api.failStores = true
      const res = await merge(BODY, '# 제목\n\n첫 문단 AI\n\n둘째 문단')
      expect(res.status).toBe(200)
      expect(((await res.json()) as { persisted: boolean }).persisted).toBe(false)
      // a 의 awareness 가 b 에 닿았으면, 그보다 먼저 보냈을 서버 표식도 이미 닿았다(같은 소켓의 순서).
      api.failStores = false
      await flushThrough(a, b, 'after-failed-apply')
      expect(seen.size).toBe(0)
    })

    it('anchors the marker where the AI changed even if someone inserts above while the apply store is in flight', async () => {
      await restartWithMarkerMs(5000)
      const a = connect('editor-token')
      const b = connect('editor2-token')
      await synced(a)
      await synced(b)
      await expect.poll(() => api.stores.length).toBe(1)
      api.storeDelayMs = 800
      const attempts = api.storeAttempts
      const pending = merge(BODY, '# 제목\n\n첫 문단\n\n둘째 문단 AI')
      // 적용은 끝났고(서버 문서에 AI 글) 즉시 저장이 API 에 가 있는 동안 —
      await expect.poll(() => api.storeAttempts).toBeGreaterThan(attempts)
      expect(yDocToMarkdown(serverDoc()!)).toContain('둘째 문단 AI')
      // 다른 사람이 맨 앞에 문단을 넣는다(AI 가 바꾼 블록은 index 2 → 3).
      const para = new Y.XmlElement('paragraph')
      para.insert(0, [new Y.XmlText('맨 앞')])
      b.doc.getXmlFragment(FRAGMENT).insert(0, [para])
      await flushThrough(b, a, 'inserted-above')
      expect((await pending).status).toBe(200)
      api.storeDelayMs = 0
      await expect.poll(() => markersOn(a).length).toBe(1)
      const frag = a.doc.getXmlFragment(FRAGMENT)
      const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(markersOn(a)[0].anchor), a.doc)
      expect(abs?.type).toBe(frag)
      expect(abs?.index).toBe(3)
      expect((frag.get(3) as Y.XmlElement).toString()).toContain('둘째 문단 AI')
    })

    it("moves the same person's marker instead of stacking and keeps another person's", async () => {
      await restartWithMarkerMs(2000)
      const b = connect('editor2-token')
      await synced(b)
      expect((await merge(BODY, '# 제목 AI\n\n첫 문단\n\n둘째 문단')).status).toBe(200)
      expect((await merge(BODY, '# 제목\n\n첫 문단 AI\n\n둘째 문단')).status).toBe(200)
      expect(
        (await merge(BODY, '# 제목\n\n첫 문단\n\n둘째 문단 AI2', { actor: { userId: 8, name: '이영희' } })).status,
      ).toBe(200)
      await expect.poll(() => markersOn(b).map((m) => m.name).sort()).toEqual(['양동희', '이영희'])
      // 같은 사람(5)의 표식은 최신 위치(첫 문단, index 1)로 옮겨졌다.
      const mine = markersOn(b).find((m) => m.userId === 5)!
      const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(mine.anchor), b.doc)
      expect(abs?.index).toBe(1)
    })

    it('does not fail, reload or linger when the document unloads before the marker expires', async () => {
      const board = new AiMarkerBoard(300)
      await restartWithMarkerMs(300, board)
      const errors: unknown[] = []
      const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => void errors.push(args))
      const onRejection = (e: unknown) => errors.push(e)
      process.on('unhandledRejection', onRejection)
      try {
        // 접속자 없는 문서 — 적용 후 바로 내려간다.
        expect((await merge(BODY, '# 제목\n\n첫 문단 AI\n\n둘째 문단')).status).toBe(200)
        await unloaded()
        // 내려간 문서의 표식 타이머는 그 자리에서 정리된다 — 문서를 붙잡지도, 프로세스를 붙잡지도 않는다.
        expect(board.pendingTimers()).toEqual([])
        expect(board.trackedDocs).toBe(0)
        // 만료 시각이 지나도 오류가 없고, 내려간 문서가 다시 올라오지도 않는다.
        await new Promise((r) => setTimeout(r, 500))
        expect(app.hocuspocus.documents.has(DOC)).toBe(false)
        expect(errors).toEqual([])
      } finally {
        errorSpy.mockRestore()
        process.off('unhandledRejection', onRejection)
      }
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
