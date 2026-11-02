// 노트 「HTML 문서」 페이지(WP-1307) — 라우트 → 페이지 조회(kind HTML) → 격리 iframe 이 실제 브라우저에서 이어지는지(@wiring).
// 편집 잠금(WP-1308) — 두 창(두 사람)에서 A 가 편집하면 B 화면에 「편집 중」 띠가 SSE 로 바로 뜨고, A 가 저장하면 띠가 사라져 B 가 편집할 수 있다(@flow).
// 보기/편집/소스 권한·저장 payload·409·잠금 띠·이어 고치기·잠금 풀기·내려받기 형식·버전 미리보기는
// src/components/wiki/html-document/WikiHtmlDocumentView.test.tsx 가 지킨다.
import type { Page } from '@playwright/test'

import type { WikiHtmlLockStatus } from '../../../src/types/wiki'
import { wikiHtmlLock, wikiHtmlPageDetail, wikiPageSummary, wikiSpace } from '../../factories/wiki.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { pushHeldEvents } from '../../fixtures/gatedEvents'

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

test('HTML 문서 주소를 열면 원본이 스크립트까지 격리 iframe 에서 돌고, sandbox 에 allow-same-origin 이 없다', { tag: ['@wiring', '@smoke'] }, async ({
  authenticatedPage: page,
}) => {
  const detail = wikiHtmlPageDetail({
    id: 9,
    html: '<!doctype html><html><body><h1 id="t">매출 차트</h1><script>document.getElementById("t").textContent = "스크립트 실행됨"</script></body></html>',
  })
  await page.route('**/api/v1/wiki/spaces', (r) => r.fulfill(json([wikiSpace({ id: 1, name: '팀 노트', role: 'OWNER' })])))
  await page.route('**/api/v1/wiki/spaces/1/pages', (r) => r.fulfill(json([wikiPageSummary({ id: 9, title: detail.title, kind: 'HTML' })])))
  await page.route('**/api/v1/wiki/pages/9?*', (r) => r.fulfill(json(detail)))
  await page.route('**/api/v1/wiki/pages/9/html-lock', (r) => r.fulfill(json(wikiHtmlLock())))

  await page.goto('/wiki/spaces/1/pages/9')
  const frame = page.getByTestId('wiki-html-frame')
  await expect(frame).toBeVisible()
  // 스크립트가 돈 결과가 iframe 안에 보인다.
  await expect(frame.contentFrame().locator('#t')).toHaveText('스크립트 실행됨')
  await expect(frame).toHaveAttribute('sandbox', /(^|\s)allow-scripts(\s|$)/)
  await expect(frame).not.toHaveAttribute('sandbox', /allow-same-origin/)
  // 트리 행에 HTML 표시가 붙는다.
  await expect(page.getByTestId('wiki-tree-html-badge-9')).toHaveText(/HTML/)
})

/** 두 사람이 함께 보는 서버 흉내 — 원본·version·잠금 쥔 사람. 바뀌면 다른 창에 SSE(wiki.page.lock·wiki.page.updated)를 밀어 넣는다. */
type Person = { id: number; name: string; page: Page }

