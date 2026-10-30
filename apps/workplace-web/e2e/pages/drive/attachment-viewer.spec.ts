// 통합 첨부 뷰어(WP-277) — 드라이브 단건 E2E. 브라우저가 있어야 판정되는 것만 남긴다 — 헤더·확대·패널 겹침 기하(@layout),
// 브라우저가 못 그리는 이미지·PDF 렌더(@platform), 키보드 넘김·포커스(@input).
// 0 바이트·PDF 위장 차단·늦은 응답·딥링크 없음·요약/참조 패널·AI 꺼짐·재조회로 빠진 파일·데스크톱 배치는 src/pages/drive/drivePreview.test.tsx 가 지킨다(WP-984).
// 드라이브 route 모킹은 공용 fixture(e2e/fixtures/drive-mock.ts) — 모바일 뷰어 spec 과 같이 쓴다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Page } from '@playwright/test'

import { type DriveSummaryStub, stubDriveFiles as stubDrive } from '../../fixtures/drive-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { solidPng } from '../../fixtures/png'

const SPACE_ID = 1
// ESM 컨텍스트: __dirname 대신 이 스펙 파일 기준 디렉토리.
const HERE = path.dirname(fileURLToPath(import.meta.url))

interface StubFile {
  id: number
  name: string
  mimeType: string
  sizeBytes: number
}

/** stubDriveFiles 가 등록한 id → 파일명. */
const NAMES: Record<number, string> = {}

/**
 * 공간·목록·콘텐츠·썸네일(404)·요약(PENDING)·참조된 곳([]) 을 route 로 막는다 — 실제 route 는 공용 fixture(drive-mock).
 * 이 spec 은 목록 크기(sizeBytes)와 본문을 따로 주는 호출이 많아 그 모양(파일 목록 + id → 본문·옵션)을 그대로 받아 넘긴다.
 */
async function stubDriveFiles(
  page: Page,
  files: StubFile[],
  bodies: Record<number, string | Buffer>,
  opts: {
    /** 파일 id → 콘텐츠 응답 지연(ms) — 늦게 도착한 응답이 현재 파일 자리에 그려지지 않는지 보려는 용도. */
    delayMs?: Record<number, number>
    /** 파일 id → 요약 응답(기본 PENDING). */
    summary?: Record<number, DriveSummaryStub>
    /** 파일 id → 참조된 곳 목록(기본 []). */
    backlinks?: Record<number, unknown[]>
  } = {},
) {
  // openPreview 가 id 로 파일명을 찾도록 기억한다.
  for (const f of files) NAMES[f.id] = f.name
  await stubDrive(
    page,
    files.map((f) => ({
      ...f,
      body: bodies[f.id] ?? '',
      delayMs: opts.delayMs?.[f.id],
      summary: opts.summary?.[f.id],
      backlinks: opts.backlinks?.[f.id],
    })),
    { spaceId: SPACE_ID },
  )
}

/** 드라이브 목록에서 파일명(또는 id 로 찾은 파일명) 버튼을 눌러 뷰어를 연다. */
async function openPreview(page: Page, nameOrId: string | number) {
  const name = typeof nameOrId === 'number' ? NAMES[nameOrId] : nameOrId
  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await page.getByRole('button', { name, exact: true }).click()
  await expect(page.getByTestId('preview-body')).toBeVisible()
}

test('확장자 없는 긴 이름도 헤더 버튼이 화면 안에 남는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const name = 'x'.repeat(200)
  await stubDriveFiles(page, [{ id: 70, name, mimeType: 'text/plain', sizeBytes: 4 }], { 70: 'body' })
  await openPreview(page, name)
  await expect(page.getByRole('button', { name: '닫기', exact: true })).toBeInViewport()
  await expect(page.getByTestId('preview-download')).toBeInViewport()
})

test('브라우저가 못 그리는 이미지(HEIC)는 빈 그림 대신 미지원 화면과 다운로드', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  // WP-250: HEIC 는 image/heic 로 분류된다 — 크롬은 그리지 못하므로 img error 로 미지원 화면에 넘어가야 한다.
  const body = Buffer.from('ftypheic — chromium cannot decode this')
  await stubDriveFiles(page, [{ id: 72, name: 'photo.heic', mimeType: 'image/heic', sizeBytes: body.length }], { 72: body })
  await openPreview(page, 'photo.heic')
  const notice = page.getByTestId('preview-unsupported')
  await expect(notice).toContainText('이 형식은 미리 볼 수 없어요')
  await expect(notice.getByRole('button', { name: '다운로드' })).toBeVisible()
  await expect(page.getByTestId('preview-body').locator('img')).toHaveCount(0)
})

