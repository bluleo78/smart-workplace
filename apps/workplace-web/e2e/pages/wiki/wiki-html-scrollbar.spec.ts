// 노트 「HTML 문서」 스크롤바 칸 색(WP-1749) — 고정 높이 iframe 이 스스로 스크롤할 때 스크롤바 칸(트랙)이 흰 iframe 요소 배경이 아니라
// 문서 배경 위에 그려지는지(@layout). 예전에는 창(뷰포트) 스크롤바 칸이 HTML_DOCUMENT_CANVAS_CLASS(흰색)를 비춰, 배경이 어두운 문서도
// 오른쪽 끝 약 8px 가 흰 띠였다. 주입 스타일·표면별 적용 여부는 src/lib/sandboxedHtml.test.ts 와 각 화면 vitest 가 지킨다.
//
// 왜 브라우저인가: 스크롤바를 실제로 그려 픽셀을 봐야 한다. 헤드리스 Chromium 은 기본으로 --hide-scrollbars 를 붙여 스크롤바를
// 그리지 않으므로 이 파일만 그 인자를 뺀다(launchOptions 는 워커 단위라 이 파일은 따로 워커를 띄운다).
import { wikiHtmlLock, wikiHtmlPageDetail, wikiPageSummary, wikiSpace } from '../../factories/wiki.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { expectTheme, withTheme } from '../../fixtures/contrast'

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

/** 배경이 어두운(#111) 긴 문서 — 스크립트 없음(스크립트가 돌면 창 스크롤 그대로라 이 회귀의 대상이 아니다). */
const DARK_DOC =
  '<!doctype html><html><head><style>body{margin:0;background:#111;color:#eee;font:16px/1.6 sans-serif}</style></head>' +
  `<body>${Array.from({ length: 120 }, (_, i) => `<p>어두운 문서 ${i + 1}째 줄</p>`).join('')}</body></html>`

test('다크 테마에서 배경이 어두운 HTML 문서를 스크롤해도 스크롤바 칸이 흰 띠가 아니다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const detail = wikiHtmlPageDetail({ id: 9, html: DARK_DOC })
  await page.route('**/api/v1/wiki/spaces', (r) => r.fulfill(json([wikiSpace({ id: 1, name: '팀 노트', role: 'OWNER' })])))
  await page.route('**/api/v1/wiki/spaces/1/pages', (r) => r.fulfill(json([wikiPageSummary({ id: 9, title: detail.title, kind: 'HTML' })])))
  await page.route('**/api/v1/wiki/pages/9?*', (r) => r.fulfill(json(detail)))
  await page.route('**/api/v1/wiki/pages/9/html-lock', (r) => r.fulfill(json(wikiHtmlLock())))
  await withTheme(page, 'dark')
  await page.goto('/wiki/spaces/1/pages/9')
  await expectTheme(page, 'dark')

  const frame = page.getByTestId('wiki-html-frame')
  await expect(frame).toBeVisible()
  const inner = frame.contentFrame()
  await expect(inner.locator('p').first()).toHaveText('어두운 문서 1째 줄')
  // 스크롤을 맡는 것은 body 다 — 창(html)은 넘치지 않고 body 가 넘친다.
  await expect
    .poll(() =>
      inner.locator('body').evaluate((b) => ({
        htmlOverflows: b.ownerDocument.documentElement.scrollHeight > b.ownerDocument.documentElement.clientHeight,
        bodyOverflows: b.scrollHeight > b.clientHeight,
      })),
    )
    .toEqual({ htmlOverflows: false, bodyOverflows: true })

  // 조금 스크롤한 뒤(thumb 가 위 끝에서 비켜나게) 마우스를 문서 밖으로 빼 hover 차이를 없앤다.
  await inner.locator('body').evaluate((b) => {
    b.scrollTop = 600
  })
  await page.mouse.move(2, 2)
  const box = (await frame.boundingBox())!
  // 오른쪽 끝 8px 스크롤바 칸 중 thumb 아래(아래쪽 30px 위)의 트랙 픽셀들.
  const shot = await page.screenshot({ clip: { x: box.x + box.width - 10, y: box.y + box.height - 40, width: 10, height: 10 } })
  const pixels = await page.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    const out: number[] = []
    for (let i = 0; i < d.length; i += 4) out.push(Math.max(d[i], d[i + 1], d[i + 2]))
    return out
  }, shot.toString('base64'))
  // 흰 띠(255)가 아니라 문서 배경(#111 = 17)에 가까운 어두운 칸이다 — thumb 가 걸쳐도 반투명 회색(약 60)이라 128 을 넘지 않는다.
  expect(Math.max(...pixels)).toBeLessThan(128)
})

