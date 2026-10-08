// 통합 첨부 뷰어(WP-277) — 드라이브 단건 E2E: 긴 파일명 헤더 보존·0 바이트 텍스트.
// 드라이브 stub 은 drive-preview-formats.spec.ts 의 공간·목록 route 패턴을 따른다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Page } from '@playwright/test'

import { createSpace, personalSpace } from '../../factories/drive.factory'
import { createUser } from '../../factories/auth.factory'
import { mockApi } from '../../fixtures/api-mock'
import { mockGatedEvents, resourceChangedFrame } from '../../fixtures/gatedEvents'
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

/** 공간·목록·콘텐츠·썸네일(404)·요약(PENDING)·참조된 곳([]) 을 route 로 막는다. */
async function stubDriveFiles(
  page: Page,
  files: StubFile[],
  bodies: Record<number, string | Buffer>,
  opts: {
    delayMs?: Record<number, number>
    /** 파일 id → 요약 응답(기본 PENDING). */
    summary?: Record<number, { summary: string | null; status: string; reason?: string }>
    /** 파일 id → 참조된 곳 목록(기본 []). */
    backlinks?: Record<number, unknown[]>
  } = {},
) {
  // openPreview 가 id 로 파일명을 찾도록 기억한다.
  for (const f of files) NAMES[f.id] = f.name
  await page.route(
    (u) => u.pathname === '/api/v1/drive/spaces',
    (r) => (r.request().method() === 'GET' ? r.fulfill({ json: [personalSpace(), createSpace()] }) : r.fallback()),
  )
  await page.route(
    (u) => u.pathname === '/api/v1/drive/quota',
    (r) => r.fulfill({ json: { usedBytes: 0, quotaBytes: 10737418240 } }),
  )
  await page.route(
    (u) => u.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (r) =>
      r.fulfill({
        json: {
          folders: [],
          files: files.map((f) => ({
            id: f.id,
            folderId: null,
            fileId: f.id + 1000,
            name: f.name,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            category: 'TEXT',
            createdAt: '2026-01-01T00:00:00Z',
          })),
        },
      }),
  )
  for (const f of files) {
    await page.route(
      (u) => u.pathname === `/api/v1/drive/files/${f.id}/content`,
      async (r) => {
        // 지연 옵션 — 늦게 도착한 응답이 현재 파일 자리에 그려지지 않는지 보려는 용도.
        const delay = opts.delayMs?.[f.id]
        if (delay) await new Promise((res) => setTimeout(res, delay))
        await r.fulfill({ status: 200, contentType: f.mimeType, body: bodies[f.id] ?? '' }).catch(() => {})
      },
    )
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/thumbnail`, (r) => r.fulfill({ status: 404 }))
    await page.route(
      (u) => u.pathname === `/api/v1/drive/files/${f.id}/summary`,
      (r) => r.fulfill({ json: opts.summary?.[f.id] ?? { summary: null, status: 'PENDING' } }),
    )
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/backlinks`, (r) =>
      r.fulfill({ json: opts.backlinks?.[f.id] ?? [] }),
    )
  }
}

/** 드라이브 목록에서 파일명(또는 id 로 찾은 파일명) 버튼을 눌러 뷰어를 연다. */
async function openPreview(page: Page, nameOrId: string | number) {
  const name = typeof nameOrId === 'number' ? NAMES[nameOrId] : nameOrId
  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await page.getByRole('button', { name, exact: true }).click()
  await expect(page.getByTestId('preview-body')).toBeVisible()
}

test('확장자 없는 긴 이름도 헤더 버튼이 화면 안에 남는다', async ({ authenticatedPage: page }) => {
  const name = 'x'.repeat(200)
  await stubDriveFiles(page, [{ id: 70, name, mimeType: 'text/plain', sizeBytes: 4 }], { 70: 'body' })
  await openPreview(page, name)
  await expect(page.getByRole('button', { name: '닫기', exact: true })).toBeInViewport()
  await expect(page.getByTestId('preview-download')).toBeInViewport()
})

