// 노트 「HTML 문서」 페이지(WP-1307) — 라우트 → 페이지 조회(kind HTML) → 격리 iframe 이 실제 브라우저에서 이어지는지(@wiring).
// 편집 잠금(WP-1308) — 두 창(두 사람)에서 A 가 편집하면 B 화면에 「편집 중」 띠가 SSE 로 바로 뜨고, A 가 저장하면 띠가 사라져 B 가 편집할 수 있다(@flow).
// 보이는 화면 편집(WP-1309) — 글자를 눌러 고치고 서식·붙여넣기·Enter 새 문단을 넣어 저장하면 고친 글자만 원본에 들어간다(@input).
// 떠 있는 서식 도구가 고치는 글자와 바로 위 이름표를 가리지 않는다(@layout — 자리 고르기 자체는 htmlTextEdit.test 의 wpBarPos).
// 보기/편집/소스 권한·저장 payload·409·잠금 띠·이어 고치기·잠금 풀기·내려받기 형식·버전 미리보기는
// src/components/wiki/html-document/WikiHtmlDocumentView.test.tsx 가 지킨다.
import type { Page } from '@playwright/test'

import type { WikiHtmlLockStatus } from '../../../src/types/wiki'
import { wikiHtmlLock, wikiHtmlPageDetail, wikiPageSummary, wikiSpace } from '../../factories/wiki.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { pushHeldEvents } from '../../fixtures/gatedEvents'
import { mockHtmlScriptsCheck, turnOnNoteScripts } from '../../fixtures/wiki-mock'

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