test('PDF 는 모든 페이지를 세로로 그리고 현재 페이지를 보여 준다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  const pdf = fs.readFileSync(path.join(HERE, '../../fixtures/sample-3p.pdf'))
  await stubDriveFiles(page, [{ id: 72, name: 'three.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length }], { 72: pdf })
  await openPreview(page, 'three.pdf')
  await expect(page.getByTestId('pdf-page-1')).toBeVisible()
  await expect(page.getByTestId('pdf-document').locator('canvas')).toHaveCount(3)
  await expect(page.getByTestId('preview-meta')).toContainText('p.1 / 3')
  await page.getByTestId('pdf-page-3').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('preview-meta')).toContainText('p.3 / 3')
})

test('PDF 를 300% 로 확대해도 페이지 왼쪽 끝까지 스크롤된다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const pdf = fs.readFileSync(path.join(HERE, '../../fixtures/sample-3p.pdf'))
  await stubDriveFiles(page, [{ id: 74, name: 'zoom.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length }], { 74: pdf })
  await openPreview(page, 'zoom.pdf')
  await expect(page.getByTestId('pdf-page-1')).toBeVisible()
  // 100% → 300% (25% 단계 8번).
  for (let i = 0; i < 8; i++) await page.getByRole('button', { name: '확대' }).click()
  await expect(page.getByRole('button', { name: '맞춤' })).toHaveText('300%')
  const r = await page.getByTestId('pdf-document').evaluate((el) => {
    el.scrollTo(0, 0)
    const d = el.getBoundingClientRect()
    const c = el.querySelector('[data-page="1"]')!.getBoundingClientRect()
    return { overflow: el.scrollWidth > el.clientWidth, docLeft: d.left, pageLeft: c.left }
  })
  expect(r.overflow).toBe(true)
  expect(r.pageLeft).toBeGreaterThanOrEqual(r.docLeft - 1)
})

test.describe('묶음 넘김', () => {
  const files = [
    { id: 80, name: 'a.txt', mimeType: 'text/plain', sizeBytes: 1 },
    { id: 81, name: 'b.txt', mimeType: 'text/plain', sizeBytes: 1 },
    { id: 82, name: 'c.txt', mimeType: 'text/plain', sizeBytes: 1 },
  ]
  test('‹ › 와 ←/→ 로 넘기고 끝에선 버튼이 없다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, files, { 80: 'A', 81: 'B', 82: 'C' })
    await openPreview(page, 80)
    await expect(page.getByTestId('preview-meta')).toContainText('1 / 3')
    await expect(page.getByRole('button', { name: '이전 파일' })).toHaveCount(0)
    await page.getByRole('button', { name: '다음 파일' }).click()
    await expect(page.getByTestId('preview-body')).toContainText('B')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('preview-body')).toContainText('C')
    await expect(page.getByRole('button', { name: '다음 파일' })).toHaveCount(0)
    // 끝에서 사라진 버튼 대신 포커스는 반대쪽 버튼으로.
    await expect(page.getByRole('button', { name: '이전 파일' })).toBeFocused()
    await expect(page.getByTestId('viewer-live')).toHaveText('c.txt, 3개 중 3번째')
    await expect(page).toHaveURL(/preview=82/)
  })

  test('2건 묶음에서 끝에 닿으면 반대쪽 버튼으로 포커스가 옮겨진다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, files.slice(0, 2), { 80: 'A', 81: 'B' })
    await openPreview(page, 80)
    await page.getByRole('button', { name: '다음 파일' }).click()
    await expect(page.getByTestId('preview-body')).toContainText('B')
    await expect(page.getByRole('button', { name: '이전 파일' })).toBeFocused()
    await page.getByRole('button', { name: '이전 파일' }).click()
    await expect(page.getByTestId('preview-body')).toContainText('A')
    await expect(page.getByRole('button', { name: '다음 파일' })).toBeFocused()
  })

})

test('AI 사이드 패널을 연 채로 뷰어가 패널을 가리지 않고, 패널에서 → 는 넘기지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [
    { id: 80, name: 'a.txt', mimeType: 'text/plain', sizeBytes: 1 },
    { id: 81, name: 'b.txt', mimeType: 'text/plain', sizeBytes: 1 },
  ], { 80: 'A', 81: 'B' })
  await openPreview(page, 80)
  await page.keyboard.press('ControlOrMeta+k') // 뷰어가 열린 채 ⌘K — ai-screen-context.spec 과 같은 방식
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  const panelInput = page.getByTestId('chat-input')
  await panelInput.click()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('preview-body')).toContainText('A')
  const viewer = await page.getByTestId('attachment-viewer').boundingBox()
  const panel = await page.getByTestId('ai-side-panel').boundingBox()
  expect(viewer!.x + viewer!.width).toBeLessThanOrEqual(panel!.x + 1)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('attachment-viewer')).toBeVisible() // Esc 는 패널만 닫음
})

