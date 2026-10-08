import './dom-install'

import { afterEach, describe, expect, it } from 'vitest'
import { CLOSE_FORBIDDEN } from '@smart-workplace/wiki-editor-schema'

import { buildCollabServer } from './app'
import type { CollabConfig } from './config'
import { yDocToMarkdown } from './markdownCodec'
import { createCollabServer, type CollabServer } from './server'
import { connectClient, typeAt, type TestClient } from './testing/clients'
import { createTestMode, TEST_MODE_INTERNAL_TOKEN } from './testMode'

// E2E 테스트 모드 — COLLAB_TEST_MODE 만이 /__test/* 경로·네임스페이스 문서 이름·메모리 저장·인증 스텁을 켠다(R2).
describe('test mode', () => {
  let app: CollabServer
  let clients: TestClient[] = []

  const start = async (testMode: boolean) => {
    const cfg: CollabConfig = {
      port: 0,
      // 테스트 모드는 API 를 부르지 않는다 — 닿을 수 없는 주소로 둬 실수로 부르면 실패하게.
      apiUrl: 'http://127.0.0.1:9',
      internalToken: '',
      testMode,
      debounceMs: 50,
      maxDebounceMs: 200,
    }
    app = buildCollabServer(cfg)
    await app.listen()
  }
  const url = (p: string) => `http://127.0.0.1:${app.address.port}${p}`
  const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(url(p), { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const connect = (name: string, token: string) => {
    const c = connectClient(app.address.port, name, token)
    clients.push(c)
    return c
  }
  const synced = (c: TestClient) => expect.poll(() => c.provider.isSynced, { timeout: 5000 }).toBe(true)
  const markdown = async (docName: string) => {
    const res = await fetch(url(`/__test/markdown?docName=${encodeURIComponent(docName)}`))
    return { status: res.status, json: res.status === 200 ? ((await res.json()) as { markdown: string; version: number }) : null }
  }

  afterEach(async () => {
    for (const c of clients) c.provider.destroy()
    clients = []
    await app.destroy()
  })

  // 운영 헬스 체크(K8S probe) — 플래그와 무관하게 인증 없이 200, 그 밖의 경로는 여전히 404.
  it.each([false, true])('answers GET /health with 200 without auth (testMode=%s)', async (testMode) => {
    await start(testMode)
    const res = await fetch(url('/health'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect((await fetch(url('/health?probe=1'))).status).toBe(200)
    expect((await fetch(url('/'))).status).toBe(404)
    expect((await post('/health', {})).status).toBe(404)
  })

  describe('flag off', () => {
    it('answers 404 on every /__test route', async () => {
      await start(false)
      expect((await fetch(url('/__test/health'))).status).toBe(404)
      expect((await post('/__test/seed', { docName: 'ns/wiki-page:1', body: 'x' })).status).toBe(404)
      expect((await fetch(url('/__test/markdown?docName=wiki-page:1'))).status).toBe(404)
      expect((await post('/__test/reset', {})).status).toBe(404)
    })

    it('does not mount injected test routes unless the flag is on', async () => {
      const tm = createTestMode()
      app = createCollabServer(
        { port: 0, apiUrl: 'http://127.0.0.1:9', internalToken: 'x', testMode: false, debounceMs: 50, maxDebounceMs: 200 },
        { testRoutes: tm.routes },
      )
      await app.listen()
      expect((await fetch(url('/__test/health'))).status).toBe(404)
    })

    it('rejects namespaced document names', async () => {
      await start(false)
      const c = connect('ns/wiki-page:1', 'anything')
      await expect.poll(() => c.authFailures).toContain('invalid-document')
    })
  })

  describe('flag on', () => {
    it('reports health', async () => {
      await start(true)
      const res = await fetch(url('/__test/health'))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
    })

    it('serves seeded content to namespaced documents and keeps namespaces apart', async () => {
      await start(true)
      expect((await post('/__test/seed', { docName: 'e2e-a/wiki-page:1', body: '# A 노트' })).status).toBe(204)
      expect((await post('/__test/seed', { docName: 'e2e-b/wiki-page:1', body: '# B 노트' })).status).toBe(204)
      const a = connect('e2e-a/wiki-page:1', 'uid=1&name=양동희')
      const b = connect('e2e-b/wiki-page:1', 'uid=1&name=양동희')
      await synced(a)
      await synced(b)
      expect(yDocToMarkdown(a.doc)).toBe('# A 노트')
      expect(yDocToMarkdown(b.doc)).toBe('# B 노트')
    })

    it('syncs two users, drops a seeded VIEWER update and exposes the result via /__test/markdown', async () => {
      await start(true)
      const doc = 'e2e-c/wiki-page:3'
      await post('/__test/seed', { docName: doc, body: '첫 문단', roles: { '2': 'VIEWER' } })
      const editor = connect(doc, 'uid=1&name=양동희')
      const viewer = connect(doc, 'uid=2&name=김철수')
      await synced(editor)
      await synced(viewer)
      expect(editor.provider.authorizedScope).toBe('read-write')
      expect(viewer.provider.authorizedScope).toBe('readonly')
      typeAt(viewer.doc, 0, '해킹 ')
      typeAt(editor.doc, 0, '정상 ')
      await expect.poll(() => yDocToMarkdown(viewer.doc)).toContain('정상 ')
      // 열린 문서는 메모리의 실시간 문서를 그대로 읽는다.
      await expect.poll(async () => (await markdown(doc)).json?.markdown).toBe('정상 첫 문단')
      // 모두 나가면 메모리 저장소에 저장되고 version 이 올라간다.
      editor.provider.destroy()
      viewer.provider.destroy()
      await expect.poll(() => app.hocuspocus.documents.has(doc), { timeout: 5000 }).toBe(false)
      const saved = await markdown(doc)
      expect(saved.json?.markdown).toBe('정상 첫 문단')
      expect(saved.json?.version).toBeGreaterThan(1)
    })

    it('rejects a token whose role is NONE (forbidden scenario)', async () => {
      await start(true)
      await post('/__test/seed', { docName: 'e2e-d/wiki-page:4', body: 'x' })
      const c = connect('e2e-d/wiki-page:4', 'uid=3&role=NONE')
      await expect.poll(() => c.authFailures).toContain('forbidden')
    })

    it('lets E2E trigger apply-markdown on a namespaced document with the default test internal token', async () => {
      await start(true)
      const doc = 'e2e-e/wiki-page:5'
      await post('/__test/seed', { docName: doc, body: '원래 본문' })
      const c = connect(doc, 'uid=1&name=양동희')
      await synced(c)
      const res = await post(
        '/internal/docs/5/apply-markdown',
        { tenantId: 1, mode: 'replace', body: 'AI 본문', actor: { userId: 1, name: '양동희' }, ai: true, docName: doc },
        { Authorization: `Internal ${TEST_MODE_INTERNAL_TOKEN}` },
      )
      expect(res.status).toBe(200)
      const out = (await res.json()) as { version: number; body: string }
      expect(out.body).toBe('AI 본문')
      await expect.poll(() => yDocToMarkdown(c.doc)).toBe('AI 본문')
      expect((await markdown(doc)).json?.version).toBe(out.version)
      // docName 의 페이지와 경로 pageId 가 다르면 거부.
      const mismatch = await post(
        '/internal/docs/6/apply-markdown',
        { tenantId: 1, mode: 'replace', body: 'x', actor: { userId: 1, name: '양동희' }, ai: true, docName: doc },
        { Authorization: `Internal ${TEST_MODE_INTERNAL_TOKEN}` },
      )
      expect(mismatch.status).toBe(400)
    })

    it('reset closes open documents of the namespace and forgets them, leaving other namespaces', async () => {
      await start(true)
      await post('/__test/seed', { docName: 'e2e-f/wiki-page:1', body: 'F' })
      await post('/__test/seed', { docName: 'e2e-g/wiki-page:1', body: 'G' })
      const f = connect('e2e-f/wiki-page:1', 'uid=1')
      const g = connect('e2e-g/wiki-page:1', 'uid=1')
      await synced(f)
      await synced(g)
      expect((await post('/__test/reset', { ns: 'e2e-f' })).status).toBe(204)
      expect(app.hocuspocus.documents.has('e2e-f/wiki-page:1')).toBe(false)
      expect((await markdown('e2e-f/wiki-page:1')).status).toBe(404)
      expect(app.hocuspocus.documents.has('e2e-g/wiki-page:1')).toBe(true)
      expect((await markdown('e2e-g/wiki-page:1')).json?.markdown).toBe('G')
    })

    it('changes the role of an open document without kicking clients, so revalidate can demote or revoke live', async () => {
      await start(true)
      const doc = 'e2e-h/wiki-page:7'
      const internal = { Authorization: `Internal ${TEST_MODE_INTERNAL_TOKEN}` }
      await post('/__test/seed', { docName: doc, body: '본문' })
      const c = connect(doc, 'uid=1')
      await synced(c)
      // 역할만 바꾼다 — 시드와 달리 문서를 닫지 않아 연결이 유지된다.
      expect((await post('/__test/role', { docName: doc, role: 'VIEWER' })).status).toBe(204)
      expect(c.disconnects).toEqual([])
      expect((await post('/internal/docs/revalidate', { tenantId: 1, pageIds: [7] }, internal)).status).toBe(204)
      await expect.poll(() => c.statelessMessages).toContain(JSON.stringify({ type: 'collab:role', role: 'VIEWER' }))
      // 접근 회수(NONE) → revalidate 가 4403 으로 닫는다.
      expect((await post('/__test/role', { docName: doc, role: 'NONE' })).status).toBe(204)
      expect((await post('/internal/docs/revalidate', { tenantId: 1, pageIds: [7] }, internal)).status).toBe(204)
      await expect.poll(() => c.disconnects.map((d) => d.code)).toContain(CLOSE_FORBIDDEN.code)
      // 시드 없는 문서는 404, 이름이 틀리면 400.
      expect((await post('/__test/role', { docName: 'e2e-h/wiki-page:8', role: 'VIEWER' })).status).toBe(404)
      expect((await post('/__test/role', { docName: 'bad', role: 'VIEWER' })).status).toBe(400)
    })

    it('rejects a seed with an invalid document name', async () => {
      await start(true)
      expect((await post('/__test/seed', { docName: 'a/b/wiki-page:1', body: 'x' })).status).toBe(400)
      expect((await post('/__test/seed', { docName: 'ns/wiki-page:1' })).status).toBe(400)
    })
  })
})