test('0 바이트 텍스트는 오류가 아니라 빈 미리보기', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [{ id: 71, name: 'empty.txt', mimeType: 'text/plain', sizeBytes: 0 }], { 71: '' })
  await openPreview(page, 'empty.txt')
  await expect(page.getByTestId('preview-body')).not.toContainText('미리보기를 불러오지 못했습니다.')
  await expect(page.getByTestId('preview-loading')).toHaveCount(0)
})

test('PDF 는 모든 페이지를 세로로 그리고 현재 페이지를 보여 준다', async ({ authenticatedPage: page }) => {
  const pdf = fs.readFileSync(path.join(HERE, '../../fixtures/sample-3p.pdf'))
  await stubDriveFiles(page, [{ id: 72, name: 'three.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length }], { 72: pdf })
  await openPreview(page, 'three.pdf')
  await expect(page.getByTestId('pdf-page-1')).toBeVisible()
  await expect(page.getByTestId('pdf-document').locator('canvas')).toHaveCount(3)
  await expect(page.getByTestId('preview-meta')).toContainText('p.1 / 3')
  await page.getByTestId('pdf-page-3').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('preview-meta')).toContainText('p.3 / 3')
})

test('PDF 를 300% 로 확대해도 페이지 왼쪽 끝까지 스크롤된다', async ({ authenticatedPage: page }) => {
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

test('PDF 로 위장한 HTML 은 렌더하지 않는다(WP-203 유지)', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [{ id: 73, name: 'fake.pdf', mimeType: 'application/pdf', sizeBytes: 20 }], {
    73: '<html><script>1</script></html>',
  })
  await openPreview(page, 'fake.pdf')
  await expect(page.getByTestId('preview-body')).toContainText('미리보기를 불러오지 못했습니다.')
  await expect(page.getByTestId('pdf-document')).toHaveCount(0)
})

test.describe('묶음 넘김', () => {
  const files = [
    { id: 80, name: 'a.txt', mimeType: 'text/plain', sizeBytes: 1 },
    { id: 81, name: 'b.txt', mimeType: 'text/plain', sizeBytes: 1 },
    { id: 82, name: 'c.txt', mimeType: 'text/plain', sizeBytes: 1 },
  ]
  test('‹ › 와 ←/→ 로 넘기고 끝에선 버튼이 없다', async ({ authenticatedPage: page }) => {
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

  test('늦게 온 이전 파일 응답이 현재 파일 자리에 그려지지 않는다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, files, { 80: 'A', 81: 'B', 82: 'C' }, { delayMs: { 81: 1500 } })
    await openPreview(page, 80)
    await page.keyboard.press('ArrowRight') // b(지연)
    await page.keyboard.press('ArrowRight') // c
    await expect(page.getByTestId('preview-body')).toContainText('C')
    // 지연 응답(1.5초)이 도착할 시간을 실제로 흘려보내야 "그려지지 않음"을 검증할 수 있다(부정 단언은 폴링으로 대체 불가).
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(1700)
    await expect(page.getByTestId('preview-body')).not.toContainText('B')
  })

  test('2건 묶음에서 끝에 닿으면 반대쪽 버튼으로 포커스가 옮겨진다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, files.slice(0, 2), { 80: 'A', 81: 'B' })
    await openPreview(page, 80)
    await page.getByRole('button', { name: '다음 파일' }).click()
    await expect(page.getByTestId('preview-body')).toContainText('B')
    await expect(page.getByRole('button', { name: '이전 파일' })).toBeFocused()
    await page.getByRole('button', { name: '이전 파일' }).click()
    await expect(page.getByTestId('preview-body')).toContainText('A')
    await expect(page.getByRole('button', { name: '다음 파일' })).toBeFocused()
  })

  test('딥링크로 목록에 없는 파일을 열면 찾을 수 없음 안내', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, files, { 80: 'A', 81: 'B', 82: 'C' })
    await page.goto('/drive/spaces/1?preview=999')
    await expect(page.getByTestId('preview-not-found')).toBeVisible()
  })
})