test('A 가 편집하면 B 화면에 「편집 중」 띠가 바로 뜨고 편집이 막히며, A 가 저장하면 띠가 사라지고 B 가 새 원본으로 편집할 수 있다', { tag: '@flow' }, async ({
  authenticatedPage: aPage,
  newAuthedPage,
}) => {
  const KIM = { id: 2, name: '김민지' }
  const bPage = await newAuthedPage({ user: KIM })
  const people: Person[] = [
    { id: 1, name: '테스트 사용자', page: aPage },
    { id: KIM.id, name: KIM.name, page: bPage },
  ]
  const server = { html: '<!doctype html><html><body><h1>처음 원본</h1></body></html>', version: 3, holder: null as Person | null }
  const statusFor = (me: Person): WikiHtmlLockStatus =>
    server.holder
      ? wikiHtmlLock({ locked: true, mine: server.holder.id === me.id, holderId: server.holder.id, holderName: server.holder.name })
      : wikiHtmlLock()
  // 잠금 이벤트는 바뀐 뒤의 잠금(쥔 사람)을 싣는다 — 받는 화면이 다시 받지 않고 띠를 바꾼다(서버 WikiSseDispatcher.onHtmlLockChanged).
  const frame = (event: string) => {
    const held = server.holder
    const lock =
      event === 'wiki.page.lock'
        ? held
          ? { locked: true, holderId: held.id, holderName: held.name, acquiredAt: '2026-11-02T09:00:00Z', expiresAt: '2026-11-02T09:10:00Z' }
          : { locked: false, holderId: null, holderName: null, acquiredAt: null, expiresAt: null }
        : {}
    return `event: ${event}\ndata: ${JSON.stringify({ spaceId: 1, pageId: 9, actorId: 0, ...lock })}\n\n`
  }
  /** 다른 창들에 이벤트를 보낸다(서버 WikiSseDispatcher 처럼). */
  const notifyOthers = async (me: Person, ...events: string[]) => {
    for (const other of people.filter((p) => p !== me)) {
      for (const e of events) await pushHeldEvents(other.page, frame(e))
    }
  }

  for (const me of people) {
    const p = me.page
    await p.route('**/api/v1/wiki/spaces', (r) => r.fulfill(json([wikiSpace({ id: 1, name: '팀 노트', role: 'EDITOR' })])))
    await p.route('**/api/v1/wiki/spaces/1/pages', (r) => r.fulfill(json([wikiPageSummary({ id: 9, title: '분기 대시보드', kind: 'HTML' })])))
    await p.route((u) => u.pathname === '/api/v1/wiki/pages/9', (r) =>
      r.fulfill(json(wikiHtmlPageDetail({ id: 9, html: server.html, version: server.version }))))
    await p.route((u) => u.pathname === '/api/v1/wiki/pages/9/html-lock', async (r) => {
      const method = r.request().method()
      if (method === 'GET') return r.fulfill(json(statusFor(me)))
      if (method === 'POST') {
        if (server.holder && server.holder.id !== me.id) {
          return r.fulfill({ status: 409, json: { status: 409, message: `${server.holder.name} 님이 편집 중입니다`, errors: { code: 'HTML_LOCKED', holderName: server.holder.name } } })
        }
        server.holder = me
        await r.fulfill(json({ token: `tok-${me.id}`, lock: statusFor(me), draft: null }))
        return notifyOthers(me, 'wiki.page.lock')
      }
      if (method === 'PUT') return r.fulfill(json(statusFor(me)))
      if (server.holder?.id === me.id) server.holder = null
      await r.fulfill({ status: 204, body: '' })
      return notifyOthers(me, 'wiki.page.lock')
    })
    await p.route((u) => u.pathname === '/api/v1/wiki/pages/9/html', async (r) => {
      const body = r.request().postDataJSON() as { html: string; version: number; lockToken?: string }
      // 편집 「저장」은 이 세션 표지를 싣는다 — 없거나 다르면 누가 편집 중일 때 막힌다(서버와 같다).
      if (server.holder && body.lockToken !== `tok-${server.holder.id}`) {
        return r.fulfill({ status: 409, json: { status: 409, message: `${server.holder.name} 님이 편집 중입니다`, errors: { code: 'HTML_LOCKED' } } })
      }
      server.html = body.html
      server.version += 1
      server.holder = null // 저장이 잠금을 푼다.
      await r.fulfill(json(wikiHtmlPageDetail({ id: 9, html: server.html, version: server.version })))
      return notifyOthers(me, 'wiki.page.lock', 'wiki.page.updated')
    })
  }

  await aPage.goto('/wiki/spaces/1/pages/9')
  await bPage.goto('/wiki/spaces/1/pages/9')
  await expect(bPage.getByTestId('wiki-html-frame')).toBeVisible()
  await expect(bPage.getByTestId('wiki-html-mode-edit')).toBeEnabled()

  // A 가 편집을 시작한다 → B 화면에 띠, 편집·다시 올리기가 막힌다.
  await aPage.getByTestId('wiki-html-mode-edit').click()
  const source = aPage.getByTestId('wiki-html-source')
  await expect(source).toHaveValue(/처음 원본/)
  await expect(bPage.getByTestId('wiki-html-lock-banner')).toHaveText(/테스트 사용자 님이 편집 중입니다 — 저장될 때까지 보기만 할 수 있어요/)
  await expect(bPage.getByTestId('wiki-html-mode-edit')).toBeDisabled()
  await expect(bPage.getByTestId('wiki-html-reupload')).toBeDisabled()

  // A 가 고쳐 저장한다 → B 띠가 사라지고 새 원본이 보인다.
  await source.fill('<!doctype html><html><body><h1>A 가 고친 원본</h1></body></html>')
  await aPage.getByTestId('wiki-html-source-save').click()
  await expect(aPage.getByTestId('wiki-html-frame')).toBeVisible()
  await expect(bPage.getByTestId('wiki-html-lock-banner')).toBeHidden()
  await expect(bPage.getByTestId('wiki-html-frame').contentFrame().locator('h1')).toHaveText('A 가 고친 원본')

  // 이제 B 가 편집할 수 있고, A 화면에 B 의 띠가 뜬다.
  await bPage.getByTestId('wiki-html-mode-edit').click()
  await expect(bPage.getByTestId('wiki-html-source')).toHaveValue(/A 가 고친 원본/)
  await expect(aPage.getByTestId('wiki-html-lock-banner')).toHaveText(/김민지 님이 편집 중입니다/)
})
