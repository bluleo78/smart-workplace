// 드라이브 프리뷰 포맷 E2E — 실제 브라우저에서만 판정되는 렌더(@platform: SheetJS 시트·mammoth DOCX·HTML iframe)와 이미지 가운데 정렬(@layout).
// drive.spec.ts 의 파일목록 + 프리뷰 모달 진입 패턴을 그대로 복제한다.
// Markdown·SVG·CSV 본문, 10MB 넘는 시트 확인, 로딩 스켈레톤은 src/pages/drive/drivePreview.test.tsx 가 지킨다(WP-984).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { expectThinScrollbar } from '../../fixtures/wait'

const SPACE_ID = 1
// ESM 컨텍스트: __dirname 대신 이 스펙 파일 기준 디렉토리.
const HERE = path.dirname(fileURLToPath(import.meta.url))

// 드라이브 사이드바가 마운트 시 페치하는 공간 목록.
async function stubSpaces(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              {
                id: SPACE_ID,
                type: 'PERSONAL',
                name: '내 드라이브',
                ownerId: 1,
                role: 'OWNER',
                archived: false,
                createdAt: '2026-06-01T00:00:00Z',
              },
            ]),
          })
        : route.fallback(),
  )
  // 쿼터 — 사이드바 하단 usage 바.
  await page.route(
    (url) => url.pathname === '/api/v1/drive/quota',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ usedBytes: 0, quotaBytes: 10737418240 }),
      }),
  )
}

// HTML 파일 하나를 목록·콘텐츠·부속 조회(썸네일·요약·참조된 곳)로 준다.
async function stubHtmlFile(page: Page, name: string, body: string) {
  const HTML_FILE = {
    id: 110,
    folderId: null,
    fileId: 600,
    name,
    mimeType: 'text/html',
    sizeBytes: body.length,
    category: 'OTHER',
    createdAt: '2026-07-01T00:00:00Z',
  }
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ folders: [], files: [HTML_FILE] }),
          })
        : route.fallback(),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/drive/files/${HTML_FILE.id}/thumbnail`,
    (route) => route.fulfill({ status: 404, body: '' }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/drive/files/${HTML_FILE.id}/content`,
    (route) => route.fulfill({ status: 200, contentType: 'text/html', body }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/drive/files/${HTML_FILE.id}/summary`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ summary: null, status: 'PENDING' }),
      }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/drive/files/${HTML_FILE.id}/backlinks`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
}

// 보안 점검 조회(WP-1262) — 점검 완료(낮음)로 응답한다. 「스크립트 실행」 스위치를 켜는 테스트가 쓴다.
async function stubSecurityCheckLow(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/drive/files/110/security-check',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'DONE', risk: 'LOW', headline: '문제 없어 보여요', evidence: [], checkedAt: '2026-11-01T01:00:00Z', reason: null }),
      }),
  )
}