test.describe('확대(WP-277)', { tag: '@layout' }, () => {
  /** 본문 스크롤러와 이미지의 화면 사각형. */
  async function rects(page: Page) {
    return page.getByTestId('preview-body').evaluate((el) => {
      const img = el.querySelector('img')!
      const b = el.getBoundingClientRect()
      const i = img.getBoundingClientRect()
      return { body: { left: b.left, top: b.top, w: el.clientWidth, h: el.clientHeight, sw: el.scrollWidth, sh: el.scrollHeight }, img: { left: i.left, top: i.top, w: i.width, h: i.height } }
    })
  }

  test('+/−/0 키와 확대·축소·맞춤 버튼이 이미지 크기를 바꾸고, 확대 후 왼쪽 위 끝까지 스크롤된다', async ({ authenticatedPage: page }) => {
    const png = solidPng(2400, 1600)
    await stubDriveFiles(page, [{ id: 95, name: 'big.png', mimeType: 'image/png', sizeBytes: png.length }], { 95: png })
    await openPreview(page, 'big.png')
    const img = page.getByTestId('preview-body').locator('img')
    await expect(img).toBeVisible()
    // 맞춤 — 이미지 전체가 본문 안에 들어온다.
    await expect.poll(async () => (await rects(page)).img.w).toBeGreaterThan(100)
    const fit = await rects(page)
    expect(fit.img.w).toBeLessThanOrEqual(fit.body.w + 1)
    expect(fit.img.h).toBeLessThanOrEqual(fit.body.h + 1)

    await page.keyboard.press('+')
    await expect(page.getByRole('button', { name: '맞춤' })).toHaveText('125%')
    await expect.poll(async () => Math.round((await rects(page)).img.w)).toBe(Math.round(fit.img.w * 1.25))
    await page.keyboard.press('-')
    await expect.poll(async () => Math.round((await rects(page)).img.w)).toBe(Math.round(fit.img.w))
    await page.getByRole('button', { name: '확대' }).click()
    await page.getByRole('button', { name: '확대' }).click()
    await expect(page.getByRole('button', { name: '맞춤' })).toHaveText('150%')
    await page.getByRole('button', { name: '축소' }).click()
    await expect(page.getByRole('button', { name: '맞춤' })).toHaveText('125%')
    await page.getByRole('button', { name: '맞춤' }).click()
    await expect(page.getByRole('button', { name: '맞춤' })).toHaveText('폭 맞춤')
    await expect.poll(async () => Math.round((await rects(page)).img.w)).toBe(Math.round(fit.img.w))

    // 300% — 키로 끝까지 확대한 뒤 0 키는 맞춤으로 되돌린다.
    await page.getByTestId('preview-body').focus()
    for (let i = 0; i < 8; i++) await page.keyboard.press('=')
    await expect(page.getByRole('button', { name: '맞춤' })).toHaveText('300%')
    await expect.poll(async () => Math.round((await rects(page)).img.w)).toBe(Math.round(fit.img.w * 3))
    // 왼쪽 위로 스크롤하면 이미지 왼쪽 위 끝이 본문 안에 보인다(transform 확대는 위·왼쪽이 잘려 닿을 수 없었다).
    await page.getByTestId('preview-body').evaluate((el) => el.scrollTo(0, 0))
    const zoomed = await rects(page)
    expect(zoomed.body.sw).toBeGreaterThan(zoomed.body.w)
    expect(zoomed.img.left).toBeGreaterThanOrEqual(zoomed.body.left - 1)
    expect(zoomed.img.top).toBeGreaterThanOrEqual(zoomed.body.top - 1)
    // 오른쪽 아래 끝까지도 스크롤로 닿는다.
    await page.getByTestId('preview-body').evaluate((el) => el.scrollTo(el.scrollWidth, el.scrollHeight))
    const end = await rects(page)
    expect(end.img.left + end.img.w).toBeLessThanOrEqual(end.body.left + end.body.w + 1)
    await page.keyboard.press('0')
    await expect(page.getByRole('button', { name: '맞춤' })).toHaveText('폭 맞춤')
  })

  test('세로로 긴 이미지도 맞춤에서 위쪽까지 전부 보인다', async ({ authenticatedPage: page }) => {
    const png = solidPng(600, 2400)
    await stubDriveFiles(page, [{ id: 96, name: 'tall.png', mimeType: 'image/png', sizeBytes: png.length }], { 96: png })
    await openPreview(page, 'tall.png')
    await expect(page.getByTestId('preview-body').locator('img')).toBeVisible()
    await expect.poll(async () => (await rects(page)).img.h).toBeGreaterThan(100)
    const r = await rects(page)
    expect(r.img.top).toBeGreaterThanOrEqual(r.body.top - 1)
    expect(r.img.h).toBeLessThanOrEqual(r.body.h + 1)
  })
})