test('드라이브에서 열면 요약 패널이 기본 펼침이고 참조된 곳이 보인다', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [{ id: 90, name: 'doc.md', mimeType: 'text/markdown', sizeBytes: 5 }], { 90: '# hi' }, {
    summary: { 90: { summary: '요약 본문', status: 'DONE' } },
    backlinks: { 90: [{ sourceType: 'ISSUE', sourceId: 3, label: 'WP-3 검토', deepLink: '/projects/WP/issues/3' }] },
  })
  await openPreview(page, 90)
  const panel = page.getByTestId('viewer-side-panel')
  await expect(panel.getByTestId('drive-summary-card')).toContainText('요약 본문')
  await expect(panel.getByTestId('file-backlink-ISSUE-3')).toBeVisible()
  await page.getByRole('button', { name: 'AI 요약' }).click()
  await expect(panel).toHaveCount(0)
})

test('마지막 패널 열림 상태를 기억해 다시 열어도 유지한다', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [{ id: 91, name: 'again.md', mimeType: 'text/markdown', sizeBytes: 5 }], { 91: '# hi' }, {
    summary: { 91: { summary: '기억', status: 'DONE' } },
  })
  await openPreview(page, 91)
  await expect(page.getByTestId('viewer-side-panel')).toBeVisible()
  await page.getByRole('button', { name: 'AI 요약' }).click()
  await expect(page.getByTestId('viewer-side-panel')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'again.md', exact: true }).click()
  await expect(page.getByTestId('preview-body')).toBeVisible()
  await expect(page.getByTestId('viewer-side-panel')).toHaveCount(0)
})

