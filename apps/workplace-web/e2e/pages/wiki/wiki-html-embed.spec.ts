// 노트 HTML 블록(WP-1242) — ```html-embed 블록의 스크립트가 격리 iframe 안에서 실제로 돌아 캔버스·DOM 을 그리고, iframe 높이가 내용에 맞춰지며,
// 그 스크립트가 앱 쿠키·저장소·부모 화면에 닿지 못하는지. 스크립트 실행·sandbox 격리·postMessage 높이는 jsdom 이 흉내 낼 수 없어 실제 브라우저로 본다(@platform).
// sandbox 속성·srcdoc·메시지 가리기·토글은 src/components/wiki/WikiHtmlEmbedView.test.tsx, 저장 형식 라운드트립은 공용 패키지 테스트가 지킨다.
// 격리 확인은 로그인·동기화 서버가 필요 없는 공개 공유 화면으로 띄운다 — 편집기·판 미리보기와 같은 확장(wikiRenderExtensions)을 쓴다.
// 소스 편집은 실제 편집기(동기화 테스트 서버)에서 단추를 누르고 contentEditable 소스 칸에 쳐 본다(@input — ProseMirror 가 단추 클릭을 가로채지 않는지).
// CDN 은 E2E 네트워크 격리로 닿지 않으므로 인라인 스크립트만 쓴다.
import type { WikiPublicShare } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockWikiPageEditor, openWikiEditor, savedMarkdown } from '../../fixtures/wiki-mock'

const TOKEN = 'wsh_e2eHtmlEmbed1'
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

    // 다시 누르면 소스 칸이 닫히고 미리보기는 남는다 — 커서는 소스 밖(블록 앞 문단 끝)으로 나가 이어 친 글자가 보이는 곳에 들어간다.
    await toggle.click()
    await expect(sourceBox).toBeHidden()
    await expect(frame.locator('#w')).toHaveText('two')
    await page.keyboard.insertText('!')
    await expect(page.locator('.ProseMirror p').first()).toHaveText('앞 문단!')
    await expect(sourceBox).toBeHidden()

    // 닫힌 소스 칸(display:none)으로는 화살표 커서가 들어가지 않는다 — 아래 화살표 뒤 친 글자도 보이는 문단에 들어가고 소스는 그대로다.
    // (커서가 다른 길로 소스 글자 안에 들어오면 칸이 저절로 열리는 것은 WikiHtmlEmbedView.test.tsx 가 본다.)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.insertText('Z')
    await expect(page.locator('.ProseMirror p').first()).toHaveText('앞 문단!Z')
    await expect.poll(() => savedMarkdown(page, pageId)).toContain(['```html-embed', `${source}<p id="w">two</p>`, '```'].join('\n'))
  })
})