test('넓은 CSV 표 안을 클릭하고 → 를 누르면 파일을 넘기지 않고 표가 가로로 스크롤된다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  // 30열 × 긴 셀 — 본문 폭보다 확실히 넓은 표.
  const cols = Array.from({ length: 30 }, (_, i) => `column-${i}-${'x'.repeat(20)}`)
  const csv = [cols.join(','), cols.map((c) => `${c}-value`).join(',')].join('\n')
  await stubDriveFiles(page, [
    { id: 86, name: 'wide.csv', mimeType: 'text/csv', sizeBytes: csv.length },
    { id: 87, name: 'next.txt', mimeType: 'text/plain', sizeBytes: 1 },
  ], { 86: csv, 87: 'N' })
  await openPreview(page, 'wide.csv')
  const table = page.getByTestId('csv-table')
  await expect(table).toBeVisible()
  await expect(page.getByTestId('preview-meta')).toContainText('1 / 2')
  expect(await table.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  // 표 안을 클릭하면 가로 스크롤 영역이 포커스를 받는다(접근 이름 "표 가로 스크롤").
  await table.locator('td').first().click()
  await expect(page.getByRole('region', { name: '표 가로 스크롤' })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  // 파일은 그대로이고, 표가 가로로 스크롤됐다.
  await expect.poll(() => table.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  await expect(page.getByTestId('preview-meta')).toContainText('1 / 2')
  await expect(page).toHaveURL(/preview=86/)
})

test('확대한 이미지 안을 클릭하고 → 를 누르면 파일을 넘기지 않는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  const png = solidPng(2400, 1600)
  await stubDriveFiles(page, [
    { id: 88, name: 'zoom.png', mimeType: 'image/png', sizeBytes: png.length },
    { id: 89, name: 'after.txt', mimeType: 'text/plain', sizeBytes: 1 },
  ], { 88: png, 89: 'N' })
  await openPreview(page, 'zoom.png')
  await expect(page.getByTestId('preview-body').locator('img')).toBeVisible()
  await page.getByRole('button', { name: '확대' }).click()
  await page.getByRole('button', { name: '확대' }).click()
  await expect(page.getByRole('button', { name: '맞춤' })).toHaveText('150%')
  const body = page.getByTestId('preview-body')
  await expect.poll(() => body.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await body.locator('img').click()
  await expect(page.getByRole('region', { name: '미리보기 스크롤 영역' })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => body.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  await expect(page.getByTestId('preview-meta')).toContainText('1 / 2')
  await expect(page).toHaveURL(/preview=88/)
  // 맞춤으로 되돌린 뒤에도 키보드가 뷰어에 남아 → 로 다음 파일로 넘어간다(포커스가 body 로 빠지지 않음).
  await page.keyboard.press('0')
  await expect(page.getByRole('button', { name: '맞춤' })).toHaveText('폭 맞춤')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('preview-meta')).toContainText('2 / 2')
})

// 드라이브 파일 미리보기의 ⋯ 는 「링크 복사」가 🔗 로 옮겨 간 뒤(WP-1234) 설치된 앱(standalone)에서만 「브라우저에서 열기」로 남는다.
// ⋯ 메뉴 동작을 드라이브 뷰어에서 계속 보려고 설치된 앱처럼 띄운다(navigator.standalone — isStandaloneDisplay 의 두 번째 판정).
async function emulateInstalledApp(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true })
  })
}

