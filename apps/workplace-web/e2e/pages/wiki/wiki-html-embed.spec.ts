// 노트 HTML 블록(WP-1242) — ```html-embed 블록의 스크립트가 격리 iframe 안에서 실제로 돌아 캔버스·DOM 을 그리고, iframe 높이가 내용에 맞춰지며,
// 그 스크립트가 앱 쿠키·저장소·부모 화면에 닿지 못하는지. 스크립트 실행·sandbox 격리·postMessage 높이는 jsdom 이 흉내 낼 수 없어 실제 브라우저로 본다(@platform).
// sandbox 속성·srcdoc·메시지 가리기·토글은 src/components/wiki/WikiHtmlEmbedView.test.tsx, 저장 형식 라운드트립은 공용 패키지 테스트가 지킨다.
// 격리 확인은 로그인·동기화 서버가 필요 없는 공개 공유 화면으로 띄운다 — 편집기·판 미리보기와 같은 확장(wikiRenderExtensions)을 쓴다.
// 소스 편집은 실제 편집기(동기화 테스트 서버)에서 단추를 누르고 contentEditable 소스 칸에 쳐 본다(@input — ProseMirror 가 단추 클릭을 가로채지 않는지).
// CDN 은 E2E 네트워크 격리로 닿지 않으므로 인라인 스크립트만 쓴다.
// 노트 끝 블록·모양 영역 밖으로 나가기(WP-1288)는 실제 클릭·키 입력이 숨은 소스 칸·선택을 어떻게 지나는지가 핵심이라 @input 으로 본다(상태 판정은 wikiBlockExit.test.ts).
import type { Locator, Page } from '@playwright/test'

import type { WikiPublicShare } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'
import { caretAtEnd, caretBeforeChar } from '../../fixtures/collab'
import { mockWikiPageEditor, openWikiEditor, savedMarkdown } from '../../fixtures/wiki-mock'

const TOKEN = 'wsh_e2eHtmlEmbed1'

/** 블록 통째 선택 표시 — ProseMirror 가 선택된 블록 화면(NodeView 바깥 요소, 블록 요소의 부모)에 붙이는 class. */
const SELECTED = /\bProseMirror-selectednode\b/
const nodeView = (block: Locator) => block.locator('xpath=..')
const API = `/api/v1/public/wiki/shares/${TOKEN}`
const PAGE_ID = 61

// 블록 소스 — 캔버스에 빨간 사각형을 그리고, 600px 높이 상자를 만들고, 앱 쿠키·저장소·부모 화면에 닿아 보고 결과를 글자로 남긴다.
const SOURCE = [
  '<canvas id="c" width="100" height="50"></canvas>',
  '<div id="tall" style="height:600px">높은 상자</div>',
  '<pre id="out"></pre>',
  '<script>',
  'function probe(fn){try{var v=fn();return "ok:"+String(v)}catch(e){return "blocked"}}',
  "var ctx=document.getElementById('c').getContext('2d');ctx.fillStyle='rgb(255,0,0)';ctx.fillRect(0,0,100,50);",
  "var px=ctx.getImageData(10,10,1,1).data;",
  "document.getElementById('out').textContent=[",
  "  'drawn='+px[0]+','+px[1]+','+px[2],",
  "  'cookie='+probe(function(){return document.cookie}),",
  "  'storage='+probe(function(){return localStorage.length}),",
  "  'parent='+probe(function(){return parent.document.title}),",
  "].join('\\n')",
  '</script>',
].join('\n')

const share: WikiPublicShare = {
  workspaceName: '아이에이클라우드',
  rootPageId: PAGE_ID,
  pages: [{ id: PAGE_ID, parentId: null, title: '차트 노트', position: 0 }],
  page: {
    id: PAGE_ID,
    title: '차트 노트',
    markdown: ['앞 문단', '', '```html-embed', SOURCE, '```', '', '뒤 문단'].join('\n'),
    updatedAt: '2026-10-31T01:00:00Z',
  },
}