test('AI 사이드 패널을 연 채로 뷰어가 패널을 가리지 않고, 패널에서 → 는 넘기지 않는다', async ({ authenticatedPage: page }) => {
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

test('AI 가 꺼져 있어도 참조된 곳은 보이고 ✨ 버튼은 없다', async ({ authenticatedPage: page }) => {
  // fixture 기본(aiAvailable:true)을 false 로 재정의(나중 등록 우선).
  await mockApi(page, 'GET', '/api/v1/users/me', {
    ...createUser({ aiAvailable: false }),
    roles: [{ id: 2, name: 'USER', description: '일반 사용자', isSystem: true }],
  })
  await stubDriveFiles(page, [{ id: 92, name: 'noai.md', mimeType: 'text/markdown', sizeBytes: 5 }], { 92: '# hi' }, {
    backlinks: { 92: [{ sourceType: 'ISSUE', sourceId: 3, label: 'WP-3 검토', deepLink: '/projects/WP/issues/3' }] },
  })
  await openPreview(page, 92)
  await expect(page.getByTestId('file-backlink-ISSUE-3')).toBeVisible()
  await expect(page.getByRole('button', { name: 'AI 요약' })).toHaveCount(0)
  await expect(page.getByTestId('viewer-side-panel')).toHaveCount(0)
})

test.describe('확대(WP-277)', () => {
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

test('넓은 CSV 표 안을 클릭하고 → 를 누르면 파일을 넘기지 않고 표가 가로로 스크롤된다', async ({ authenticatedPage: page }) => {
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

test('확대한 이미지 안을 클릭하고 → 를 누르면 파일을 넘기지 않는다', async ({ authenticatedPage: page }) => {
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

test('⋯ 메뉴가 열린 채 → 를 눌러도 파일이 넘어가지 않는다', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [
    { id: 80, name: 'a.txt', mimeType: 'text/plain', sizeBytes: 1 },
    { id: 81, name: 'b.txt', mimeType: 'text/plain', sizeBytes: 1 },
  ], { 80: 'A', 81: 'B' })
  await openPreview(page, 80)
  await expect(page.getByTestId('preview-meta')).toContainText('1 / 2')
  await page.getByRole('button', { name: '더 보기' }).click()
  await expect(page.getByRole('menuitem', { name: '링크 복사' })).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('preview-meta')).toContainText('1 / 2')
  await expect(page).toHaveURL(/preview=80/)
  await expect(page.getByTestId('preview-body')).toContainText('A')
})

test('라이트 테마에서도 ⋯ 메뉴는 뷰어처럼 어두운 배경으로 뜬다', async ({ authenticatedPage: page }) => {
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

test('뷰어 접근 이름은 전체 파일명 + 미리보기이고, 닫으면 연 버튼으로 포커스가 돌아온다', async ({ authenticatedPage: page }) => {
  const name = '아주-긴-파일명-'.repeat(8) + 'v3.txt'
  await stubDriveFiles(page, [{ id: 97, name, mimeType: 'text/plain', sizeBytes: 1 }], { 97: 'X' })
  await openPreview(page, name)
  await expect(page.getByRole('dialog', { name: `${name} 미리보기` })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
  await expect(page.getByRole('button', { name, exact: true })).toBeFocused()
})

test('좁은 화면(lg 미만)에서는 드라이브여도 요약 패널을 접은 채 연다', async ({ authenticatedPage: page }) => {
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

test('요약 응답 전에는 ✨·패널을 띄우지 않고 응답이 성공하면 보인다', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [{ id: 94, name: 'slow.md', mimeType: 'text/markdown', sizeBytes: 5 }], { 94: '# hi' })
  // 요약 응답을 붙잡아 둔다 — 그 사이 ✨ 가 먼저 떴다가 사라지는 깜빡임이 없어야 한다(403 링크 대비).
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  await page.route(
    (u) => u.pathname === '/api/v1/drive/files/94/summary',
    async (r) => {
      await gate
      await r.fulfill({ json: { summary: '늦은 요약', status: 'DONE' } }).catch(() => {})
    },
  )
  await openPreview(page, 94)
  await expect(page.getByTestId('preview-body')).toContainText('hi')
  await expect(page.getByRole('button', { name: 'AI 요약' })).toHaveCount(0)
  await expect(page.getByTestId('viewer-side-panel')).toHaveCount(0)
  release()
  await expect(page.getByTestId('viewer-side-panel').getByTestId('drive-summary-card')).toContainText('늦은 요약')
  await expect(page.getByRole('button', { name: 'AI 요약' })).toBeVisible()
})

test('열린 파일이 재조회로 목록에서 빠지면 1건 묶음으로 유지한다(순번·‹ › 없음)', async ({ authenticatedPage: page }) => {
  const files = [
    { id: 80, name: 'a.txt', mimeType: 'text/plain', sizeBytes: 1 },
    { id: 81, name: 'b.txt', mimeType: 'text/plain', sizeBytes: 1 },
  ]
  await stubDriveFiles(page, files, { 80: 'A', 81: 'B' })
  // 목록 재정의(나중 등록 우선) — 재조회 때 열린 a.txt 가 빠진다.
  let listed = files
  await page.route(
    (u) => u.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (r) =>
      r.fulfill({
        json: {
          folders: [],
          files: listed.map((f) => ({ ...f, folderId: null, fileId: f.id + 1000, category: 'TEXT', createdAt: '2026-01-01T00:00:00Z' })),
        },
      }),
  )
  const events = await mockGatedEvents(page)
  await openPreview(page, 80)
  await expect(page.getByTestId('preview-meta')).toContainText('1 / 2')
  listed = files.slice(1)
  events.deliver(resourceChangedFrame({ resource: 'drive', op: 'deleted', scopeType: 'USER', scopeId: 1, spaceId: SPACE_ID, ids: [80], actorId: 99 }))
  // 재조회 반영 확인 — 목록에서 a.txt 행이 사라진다(뷰어 뒤 페이지 DOM).
  await expect(page.getByRole('button', { name: 'a.txt', exact: true })).toHaveCount(0)
  await expect(page.getByTestId('preview-meta')).not.toContainText('/ 2')
  await expect(page.getByTestId('preview-body')).toContainText('A')
  await expect(page.getByRole('button', { name: '다음 파일' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '이전 파일' })).toHaveCount(0)
  await expect(page.getByTestId('preview-not-found')).toHaveCount(0)
})

test('데스크톱(마우스)은 모바일 하단 바 없이 헤더·확대 툴바를 그대로 쓴다', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [{ id: 90, name: 'desk.png', mimeType: 'image/png', sizeBytes: 100 }], { 90: solidPng(800, 600) })
  await openPreview(page, 'desk.png')
  await expect(page.getByTestId('viewer-action-bar')).toHaveCount(0)
  await expect(page.getByTestId('viewer-top-bar')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '확대' })).toBeVisible()
  await expect(page.getByTestId('preview-download')).toBeVisible()
})