// 「편집」의 글자 고치기 덮개(WP-1749 리뷰) — body 가 스크롤을 맡는 문서에서 창 아래로 뻗은 긴 글자 상자에 마우스를 올려도
// 점선 상자가 창(html)을 넘치게 하지 않는다. 예전처럼 <html> 에 absolute·문서 좌표로 놓으면 상자가 창을 넘쳐 두 번째 스크롤바가 생겼다.
test('편집에서 창보다 긴 글자 상자에 마우스를 올려도 점선 상자가 창을 넘치게 하지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const tall = `<p id="tall">${Array.from({ length: 150 }, (_, i) => `긴 문단 ${i + 1}째 줄`).join('<br>')}</p>`
  const html = `<!doctype html><html><head><style>body{margin:0;background:#111;color:#eee}</style></head><body>${tall}</body></html>`
  const lock = wikiHtmlLock({ locked: true, mine: true, holderId: 1, holderName: '테스트 사용자' })
  await page.route('**/api/v1/wiki/spaces', (r) => r.fulfill(json([wikiSpace({ id: 1, name: '팀 노트', role: 'EDITOR' })])))
  await page.route('**/api/v1/wiki/spaces/1/pages', (r) => r.fulfill(json([wikiPageSummary({ id: 9, title: '긴 문서', kind: 'HTML' })])))
  await page.route((u) => u.pathname === '/api/v1/wiki/pages/9', (r) => r.fulfill(json(wikiHtmlPageDetail({ id: 9, title: '긴 문서', html }))))
  await page.route((u) => u.pathname === '/api/v1/wiki/pages/9/html-lock', (r) => {
    const method = r.request().method()
    if (method === 'POST') return r.fulfill(json({ token: 'tok-1', lock, draft: null }))
    if (method === 'DELETE') return r.fulfill({ status: 204, body: '' })
    return r.fulfill(json(method === 'PUT' ? lock : wikiHtmlLock()))
  })
  await page.goto('/wiki/spaces/1/pages/9')
  await page.getByTestId('wiki-html-mode-edit').click()
  const frame = page.getByTestId('wiki-html-visual-frame').contentFrame()
  await expect(frame.locator('#tall')).toBeVisible()
  await frame.locator('#tall').hover({ position: { x: 20, y: 20 } })
  await expect(frame.locator('[data-wp-html-edit-layer] > div')).toHaveCount(1)
  // 점선 상자는 창 아래로 길게 뻗지만(글자 상자 높이) 창은 넘치지 않고, 스크롤은 여전히 body 가 맡는다.
  expect(
    await frame.locator('body').evaluate((b) => ({
      htmlOverflows: b.ownerDocument.documentElement.scrollHeight > b.ownerDocument.documentElement.clientHeight,
      bodyOverflows: b.scrollHeight > b.clientHeight,
      boxTaller: (b.ownerDocument.querySelector('[data-wp-html-edit-layer] > div') as HTMLElement).offsetHeight > b.clientHeight,
    })),
  ).toEqual({ htmlOverflows: false, bodyOverflows: true, boxTaller: true })
})

// 가운데 칼럼 문서(WP-1749 리뷰) — html 을 세로 flex 로 둬도 「body{max-width;margin:0 auto}」 칼럼이 내용 폭으로 줄지 않고
// 브라우저에서 따로 연 것처럼 max-width 를 채운다(flex 자식은 margin:auto 면 내용 폭이 되므로 body 에 width:stretch 를 준다).
test('가운데 칼럼 문서는 내용이 짧아도 칼럼 폭(max-width)을 채운다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const html = '<!doctype html><html><head><style>body{max-width:300px;margin:0 auto;background:#111;color:#eee}</style></head><body><p id="s">짧은 글</p></body></html>'
  const detail = wikiHtmlPageDetail({ id: 9, html })
  await page.route('**/api/v1/wiki/spaces', (r) => r.fulfill(json([wikiSpace({ id: 1, name: '팀 노트', role: 'OWNER' })])))
  await page.route('**/api/v1/wiki/spaces/1/pages', (r) => r.fulfill(json([wikiPageSummary({ id: 9, title: detail.title, kind: 'HTML' })])))
  await page.route('**/api/v1/wiki/pages/9?*', (r) => r.fulfill(json(detail)))
  await page.route('**/api/v1/wiki/pages/9/html-lock', (r) => r.fulfill(json(wikiHtmlLock())))
  await page.goto('/wiki/spaces/1/pages/9')
  const inner = page.getByTestId('wiki-html-frame').contentFrame()
  await expect(inner.locator('#s')).toHaveText('짧은 글')
  const { width, left, right } = await inner.locator('body').evaluate((b) => {
    const r = b.getBoundingClientRect()
    return { width: r.width, left: r.left, right: b.ownerDocument.documentElement.clientWidth - r.right }
  })
  expect(width).toBe(300)
  // 가운데 — 양쪽 여백이 같다.
  expect(Math.abs(left - right)).toBeLessThan(1)
})