test.describe('노트 HTML 블록 (WP-1242)', () => {
  test('블록 스크립트가 격리 iframe 안에서 그리고, 높이가 내용에 맞으며, 앱 쿠키·저장소·부모 화면에 닿지 못한다', { tag: '@platform' }, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.route((u) => u.pathname === API, (r) => r.fulfill({ json: share }))
    await page.goto(`/wiki/share/${TOKEN}`)
    // 앱 출처에 비밀 쿠키·저장값을 둔다 — 블록 스크립트가 읽을 수 있으면 안 된다.
    await page.evaluate(() => {
      document.cookie = 'wp_e2e_secret=1; path=/'
      localStorage.setItem('wp_e2e_secret', '1')
    })

    const view = page.getByTestId('wiki-public-share-page')
    const iframe = view.getByTestId('wiki-html-embed-frame')
    await expect(iframe).toBeVisible()
    const frame = page.frameLocator('[data-testid="wiki-html-embed-frame"]')

    // 스크립트가 돌았다 — 캔버스 픽셀이 빨갛고, DOM 에 결과를 썼다.
    const out = frame.locator('#out')
    await expect(out).toContainText('drawn=255,0,0')
    // 불투명 출처라 쿠키·저장소·부모 문서 접근은 막힌다.
    await expect(out).toContainText('cookie=blocked')
    await expect(out).toContainText('storage=blocked')
    await expect(out).toContainText('parent=blocked')
    await expect(frame.locator('#tall')).toHaveText('높은 상자')

    // 높이 — 기본 400px 에서 내용(600px 상자 + 캔버스·결과 글)에 맞춰 늘고, 상한(1200px) 아래다.
    await expect.poll(async () => (await iframe.boundingBox())?.height ?? 0).toBeGreaterThan(650)
    const box = (await iframe.boundingBox())!
    expect(box.height).toBeLessThan(1000)
    // 폭은 본문 폭을 다 쓴다.
    const bodyBox = (await view.locator('.ProseMirror').boundingBox())!
    expect(box.width).toBeGreaterThan(bodyBox.width * 0.9)

    // 앱 화면은 그대로 — 블록 스크립트가 부모 제목·쿠키를 바꾸지 못했다.
    expect(await page.evaluate(() => document.cookie)).toContain('wp_e2e_secret=1')
    await expect(view.getByText('뒤 문단')).toBeVisible()
    // 보기 전용 화면이라 소스 편집 단추는 없다.
    await expect(view.getByTestId('wiki-html-embed-toggle')).toHaveCount(0)
  })

  test('편집기에서 「소스 편집」을 눌러 소스를 고치면 미리보기가 잠시 뒤 바뀌고 저장된다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const spaceId = 1
    const pageId = 62
    const source = '<p id="v">one</p>'
    await mockWikiPageEditor(page, {
      spaceId,
      pageId,
      title: 'HTML 블록 편집',
      body: ['앞 문단', '', '```html-embed', source, '```'].join('\n'),
      role: 'EDITOR',
    })
    await openWikiEditor(page, { spaceId, pageId })

    const block = page.getByTestId('wiki-html-embed')
    const frame = page.frameLocator('[data-testid="wiki-html-embed-frame"]')
    await expect(frame.locator('#v')).toHaveText('one')
    // 처음엔 소스 칸이 닫혀 있다 — 미리보기만.
    const sourceBox = block.getByTestId('wiki-html-embed-source')
    await expect(sourceBox).toBeHidden()

    const toggle = block.getByTestId('wiki-html-embed-toggle')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(sourceBox).toBeVisible()
    await expect(sourceBox).toHaveText(source)

    // 소스 한 줄 끝에 이어 쓴다.
    await sourceBox.locator('code').click()
    await page.keyboard.press('End')
    await page.keyboard.insertText('<p id="w">two</p>')
    await expect(sourceBox).toHaveText(`${source}<p id="w">two</p>`)
    // 미리보기는 디바운스 뒤 새 소스로 다시 그린다.
    await expect(frame.locator('#w')).toHaveText('two')
    await expect(frame.locator('#v')).toHaveText('one')
    // 동기화 문서에도 html-embed 펜스로 저장된다.
    await expect.poll(() => savedMarkdown(page, pageId)).toContain(['```html-embed', `${source}<p id="w">two</p>`, '```'].join('\n'))

    // 다시 누르면 소스 칸이 닫히고 미리보기는 남는다 — 커서는 숨은 소스에 남지 않고 블록 통째 선택(테두리)이 된다(WP-1288).
    await toggle.click()
    await expect(sourceBox).toBeHidden()
    await expect(frame.locator('#w')).toHaveText('two')
    await expect(nodeView(block)).toHaveClass(SELECTED)
    // 통째 선택에서 친 글자는 블록을 지우지도, 숨은 소스에 들어가지도 않는다.
    await page.keyboard.insertText('!')
    await expect(sourceBox).toHaveText(`${source}<p id="w">two</p>`)
    // 노트 끝 블록이라도 Enter 로 다음 줄을 만들어 바로 쓴다.
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('다음 줄')
    await expect(page.locator('.ProseMirror > p').last()).toHaveText('다음 줄')
    await expect(nodeView(block)).not.toHaveClass(SELECTED)
    await expect.poll(() => savedMarkdown(page, pageId)).toContain(['```html-embed', `${source}<p id="w">two</p>`, '```', '', '다음 줄'].join('\n'))
  })

  /** HTML 블록 하나로 끝나는 노트를 편집기로 연다. */
  async function openEndingWithEmbed(page: Page, pageId: number) {
    await mockWikiPageEditor(page, {
      spaceId: 1,
      pageId,
      title: '끝 블록',
      body: ['앞 문단', '', '```html-embed', '<p id="v">one</p>', '```'].join('\n'),
      role: 'EDITOR',
    })
    await openWikiEditor(page, { spaceId: 1, pageId })
    await expect(page.frameLocator('[data-testid="wiki-html-embed-frame"]').locator('#v')).toHaveText('one')
    return page.getByTestId('wiki-html-embed')
  }

  test('노트 끝 HTML 블록 — 블록을 누르면 선택 테두리가 보이고 ↓ 로 다음 줄, ↑ 로 앞 줄에 간다(WP-1288)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const block = await openEndingWithEmbed(page, 63)
    // 닫힌 블록(머리 띠 이름표)을 누르면 숨은 소스에 커서가 들어가지 않고 블록이 선택돼 보인다.
    await block.getByText('HTML 블록', { exact: true }).click()
    await expect(nodeView(block)).toHaveClass(SELECTED)
    await expect(block.getByTestId('wiki-html-embed-source')).toBeHidden()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.insertText('아래로')
    await expect(page.locator('.ProseMirror > p').last()).toHaveText('아래로')
    await expect(nodeView(block)).not.toHaveClass(SELECTED)
    // ↑ 로 블록을 지나 앞 줄로 — 블록 선택을 거쳐 앞 문단 끝으로 간다. 캐럿은 상태에 바로 둔다(Home 의 DOM 선택은 늦게 읽힌다 — caretBeforeChar).
    await caretBeforeChar(page, '아래로', 0)
    await page.keyboard.press('ArrowUp')
    await expect(nodeView(block)).toHaveClass(SELECTED)
    await page.keyboard.press('ArrowUp')
    await page.keyboard.insertText('!')
    await expect(page.locator('.ProseMirror > p').first()).toHaveText('앞 문단!')
    await expect.poll(() => savedMarkdown(page, 63)).toContain(['앞 문단!', '', '```html-embed', '<p id="v">one</p>', '```', '', '아래로'].join('\n'))
  })

  test('미리보기를 누르면 블록이 선택돼 보이고, 미리보기 안 입력칸은 키를 그대로 받는다(WP-1288)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await mockWikiPageEditor(page, {
      spaceId: 1,
      pageId: 64,
      title: '입력칸 블록',
      body: ['앞 문단', '', '```html-embed', '<input id="q">', '```'].join('\n'),
      role: 'EDITOR',
    })
    await openWikiEditor(page, { spaceId: 1, pageId: 64 })
    const block = page.getByTestId('wiki-html-embed')
    const input = page.frameLocator('[data-testid="wiki-html-embed-frame"]').locator('#q')
    await input.click()
    await expect(nodeView(block)).toHaveClass(SELECTED)
    // 포커스는 iframe 에 남는다 — 친 글자·Enter 가 편집기(새 줄)로 가지 않고 입력칸에 들어간다.
    await page.keyboard.type('abc')
    await page.keyboard.press('Enter')
    await expect(input).toHaveValue('abc')
    await expect(page.locator('.ProseMirror > p')).toHaveCount(1)
  })

  test('통째 선택된 블록에서 글자를 치면 블록은 그대로 두고 다음 줄에 들어간다(WP-1288)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const block = await openEndingWithEmbed(page, 67)
    await block.getByText('HTML 블록', { exact: true }).click()
    await expect(nodeView(block)).toHaveClass(SELECTED)
    await page.keyboard.type('ab')
    await expect(page.locator('.ProseMirror > p').last()).toHaveText('ab')
    await expect(block).toBeVisible()
    await expect.poll(() => savedMarkdown(page, 67)).toContain(['```html-embed', '<p id="v">one</p>', '```', '', 'ab'].join('\n'))
  })

  test('노트 끝 HTML 블록 — 블록 아래 빈자리를 누르면 그 자리에 다음 줄이 생긴다(WP-1288)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const block = await openEndingWithEmbed(page, 65)
    const box = (await block.boundingBox())!
    await page.mouse.click(box.x + 40, box.y + box.height + 20)
    await page.keyboard.insertText('빈자리')
    await expect(page.locator('.ProseMirror > p').last()).toHaveText('빈자리')
    await expect.poll(() => savedMarkdown(page, 65)).toContain(['```', '', '빈자리'].join('\n'))
  })

  test('노트 끝 모양 영역 — 마지막 줄 ↓ 와 끝 빈 줄 Enter 로 영역 밖 다음 줄로 나간다(WP-1288)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const pageId = 66
    await mockWikiPageEditor(page, {
      spaceId: 1,
      pageId,
      title: '카드 노트',
      body: ['<div class="card" style="padding:8px">', '', '카드 글', '', '</div>'].join('\n'),
      role: 'EDITOR',
    })
    await openWikiEditor(page, { spaceId: 1, pageId })
    const card = page.locator('.ProseMirror [data-wiki-html-box]')
    await expect(card).toContainText('카드 글')

    // 노트 끝 카드의 마지막 줄 끝에서 ↓ → 카드 밖에 새 줄. 캐럿은 상태에 바로 둔다(누름·End 의 DOM 선택은 늦게 읽힌다 — caretAtEnd).
    await caretAtEnd(page, '카드 글')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.insertText('아래 글')
    await expect(page.locator('.ProseMirror > p').last()).toHaveText('아래 글')
    await expect(card).not.toContainText('아래 글')

    // 카드 글 끝에서 Enter → 카드 안 빈 줄, 한 번 더 Enter → 빈 줄을 빼고 카드 밖 다음 줄(이미 있는 「아래 글」 처음)로.
    await caretAtEnd(page, '카드 글')
    await page.keyboard.press('Enter')
    await expect(card.locator('p')).toHaveCount(2)
    await page.keyboard.press('Enter')
    await expect(card.locator('p')).toHaveCount(1)
    await page.keyboard.insertText('밖 ')
    await expect(page.locator('.ProseMirror > p').last()).toHaveText('밖 아래 글')
    await expect.poll(() => savedMarkdown(page, pageId)).toMatch(/카드 글\n\n<\/div>\n\n밖 아래 글/)
  })
})