// 최소 SVG — 브라우저가 크기를 갖도록 width/height 명시.
const SVG_BODY = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>`

test.describe('드라이브 프리뷰 포맷', () => {
  const XLSX_MIME =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

  // XLSX 파일: 실제 fixture 바이너리를 /content 로 fulfill → SheetPreview 표 렌더
  test('XLSX 파일은 표로 렌더된다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    await stubSpaces(page)
    const XLSX_FILE = {
      id: 90,
      folderId: null,
      fileId: 310,
      name: 'sheet.xlsx',
      mimeType: XLSX_MIME,
      sizeBytes: 4096,
      category: 'DATA',
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-01T00:00:00Z',
    }
    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ folders: [], files: [XLSX_FILE] }),
        }),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${XLSX_FILE.id}/thumbnail`,
      (route) => route.fulfill({ status: 404, body: '' }),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${XLSX_FILE.id}/summary`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ summary: null, status: 'PENDING' }),
        }),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${XLSX_FILE.id}/backlinks`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    const xlsxBuf = fs.readFileSync(path.join(HERE, '../../fixtures/sample.xlsx'))
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${XLSX_FILE.id}/content`,
      (route) => route.fulfill({ status: 200, contentType: XLSX_MIME, body: xlsxBuf }),
    )

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await page.getByRole('button', { name: 'sheet.xlsx' }).click()

    const body = page.getByTestId('preview-body')
    await expect(body).toBeVisible()
    const table = body.getByTestId('xlsx-table')
    await expect(table).toBeVisible()
    await expect(table.getByRole('cell', { name: '이름' })).toBeVisible()
    await expect(table.getByRole('cell', { name: '홍길동' })).toBeVisible()
    await expect(table.getByRole('cell', { name: '90' })).toBeVisible()
  })

  const DOCX_MIME =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

  // DOCX 파일: 실제 fixture → mammoth 변환 HTML → sandbox iframe srcDoc.
  // 파이프라인(페치→arrayBuffer→mammoth→HTML→srcDoc)을 srcdoc 속성으로 검증(격리 프레임 순회 회피).
  test('DOCX 파일은 sandbox iframe 으로 본문이 렌더된다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    await stubSpaces(page)
    const DOCX_FILE = {
      id: 92,
      folderId: null,
      fileId: 320,
      name: 'doc.docx',
      mimeType: DOCX_MIME,
      sizeBytes: 2048,
      category: 'DOCUMENT',
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-01T00:00:00Z',
    }
    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ folders: [], files: [DOCX_FILE] }),
        }),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${DOCX_FILE.id}/thumbnail`,
      (route) => route.fulfill({ status: 404, body: '' }),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${DOCX_FILE.id}/summary`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ summary: null, status: 'PENDING' }),
        }),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${DOCX_FILE.id}/backlinks`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    const docxBuf = fs.readFileSync(path.join(HERE, '../../fixtures/sample.docx'))
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${DOCX_FILE.id}/content`,
      (route) => route.fulfill({ status: 200, contentType: DOCX_MIME, body: docxBuf }),
    )

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await page.getByRole('button', { name: 'doc.docx' }).click()

    const body = page.getByTestId('preview-body')
    await expect(body).toBeVisible()
    const iframe = body.getByTestId('docx-document')
    // 변환된 본문이 srcdoc 에 담긴다(전 파이프라인 실행 증거).
    await expect(iframe).toHaveAttribute('srcdoc', /안녕하세요 워드 문서/)
    // 격리 유지 — 스크립트·same-origin 은 막고 링크 새 탭용 팝업만 허용한다(WP-427).
    await expect(iframe).toHaveAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox')
    // WP-274: DOCX 도 srcDoc iframe — 앱 CSS 를 못 받으므로 슬림 스크롤바가 주입돼야 하고,
    // 프레임을 여백 없이 채운다(HTML 미리보기와 같은 모양).
    await expectThinScrollbar(page.frameLocator('[data-testid="docx-document"]'))
    await expect(body).not.toHaveClass(/\bp-3\b/)
  })

  // HTML 파일: mimeType='text/html' → resolvePreviewKind='HTML' → sandbox iframe srcDoc 렌더(#732).
  // 과거엔 범용 text/ 분기로 흡수돼 <pre> 소스 덤프됐다 — 이제 격리 iframe 으로 렌더됨을 검증.
  test('HTML 파일은 sandbox iframe 으로 렌더된다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    await stubSpaces(page)
    const HTML_BODY = '<!doctype html><html><body><h1>안녕 HTML</h1></body></html>'
    await stubHtmlFile(page, 'page.html', HTML_BODY)

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await page.getByRole('button', { name: 'page.html' }).click()

    const body = page.getByTestId('preview-body')
    await expect(body).toBeVisible()
    const iframe = body.getByTestId('html-document')
    // 원문이 srcdoc 에 담겨 격리 iframe 으로 렌더된다.
    await expect(iframe).toHaveAttribute('srcdoc', /안녕 HTML/)
    // 격리 유지 — 스크립트·same-origin 은 막고 링크 새 탭용 팝업만 허용한다(WP-427).
    await expect(iframe).toHaveAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox')
    // WP-274: srcDoc 은 앱 CSS 를 못 받으므로 슬림 스크롤바 스타일을 주입한다 —
    // DOCTYPE 뒤에 둬야 quirks 모드로 바뀌지 않는다(맨 앞은 그대로 DOCTYPE).
    await expect(iframe).toHaveAttribute('srcdoc', /^<!doctype html><base target="_blank"><style data-thin-scrollbar>[^<]*scrollbar-width:thin/)
    await expect(iframe).toHaveAttribute('srcdoc', /<\/style><html><body><h1>안녕 HTML/)
    // 실제 렌더 결과: iframe 문서 안 스크롤바가 thin 이고, 문서는 표준 모드(CSS1Compat)를 유지한다.
    const [scrollbarWidth, compatMode] = await page
      .frameLocator('[data-testid="html-document"]')
      .locator('h1')
      .evaluate((el) => [getComputedStyle(el).scrollbarWidth, document.compatMode])
    expect(scrollbarWidth).toBe('thin')
    expect(compatMode).toBe('CSS1Compat')
    // 회귀 가드: TEXT 소스 덤프(<pre>)가 아니어야 한다.
    await expect(body.locator('pre')).toHaveCount(0)
  })

  // WP-1260·1262: 스크립트로 배치를 잡는 문서(발표 자료)는 「스크립트 실행」 스위치를 켜야 스크립트가 돈다 — 실제 iframe 안에서 실행되는지 본다.
  // 앞에 20만 자를 넘는 내용을 둬 미리보기가 문서를 자르지 않는 것(끝의 스크립트가 남는 것)도 함께 지킨다.
  test('스크립트가 든 HTML 은 「스크립트 실행」 스위치를 켜면 iframe 안에서 스크립트가 돈다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    await stubSpaces(page)
    const DECK = `<!doctype html><html><body><p id="state">차단됨</p><div hidden>${'가'.repeat(250_000)}</div><script>document.getElementById('state').textContent = '스크립트 실행됨:' + window.origin</script></body></html>`
    await stubHtmlFile(page, 'deck.html', DECK)
    await stubSecurityCheckLow(page)

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await page.getByRole('button', { name: 'deck.html' }).click()

    const body = page.getByTestId('preview-body')
    const state = page.frameLocator('[data-testid="html-document"]').locator('#state')
    // 기본은 차단 — 스크립트가 돌지 않아 처음 글자 그대로다.
    await expect(state).toHaveText('차단됨')
    // 스위치는 뷰어 머리줄에 있다(WP-1282).
    await page.getByRole('switch', { name: '스크립트 실행' }).click()
    // 허용하면 스크립트가 돈다. 출처는 불투명(null)이라 앱 쿠키·저장소에 닿지 못한다.
    await expect(state).toHaveText('스크립트 실행됨:null')
    await expect(page.getByTestId('html-script-notice')).toContainText('스크립트 실행 중')
    await expect(body).toBeVisible()
  })

  // WP-1271: srcdoc 문서의 `#…` 링크는 상위 앱 주소 기준으로 풀리고 `<base target="_blank">` 에 걸려 새 탭에 앱을 다시 열었다.
  // 목차 클릭이 새 탭 없이 같은 미리보기 안에서 그 절로 스크롤되는지 — 스크립트 꺼짐(링크 바꾸기)·켜짐(클릭 처리기) 둘 다 실제 iframe 에서 본다.
  test('문서 안 목차 링크는 새 탭 없이 미리보기 안에서 그 절로 이동한다(스크립트 꺼짐·켜짐)', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    await stubSpaces(page)
    // 목차 클릭을 처리하는 스크립트가 없는 문서 — 스크립트는 「스크립트 실행」 스위치가 보이게 하는 것뿐이다.
    const DOC = `<!doctype html><html><body><nav><a id="toc" href="#s2">2절로</a></nav><div style="height:3000px">1절</div><h2 id="s2">2절</h2><div style="height:3000px"></div><script>window.loaded = true</script></body></html>`
    await stubHtmlFile(page, 'toc.html', DOC)
    await stubSecurityCheckLow(page)
    const popups: string[] = []
    page.on('popup', (p) => popups.push(p.url()))

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await page.getByRole('button', { name: 'toc.html' }).click()
    const frame = page.frameLocator('[data-testid="html-document"]')
    const scrollY = () => frame.locator('body').evaluate(() => window.scrollY)

    // 스크립트 꺼짐 — 목차를 누르면 iframe 안에서 2절로 스크롤된다.
    await expect(frame.locator('#s2')).toBeAttached()
    expect(await scrollY()).toBe(0)
    await frame.locator('#toc').click()
    await expect.poll(scrollY).toBeGreaterThan(2000)

    // 스크립트 켜짐 — 새 iframe 으로 다시 그려진 뒤 목차를 누르면 역시 2절로 간다.
    // 스위치는 뷰어 머리줄에 있다(WP-1282).
    await page.getByRole('switch', { name: '스크립트 실행' }).click()
    await expect(page.getByTestId('html-script-notice')).toContainText('스크립트 실행 중')
    await expect.poll(() => frame.locator('body').evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true)).toBe(true)
    expect(await scrollY()).toBe(0)
    await frame.locator('#toc').click()
    await expect.poll(scrollY).toBeGreaterThan(2000)
    // 조각 이동이라 해시가 바뀐다(hashchange·:target 에 기대는 문서용). 같은 링크를 다시 누르면 다시 그 절로 간다.
    expect(await frame.locator('body').evaluate(() => location.hash)).toBe('#s2')
    await frame.locator('body').evaluate(() => window.scrollTo(0, 0))
    await expect.poll(scrollY).toBe(0)
    await frame.locator('#toc').click()
    await expect.poll(scrollY).toBeGreaterThan(2000)

    // 어느 쪽에서도 새 탭(앱 다시 열기)이 생기지 않는다.
    expect(popups).toEqual([])
  })

  // WP-1282: 스크립트 컨트롤은 문서 영역에 줄을 차지하지 않는다 — 데스크톱은 머리줄 안에 서고 문서(iframe)는 본문 영역 맨 위부터 시작한다.
  // 모바일은 문서 오른쪽 위에 떠 있되 상단 바 아래·화면 안에 있다. 높이·겹침은 jsdom 이 잴 수 없어 E2E 로 본다.
  for (const vp of [
    { name: '데스크톱', width: 1280, height: 800 },
    { name: '모바일', width: 390, height: 844 },
  ]) {
    test(`스크립트 컨트롤은 문서 영역에 줄을 차지하지 않는다(${vp.name})`, { tag: '@layout' }, async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await stubSpaces(page)
      await stubHtmlFile(page, 'deck.html', '<!doctype html><html><body><h1>덱</h1><script>1</script></body></html>')
      await stubSecurityCheckLow(page)
      await page.goto(`/drive/spaces/${SPACE_ID}`)
      await page.getByRole('button', { name: 'deck.html' }).first().click()

      const group = page.getByTestId('html-script-notice')
      await expect(group).toBeVisible()
      const frame = (await page.getByTestId('html-document').boundingBox())!
      const box = (await group.boundingBox())!
      if (vp.name === '데스크톱') {
        const header = (await page.getByTestId('attachment-viewer').locator('header').boundingBox())!
        // 머리줄 안에 서고(세로로 머리줄 범위 안), 문서는 머리줄 바로 아래 본문 영역 맨 위에서 시작한다.
        expect(box.y).toBeGreaterThanOrEqual(header.y)
        expect(box.y + box.height).toBeLessThanOrEqual(header.y + header.height)
        const bodyBox = (await page.getByTestId('preview-body').boundingBox())!
        expect(Math.abs(frame.y - bodyBox.y)).toBeLessThanOrEqual(1)
      } else {
        // 문서 위에 겹쳐 떠 있다 — 문서 영역 안, 화면 오른쪽 끝을 넘지 않는다.
        expect(box.y).toBeGreaterThanOrEqual(frame.y)
        expect(box.x + box.width).toBeLessThanOrEqual(vp.width)
        expect(box.x).toBeGreaterThanOrEqual(0)
      }
    })
  }

  // #776: 작은 이미지는 preview-body 가운데(가로·세로)에 놓여 상단에 방치되지 않아야 한다.
  // WP-277: 확대 시 위·왼쪽까지 스크롤되도록 정렬을 items-center 대신 자식 m-auto(안전한 가운데 정렬)로 바꿨으므로
  // 클래스가 아니라 실제 위치로 검증한다. 텍스트/CSV 등 다른 kind 는 영향받지 않는다
  // (위 'Markdown 파일은 서식 렌더된다' 테스트가 그 회귀 가드 역할을 겸한다).
  test('작은 이미지는 preview-body 가 세로 중앙정렬된다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await stubSpaces(page)

    // 1x1 PNG — 본문보다 훨씬 작아 가운데 정렬 여부가 위치로 드러난다.
    const PNG_1PX =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    const PNG_BUF = Buffer.from(PNG_1PX, 'base64')

    const IMG_FILE = {
      id: 120,
      folderId: null,
      fileId: 700,
      name: 'small.png',
      mimeType: 'image/png',
      sizeBytes: PNG_BUF.length,
      category: 'IMAGE',
      createdAt: '2026-01-01T00:00:00Z',
    }

    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ folders: [], files: [IMG_FILE] }),
            })
          : route.fallback(),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${IMG_FILE.id}/thumbnail`,
      (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_BUF }),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${IMG_FILE.id}/content`,
      (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_BUF }),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${IMG_FILE.id}/summary`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ summary: null, status: 'PENDING' }),
        }),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${IMG_FILE.id}/backlinks`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    )

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await page.getByRole('button', { name: 'small.png' }).click()

    const body = page.getByTestId('preview-body')
    await expect(body.locator('img')).toBeVisible()
    // 이미지 중심이 본문 중심과 (1px 오차 안에서) 같다.
    const off = await body.evaluate((el) => {
      const b = el.getBoundingClientRect()
      const i = el.querySelector('img')!.getBoundingClientRect()
      return { x: Math.abs(i.left + i.width / 2 - (b.left + b.width / 2)), y: Math.abs(i.top + i.height / 2 - (b.top + b.height / 2)) }
    })
    expect(off.x).toBeLessThanOrEqual(1)
    expect(off.y).toBeLessThanOrEqual(1)
  })
})