test('HTML 문서 주소를 열면 원본이 멈춘 채 격리 iframe 에 그려지고, 스크립트 스위치를 켜면 스크립트까지 돌며, sandbox 에 allow-same-origin 이 없다', { tag: ['@wiring', '@smoke'] }, async ({
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
  // 스크립트가 든 문서는 본문 위 줄이 노트 스크립트 점검을 조회한다(WP-1290) — 목이 없으면 503 이라 「점검 행 없음」으로 답한다.
  await mockHtmlScriptsCheck(page)

  await page.goto('/wiki/spaces/1/pages/9')
  const frame = page.getByTestId('wiki-html-frame')
  await expect(frame).toBeVisible()
  // 스크립트가 든 문서는 멈춘 채 그려진다(WP-1290) — sandbox 에 allow-scripts 가 없고, 스위치를 켜야 돈다.
  await expect(frame).not.toHaveAttribute('sandbox', /(^|\s)allow-scripts(\s|$)/)
  await turnOnNoteScripts(page)
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
  // 「편집」은 보이는 화면 편집부터(WP-1309) — 소스로 고치려면 「소스」로 옮긴다.
  await expect(aPage.getByTestId('wiki-html-visual-frame')).toBeVisible()
  await aPage.getByTestId('wiki-html-mode-source').click()
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
  await expect(bPage.getByTestId('wiki-html-visual-frame').contentFrame().locator('h1')).toHaveText('A 가 고친 원본')
  await expect(aPage.getByTestId('wiki-html-lock-banner')).toHaveText(/김민지 님이 편집 중입니다/)
})

// 보이는 화면 편집(WP-1309) — iframe 안 글자 고치기 스크립트가 실제 마우스·키·붙여넣기를 받는지(@input).
// 되돌리기(직렬화)·정리기는 src/lib/htmlTextEditSource.test.ts, 메시지·저장 배선은 WikiHtmlDocumentView.test.tsx 가 지킨다.
test('「편집」에서 글자를 눌러 고치고, 서식 도구로 굵게·붙여넣기·Enter 새 문단을 넣어 저장하면 원본에는 고친 글자만 들어간다', { tag: ['@input', '@layout'] }, async ({
  authenticatedPage: page,
}) => {
  const html = [
    '<!doctype html><html><head><title>회고</title><style>.card{border:1px solid #ccc;padding:8px}</style></head><body>',
    '<h1 id="t">3분기 회고</h1><p id="p">출시 요약</p><div class="card"><div class="label" id="l">출시</div><div class="v" id="v">4건</div></div><div id="chart"></div>',
    `<script>document.getElementById('chart').innerHTML='<span id="rt">스크립트가 그림</span>'</script>`,
    '</body></html>',
  ].join('')
  const saves: string[] = []
  const lock = wikiHtmlLock({ locked: true, mine: true, holderId: 1, holderName: '테스트 사용자' })
  await page.route('**/api/v1/wiki/spaces', (r) => r.fulfill(json([wikiSpace({ id: 1, name: '팀 노트', role: 'EDITOR' })])))
  await page.route('**/api/v1/wiki/spaces/1/pages', (r) => r.fulfill(json([wikiPageSummary({ id: 9, title: '회고', kind: 'HTML' })])))
  await page.route((u) => u.pathname === '/api/v1/wiki/pages/9', (r) => r.fulfill(json(wikiHtmlPageDetail({ id: 9, title: '회고', html, version: 3 }))))
  await page.route((u) => u.pathname === '/api/v1/wiki/pages/9/html-lock', (r) => {
    const method = r.request().method()
    if (method === 'POST') return r.fulfill(json({ token: 'tok-1', lock, draft: null }))
    if (method === 'DELETE') return r.fulfill({ status: 204, body: '' })
    return r.fulfill(json(method === 'PUT' ? lock : wikiHtmlLock()))
  })
  await page.route((u) => u.pathname === '/api/v1/wiki/pages/9/html', (r) => {
    const body = r.request().postDataJSON() as { html: string }
    saves.push(body.html)
    return r.fulfill(json(wikiHtmlPageDetail({ id: 9, title: '회고', html: body.html, version: 4 })))
  })
  await mockHtmlScriptsCheck(page)

  await page.goto('/wiki/spaces/1/pages/9')
  // 스크립트를 켠 채 편집한다(WP-1290) — 스크립트가 그린 런타임 DOM 이 원본에 섞이지 않는지 본다(멈춘 채 편집은 우리 스크립트만 — 블록 E2E 가 본다).
  await turnOnNoteScripts(page)
  await page.getByTestId('wiki-html-mode-edit').click()
  const frame = page.frameLocator('[data-testid="wiki-html-visual-frame"]')
  await expect(frame.locator('#rt')).toHaveText('스크립트가 그림')
  const boxes = frame.locator('[data-wp-html-edit-layer] > div')

  // 올리면 고칠 수 있는 곳에 점선 — 스크립트가 그린 곳에는 없다.
  await frame.locator('#t').hover()
  await expect(boxes).toHaveCount(1)
  await frame.locator('#rt').hover()
  await expect(boxes).toHaveCount(0)
  await frame.locator('#rt').click()
  await expect(frame.locator('#rt')).not.toHaveAttribute('contenteditable', 'true')

  // 제목을 눌러 그 자리에서 고친다 — 떠 있는 서식 도구가 뜨고, 고른 글자를 「기울임」(제목은 이미 굵어 굵게는 문단에서 본다).
  await frame.locator('#t').click()
  await expect(frame.locator('#t')).toHaveAttribute('contenteditable', 'true')
  await expect(frame.locator('[data-wp-html-edit-bar]')).toBeVisible()
  await page.keyboard.press('End')
  await page.keyboard.type(' (최종)')
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft')
  await frame.getByRole('button', { name: '기울임' }).click()
  await expect(frame.locator('#t')).toHaveText('3분기 회고 (최종)')
  await expect(frame.locator('#t i')).toHaveText('(최종)')
  // 이미 굵은 제목에서 고른 글자를 「굵게」 — 굵게가 꺼져 보통 굵기로 보이고, 저장하면 그대로 남는다(보이는 대로 저장).
  await page.keyboard.press('Home')
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight')
  await frame.getByRole('button', { name: '굵게' }).click()
  await expect(frame.locator('#t span')).toHaveText('3분기')
  await expect(frame.locator('#t span')).toHaveCSS('font-weight', '400')

  // 카드 숫자에 웹에서 복사한 모양을 붙인다 — 글자색·굵게는 남고 스크립트는 걸러진다.
  await frame.locator('#v').click()
  // 서식 도구는 고치는 숫자도, 바로 위 이름표 글자도 가리지 않는다(라이브 검증에서 이름표가 가려졌다).
  const bar = frame.locator('[data-wp-html-edit-bar]')
  await expect(bar).toBeVisible()
  const rects = await frame.locator('body').evaluate(() => {
    const text = (sel: string) => {
      const r = document.createRange()
      r.selectNodeContents(document.querySelector(sel)!)
      const b = r.getBoundingClientRect()
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }
    }
    const b = document.querySelector('[data-wp-html-edit-bar]')!.getBoundingClientRect()
    return { bar: { left: b.left, top: b.top, right: b.right, bottom: b.bottom }, value: text('#v'), label: text('#l'), vw: innerWidth }
  })
  const hit = (a: typeof rects.bar, b: typeof rects.bar) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  expect(hit(rects.bar, rects.value)).toBe(false)
  expect(hit(rects.bar, rects.label)).toBe(false)
  expect(rects.bar.left).toBeGreaterThanOrEqual(0)
  expect(rects.bar.right).toBeLessThanOrEqual(rects.vw)
  await page.keyboard.press('ControlOrMeta+a')
  await frame.locator('#v').evaluate((el) => {
    const dt = new DataTransfer()
    dt.setData('text/html', '<span style="color:#dc2626;font-weight:700;font-family:Arial">5건</span><script>parent.x=1</script>')
    dt.setData('text/plain', '5건')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  await expect(frame.locator('#v')).toHaveText('5건')
  await expect(frame.locator('#v b span')).toHaveCSS('color', 'rgb(220, 38, 38)')

  // 문단 끝 글자를 「굵게」, 그리고 Enter — 뒤에 새 문단이 생겨 이어 쓴다.
  await frame.locator('#p').click()
  await page.keyboard.press('End')
  for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowLeft')
  await frame.getByRole('button', { name: '굵게' }).click()
  await expect(frame.locator('#p b')).toHaveText('요약')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('새 문단')
  await expect(frame.locator('#p + p')).toHaveText('새 문단')

  await page.getByTestId('wiki-html-source-save').click()
  await expect.poll(() => saves.length).toBe(1)
  const saved = saves[0]
  expect(saved).toContain('<h1 id="t"><span style="font-weight: normal">3분기</span> 회고 <i>(최종)</i></h1>')
  expect(saved).toContain('<p id="p">출시 <b>요약</b></p><p>새 문단</p>')
  expect(saved).toContain('<div class="label" id="l">출시</div><div class="v" id="v"><b><span style="color: #dc2626">5건</span></b></div>')
  // 스크립트가 그린 DOM·편집 표지는 원본에 들어가지 않고, 스크립트·스타일은 그대로다.
  expect(saved).toContain('<div id="chart"></div>')
  expect(saved).not.toMatch(/스크립트가 그림<\/span><\/div>|data-wp-|contenteditable|parent\.x/)
  expect(saved).toContain(`document.getElementById('chart').innerHTML='<span id="rt">스크립트가 그림</span>'`)
  expect(saved.startsWith('<!doctype html><html><head><title>회고</title><style>.card{border:1px solid #ccc;padding:8px}</style></head>')).toBe(true)
  // 저장하면 보기로 돌아와 고친 원본이 보인다 — 내용이 바뀌어 스크립트는 다시 멈추고(WP-1290), 켜면 고친 원본이 스크립트까지 돈다.
  await expect(page.frameLocator('[data-testid="wiki-html-frame"]').locator('#t')).toHaveText('3분기 회고 (최종)')
  await turnOnNoteScripts(page)
  await expect(page.frameLocator('[data-testid="wiki-html-frame"]').locator('#rt')).toHaveText('스크립트가 그림')
})