test('⋯ 메뉴가 열린 채 → 를 눌러도 파일이 넘어가지 않는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await emulateInstalledApp(page)
  await stubDriveFiles(page, [
    { id: 80, name: 'a.txt', mimeType: 'text/plain', sizeBytes: 1 },
    { id: 81, name: 'b.txt', mimeType: 'text/plain', sizeBytes: 1 },
  ], { 80: 'A', 81: 'B' })
  await openPreview(page, 80)
  await expect(page.getByTestId('preview-meta')).toContainText('1 / 2')
  await page.getByRole('button', { name: '더 보기' }).click()
  await expect(page.getByRole('menuitem', { name: '브라우저에서 열기' })).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('preview-meta')).toContainText('1 / 2')
  await expect(page).toHaveURL(/preview=80/)
  await expect(page.getByTestId('preview-body')).toContainText('A')
})

test('라이트 테마에서도 ⋯ 메뉴는 뷰어처럼 어두운 배경으로 뜬다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await emulateInstalledApp(page)
  await stubDriveFiles(page, [{ id: 82, name: 'c.txt', mimeType: 'text/plain', sizeBytes: 1 }], { 82: 'C' })
  await openPreview(page, 82)
  await page.getByRole('button', { name: '더 보기' }).click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  // 포털로 body 에 붙는 메뉴가 라이트 토큰(흰 배경)으로 뜨지 않는지 — 배경 밝기로 본다.
  // 토큰이 oklch 면 첫 값(L, 0~1)을, rgb 면 상대 휘도를 쓴다.
  const luminance = await menu.evaluate((el) => {
    const bg = getComputedStyle(el).backgroundColor
    const m = bg.match(/[\d.]+/g)!.map(Number)
    if (bg.startsWith('oklch')) return m[0] > 1 ? m[0] / 100 : m[0]
    return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255
  })
  expect(luminance).toBeLessThan(0.3)
})

test('뷰어 접근 이름은 전체 파일명 + 미리보기이고, 닫으면 연 버튼으로 포커스가 돌아온다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  const name = '아주-긴-파일명-'.repeat(8) + 'v3.txt'
  await stubDriveFiles(page, [{ id: 97, name, mimeType: 'text/plain', sizeBytes: 1 }], { 97: 'X' })
  await openPreview(page, name)
  await expect(page.getByRole('dialog', { name: `${name} 미리보기` })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
  await expect(page.getByRole('button', { name, exact: true })).toBeFocused()
})

test('좁은 화면(lg 미만)에서는 드라이브여도 요약 패널을 접은 채 연다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 900, height: 800 })
  await stubDriveFiles(page, [{ id: 93, name: 'narrow.md', mimeType: 'text/markdown', sizeBytes: 5 }], { 93: '# hi' }, {
    summary: { 93: { summary: '좁은 화면 요약', status: 'DONE' } },
  })
  await openPreview(page, 93)
  // ✨ 는 보이되(요약 가능) 패널은 접힘 — 본문 아래로 쌓여 본문을 가리지 않게.
  await expect(page.getByRole('button', { name: 'AI 요약' })).toBeVisible()
  await expect(page.getByTestId('viewer-side-panel')).toHaveCount(0)
  await expect(page.getByTestId('viewer-summary-sheet')).toHaveCount(0)
  await page.getByRole('button', { name: 'AI 요약' }).click()
  // lg 미만은 모바일 배치(WP-278) — 요약은 본문 아래 패널 대신 바텀시트로 열린다.
  await expect(page.getByTestId('viewer-summary-sheet').getByTestId('drive-summary-card')).toContainText('좁은 화면 요약')
})

test('좁은 창(900px) + 마우스는 모바일 배치여도 확대 툴바를 쓰고, 툴바는 하단 액션 바 위에 뜬다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  // 1920 화면 반쪽 분할 같은 좁은 데스크톱 창 — 핀치·두 번 탭이 없으니 툴바가 유일하게 보이는 확대 수단이다(판정 R8 수정).
  await page.setViewportSize({ width: 900, height: 800 })
  await stubDriveFiles(page, [{ id: 96, name: 'narrow.png', mimeType: 'image/png', sizeBytes: 100 }], { 96: solidPng(800, 600) })
  await openPreview(page, 'narrow.png')
  const bar = page.getByTestId('viewer-action-bar')
  await expect(bar).toBeVisible()
  const zoomIn = page.getByRole('button', { name: '확대' })
  await expect(zoomIn).toBeVisible()
  // 툴바 아래끝이 액션 바 위끝보다 위 — 겹치지 않는다.
  await expect
    .poll(async () => {
      const t = (await page.getByTestId('viewer-zoom-bar').boundingBox())!
      const b = (await bar.boundingBox())!
      return t.y + t.height <= b.y
    })
    .toBe(true)
  await zoomIn.click()
  await expect(page.getByRole('button', { name: '맞춤' })).toHaveText('125%')
})
