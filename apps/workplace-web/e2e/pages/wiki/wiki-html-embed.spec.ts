// 노트 HTML 블록(WP-1242) — ```html-embed 블록의 스크립트가 격리 iframe 안에서 실제로 돌아 캔버스·DOM 을 그리고, iframe 높이가 내용에 맞춰지며,
// 그 스크립트가 앱 쿠키·저장소·부모 화면에 닿지 못하는지. 스크립트 실행·sandbox 격리·postMessage 높이는 jsdom 이 흉내 낼 수 없어 실제 브라우저로 본다(@platform).
// sandbox 속성·srcdoc·메시지 가리기·토글은 src/components/wiki/WikiHtmlEmbedView.test.tsx, 저장 형식 라운드트립은 공용 패키지 테스트가 지킨다.
// 격리 확인은 로그인·동기화 서버가 필요 없는 공개 공유 화면으로 띄운다 — 편집기·판 미리보기와 같은 확장(wikiRenderExtensions)을 쓴다.
// 소스 편집은 실제 편집기(동기화 테스트 서버)에서 단추를 누르고 contentEditable 소스 칸에 쳐 본다(@input — ProseMirror 가 단추 클릭을 가로채지 않는지).
// CDN 은 E2E 네트워크 격리로 닿지 않으므로 인라인 스크립트만 쓴다.
// 막대·소스 편집 개선(WP-1300) — 나란히 놓인 코드·미리보기(@layout), 소스 칸에서의 Esc·Enter·글자 입력과 「다시 올리기」 파일 끌어다 놓기(@input).
// 막대 단추 표시·Esc 상태 판정·소스 바꾸기 범위·5MB 거르기는 WikiHtmlEmbedView.test.tsx 가 지킨다.
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

  test.describe('막대·소스 편집 개선 (WP-1300)', () => {
    /** 앞 문단 + HTML 블록 + 뒤 문단 노트를 편집기로 연다. */
    async function openWithEmbed(page: Page, pageId: number, source = '<p id="v">one</p>') {
      await mockWikiPageEditor(page, {
        spaceId: 1,
        pageId,
        title: '막대 블록',
        body: ['앞 문단', '', '```html-embed', source, '```', '', '뒤 문단'].join('\n'),
        role: 'EDITOR',
      })
      await openWikiEditor(page, { spaceId: 1, pageId })
      await expect(page.frameLocator('[data-testid="wiki-html-embed-frame"]').locator('#v')).toHaveText('one')
      return page.getByTestId('wiki-html-embed')
    }

    test('소스 편집에서 코드를 고치면 오른쪽 미리보기가 다시 그려지고, Esc 로 닫으면 블록 선택 → Enter 로 다음 줄에 쓴다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      const block = await openWithEmbed(page, 71)
      const frame = page.frameLocator('[data-testid="wiki-html-embed-frame"]')
      await block.getByTestId('wiki-html-embed-toggle').click()
      await expect(block.getByTestId('wiki-html-embed-toggle')).toHaveText('완료')
      const code = block.getByTestId('wiki-html-embed-source').locator('code')
      await expect(code).toBeVisible()
      // 색 구분 — 태그·속성 이름·값이 칠해진다(노드 글자는 그대로).
      await expect(code.locator('.wiki-html-tok--attr')).toHaveText('id')
      // 끝에 한 줄 더 — 소스 안 Enter 는 코드 줄바꿈이다(블록 밖으로 나가지 않는다).
      await code.click()
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await page.keyboard.insertText('<p id="w">two</p>')
      await expect(block.getByTestId('wiki-html-embed-source')).toHaveText('<p id="v">one</p>\n<p id="w">two</p>')
      await expect(block.locator('.wiki-html-embed__gutter')).toHaveText('1\n2')
      await expect(frame.locator('#w')).toHaveText('two')

      // Esc — 소스 칸이 닫히고 블록 통째 선택(테두리) + 키 안내.
      await page.keyboard.press('Escape')
      await expect(block.getByTestId('wiki-html-embed-source')).toBeHidden()
      await expect(nodeView(block)).toHaveClass(SELECTED)
      await expect(block.getByTestId('wiki-html-embed-hint')).toContainText('Enter 다음 줄 · Esc 바깥으로')
      // Enter — 다음 줄(이미 있는 「뒤 문단」 처음)에서 바로 입력.
      await page.keyboard.press('Enter')
      await page.keyboard.insertText('이어서 ')
      await expect(page.locator('.ProseMirror > p').last()).toHaveText('이어서 뒤 문단')
      await expect(nodeView(block)).not.toHaveClass(SELECTED)
      await expect
        .poll(() => savedMarkdown(page, 71))
        .toContain(['```html-embed', '<p id="v">one</p>', '<p id="w">two</p>', '```', '', '이어서 뒤 문단'].join('\n'))
    })

    test('「다시 올리기」에 HTML 파일을 끌어다 놓고 「바꾸기」를 누르면 이 블록 소스만 바뀐다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
      const block = await openWithEmbed(page, 72)
      // 이름표를 눌러 블록을 고르면 막대에 다시 올리기가 보인다.
      await block.getByTestId('wiki-html-embed-label').click()
      await expect(nodeView(block)).toHaveClass(SELECTED)
      await block.getByTestId('wiki-html-embed-reupload').click()
      const dialog = page.getByTestId('wiki-html-embed-reupload-dialog')
      await expect(dialog).toBeVisible()
      const next = '<p id="v">new</p>'
      const dataTransfer = await page.evaluateHandle((src) => {
        const dt = new DataTransfer()
        dt.items.add(new File([src], 'chart.html', { type: 'text/html' }))
        return dt
      }, next)
      await dialog.getByTestId('wiki-html-embed-dropzone').dispatchEvent('drop', { dataTransfer })
      await expect(dialog.getByTestId('wiki-html-embed-reupload-text')).toHaveValue(next)
      await dialog.getByTestId('wiki-html-embed-reupload-apply').click()
      await expect(dialog).toBeHidden()
      await expect(page.frameLocator('[data-testid="wiki-html-embed-frame"]').locator('#v')).toHaveText('new')
      await expect.poll(() => savedMarkdown(page, 72)).toContain(['앞 문단', '', '```html-embed', next, '```', '', '뒤 문단'].join('\n'))
    })

    test('소스 편집은 넓은 블록에서 코드 왼쪽·미리보기 오른쪽으로 나란히, 좁은 블록에서는 위아래로 놓인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width: 1400, height: 900 })
      const block = await openWithEmbed(page, 73)
      await block.getByTestId('wiki-html-embed-toggle').click()
      const code = block.getByTestId('wiki-html-embed-code')
      const preview = block.getByTestId('wiki-html-embed-preview')
      await expect(code).toBeVisible()
      const wide = async () => {
        const c = (await code.boundingBox())!
        const p = (await preview.boundingBox())!
        return { c, p }
      }
      await expect.poll(async () => {
        const { c, p } = await wide()
        // 나란히 — 코드 오른쪽 끝이 미리보기 왼쪽보다 왼쪽이고 위쪽이 같다.
        return c.x + c.width <= p.x && Math.abs(c.y - p.y) < 2
      }).toBe(true)
      const { c: wc, p: wp } = await wide()
      // 둘이 블록 폭을 반씩 나눈다.
      expect(Math.abs(wc.width - wp.width)).toBeLessThan(4)
      // 줄 번호 칸과 소스가 같은 줄 높이 — 높이가 같아야 줄 번호가 줄과 맞는다(pre 의 본문 줄 높이가 code 줄을 벌리던 것).
      const gutterBox = (await block.locator('.wiki-html-embed__gutter').boundingBox())!
      const preBox = (await block.getByTestId('wiki-html-embed-source').boundingBox())!
      expect(Math.abs(gutterBox.height - preBox.height)).toBeLessThan(2)

      // 좁은 화면(블록 폭 640px 아래) — 미리보기가 코드 아래로 내려간다.
      await page.setViewportSize({ width: 560, height: 900 })
      // 좁은 화면은 모바일 셸로 편집기를 다시 띄워 소스 칸 열림(이 화면 상태)이 풀릴 수 있다 — 닫혀 있으면 다시 연다.
      const toggle = block.getByTestId('wiki-html-embed-toggle')
      await expect(async () => {
        if ((await toggle.textContent()) === '소스 편집') await toggle.click()
        await expect(code).toBeVisible({ timeout: 1000 })
      }).toPass()
      await expect.poll(async () => {
        const { c, p } = await wide()
        return p.y >= c.y + c.height && Math.abs(c.x - p.x) < 2
      }).toBe(true)
      // 긴 줄은 접지 않고 코드 칸 안에서 가로로 스크롤한다 — 줄 번호와 줄이 어긋나지 않게.
      const pre = block.getByTestId('wiki-html-embed-source')
      expect(await pre.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('pre')
    })
  })
})
