// 통합 첨부 뷰어 모바일 배치·제스처(WP-278) — iPhone 13 뷰포트 + chromium(coarse 포인터).
// 터치는 CDP(e2e/fixtures/touch.ts)로만 만든다 — page.mouse 는 Touch Events·touch-action 경로를 타지 않는다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Page } from '@playwright/test'

import { createSpace, personalSpace } from '../../factories/drive.factory'
import { json } from '../../fixtures/mobile-chat'
import { expect, test } from '../../fixtures/mobile.fixture'
import { solidPng } from '../../fixtures/png'
import { centerOf, touchDrag, touchSwipeThenSecondFinger, touchTap } from '../../fixtures/touch'

const SPACE_ID = 1
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PDF = fs.readFileSync(path.join(HERE, '../../fixtures/sample-3p.pdf'))

interface StubFile {
  id: number
  name: string
  mimeType: string
  body: string | Buffer
  /** 요약 응답 — 숫자면 그 HTTP 상태(403 = ✨ 숨김), 없으면 DONE 요약. */
  summary?: number | { summary: string | null; status: string }
  /** 콘텐츠 응답 지연(ms) — 공유 "받는 중" 확인용. */
  delayMs?: number
  /** 참조된 곳 응답 — 없으면 빈 목록. */
  backlinks?: unknown[]
}

/** 드라이브 공간·목록·파일별 콘텐츠/썸네일/요약/참조된 곳을 막는다. */
async function stubDriveFiles(page: Page, files: StubFile[]) {
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json([personalSpace(), createSpace()])) : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/drive/quota', (r) => r.fulfill(json({ usedBytes: 0, quotaBytes: 10737418240 })))
  await page.route((u) => u.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`, (r) =>
    r.fulfill(json({
      folders: [],
      files: files.map((f) => ({
        id: f.id, folderId: null, fileId: f.id + 1000, name: f.name, mimeType: f.mimeType,
        sizeBytes: Buffer.byteLength(f.body), category: 'TEXT', createdAt: '2026-01-01T00:00:00Z',
      })),
    })))
  for (const f of files) {
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/content`, async (r) => {
      if (f.delayMs) await new Promise((res) => setTimeout(res, f.delayMs))
      await r.fulfill({ status: 200, contentType: f.mimeType, body: f.body }).catch(() => {})
    })
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/download`, (r) =>
      r.fulfill({ status: 200, contentType: f.mimeType, body: f.body }))
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/thumbnail`, (r) => r.fulfill({ status: 404 }))
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/summary`, (r) =>
      typeof f.summary === 'number'
        ? r.fulfill({ status: f.summary, body: '' })
        : r.fulfill(json(f.summary ?? { summary: '핵심 요약입니다.', status: 'DONE' })))
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/backlinks`, (r) => r.fulfill(json(f.backlinks ?? [])))
  }
}

/** 목록에서 파일명을 탭해 뷰어를 연다. */
async function openViewer(page: Page, name: string) {
  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await page.getByRole('button', { name, exact: true }).tap()
  await expect(page.getByTestId('preview-body')).toBeVisible()
}

const IMG = (id: number, name = `사진${id}.png`): StubFile => ({ id, name, mimeType: 'image/png', body: solidPng(800, 600) })
const MD = (id: number, name = `메모${id}.md`, body = '# 제목\n\n본문'): StubFile => ({ id, name, mimeType: 'text/markdown', body })

test.describe('모바일 배치', () => {
  for (const width of [360, 390]) {
    test(`폭 ${width}px — 상단 바(✕·이름·순번·⋯)와 하단 4칸, 가로 넘침 없음`, async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width, height: 800 })
      await stubDriveFiles(page, [IMG(70), IMG(71), MD(72)])
      await openViewer(page, '사진70.png')
      const top = page.getByTestId('viewer-top-bar')
      await expect(top.getByRole('button', { name: '닫기' })).toBeVisible()
      await expect(page.getByTestId('preview-meta')).toHaveText('1 / 3')
      // 4칸 순서·폭 — 각 칸이 바 폭의 1/4.
      const bar = page.getByTestId('viewer-action-bar')
      const ids = await bar.locator('[data-slot-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-slot-id')))
      expect(ids).toEqual(['save', 'share', 'drive', 'summary'])
      for (const id of ids) {
        const b = (await bar.locator(`[data-slot-id="${id}"]`).boundingBox())!
        expect(Math.abs(b.width - width / 4)).toBeLessThan(2)
      }
      // 드라이브 파일은 ☁ 없음(빈칸), ✨ 있음.
      await expect(bar.locator('[data-slot-id="drive"]')).toHaveAttribute('data-state', 'empty')
      await expect(page.getByTestId('viewer-slot-summary')).toBeEnabled()
      // 모바일은 플로팅 확대 툴바가 없다(판정 R8).
      await expect(page.getByRole('button', { name: '확대' })).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }

  test('가로 모드(844×390)도 넘침 없이 전체 화면', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 844, height: 390 })
    await stubDriveFiles(page, [IMG(70)])
    await openViewer(page, '사진70.png')
    const box = (await page.getByTestId('attachment-viewer').boundingBox())!
    expect(Math.round(box.width)).toBe(844)
    expect(Math.round(box.height)).toBe(390)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('넘겨도 하단 칸 위치가 변하지 않는다 — ✨ 가 없는 파일은 그 칸만 비운다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70), { ...IMG(71), summary: 403 }])
    await openViewer(page, '사진70.png')
    const bar = page.getByTestId('viewer-action-bar')
    await expect(page.getByTestId('viewer-slot-summary')).toBeVisible()
    const before = await Promise.all(['save', 'share', 'drive', 'summary'].map((id) => bar.locator(`[data-slot-id="${id}"]`).boundingBox()))
    await page.getByRole('button', { name: '다음 파일' }).tap()
    await expect(page.getByTestId('preview-meta')).toHaveText('2 / 2')
    await expect(bar.locator('[data-slot-id="summary"]')).toHaveAttribute('data-state', 'empty')
    const after = await Promise.all(['save', 'share', 'drive', 'summary'].map((id) => bar.locator(`[data-slot-id="${id}"]`).boundingBox()))
    for (let k = 0; k < 4; k++) {
      expect(after[k]!.x).toBeCloseTo(before[k]!.x, 0)
      expect(after[k]!.width).toBeCloseTo(before[k]!.width, 0)
    }
  })

  test('⬇ 저장은 파일을 내려받는다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [MD(72, 'note.md')])
    await openViewer(page, 'note.md')
    const download = page.waitForEvent('download')
    await page.getByTestId('preview-download').tap()
    expect((await download).suggestedFilename()).toBe('note.md')
  })

  test('열린 동안 상태바(theme-color)는 검정, 닫으면 원래 색으로 돌아온다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70)])
    const color = () => page.locator('meta[name="theme-color"]').getAttribute('content')
    await page.goto(`/drive/spaces/${SPACE_ID}`)
    const original = await color()
    await page.getByRole('button', { name: '사진70.png', exact: true }).tap()
    await expect(page.getByTestId('preview-body')).toBeVisible()
    await expect.poll(color).toBe('#000000')
    await page.getByTestId('viewer-top-bar').getByRole('button', { name: '닫기' }).tap()
    await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
    await expect.poll(color).toBe(original)
  })
})

test.describe('AI 요약 시트', () => {
  test('✨ 요약 → 반 높이 다크 시트, ⤢ 펼치기로 거의 전체, 요약 닫기로 닫힘', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [MD(80, 'plan.md')])
    await openViewer(page, 'plan.md')
    // 모바일은 저장된 패널 상태와 무관하게 닫힌 채 연다(판정 R10).
    await expect(page.getByTestId('viewer-summary-sheet')).toHaveCount(0)
    await page.getByTestId('viewer-slot-summary').tap()
    const sheet = page.getByTestId('viewer-summary-sheet')
    await expect(sheet.getByTestId('drive-summary-card')).toContainText('핵심 요약입니다.')
    const vh = page.viewportSize()!.height
    const half = (await sheet.boundingBox())!.height
    expect(Math.abs(half - vh / 2)).toBeLessThan(vh * 0.08)
    const expand = sheet.getByRole('button', { name: '펼치기' })
    await expect(expand).toHaveAttribute('aria-expanded', 'false')
    await expand.tap()
    await expect(sheet.getByRole('button', { name: '접기' })).toHaveAttribute('aria-expanded', 'true')
    await expect.poll(async () => (await sheet.boundingBox())!.height).toBeGreaterThan(vh * 0.8)
    // 시트는 뷰어 다크 토큰 안에 있다(.dark 루트의 자손 — 하드코딩 색 없이 다크).
    expect(await sheet.evaluate((el) => el.closest('.dark') != null)).toBe(true)
    await sheet.getByRole('button', { name: '요약 닫기' }).tap()
    await expect(sheet).toHaveCount(0)
  })

  test('시트를 열면 포커스가 시트로 가고 아래 액션 바는 inert, 닫으면 ✨ 칸으로 돌아온다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [MD(80, 'plan.md')])
    await openViewer(page, 'plan.md')
    const bar = page.getByTestId('viewer-action-bar')
    await page.getByTestId('viewer-slot-summary').tap()
    const sheet = page.getByTestId('viewer-summary-sheet')
    await expect(sheet).toBeFocused()
    await expect(bar).toHaveAttribute('inert', '')
    // 시트가 열린 동안 Tab 은 덮인 액션 바로 새지 않는다.
    for (let k = 0; k < 4; k++) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="viewer-action-bar"]'))).toBe(false)
    }
    await sheet.getByRole('button', { name: '요약 닫기' }).tap()
    await expect(sheet).toHaveCount(0)
    await expect(bar).not.toHaveAttribute('inert', '')
    await expect(page.getByTestId('viewer-slot-summary')).toBeFocused()
  })

  test('모바일에서 열고 닫은 상태는 저장하지 않는다 — 데스크톱 마지막 상태를 덮지 않음', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [MD(80, 'plan.md')])
    await page.addInitScript(() => localStorage.setItem('attachment-viewer:summary-panel', '1'))
    await openViewer(page, 'plan.md')
    await expect(page.getByTestId('viewer-summary-sheet')).toHaveCount(0)
    await page.getByTestId('viewer-slot-summary').tap()
    await page.getByTestId('viewer-summary-sheet').getByRole('button', { name: '요약 닫기' }).tap()
    expect(await page.evaluate(() => localStorage.getItem('attachment-viewer:summary-panel'))).toBe('1')
  })
})

test.describe('참조된 곳 띠', () => {
  test('바 위에 띠가 얹혀도 문서 끝줄이 띠에 가려지지 않는다', async ({ authenticatedPage: page }) => {
    // ✨ 불가(403) + 참조 여러 건 → 띠가 하단 바 위에 얹힌다(판정 R11).
    const lines = Array.from({ length: 80 }, (_, i) => `줄 ${i + 1}`).join('\n\n')
    const backlinks = [1, 2, 3].map((n) => ({ sourceType: 'ISSUE', sourceId: n, label: `WP-${n} 검토`, deepLink: `/projects/WP/issues/${n}` }))
    await stubDriveFiles(page, [{ ...MD(85, 'long.md', `${lines}\n\n마지막 줄`), summary: 403, backlinks }])
    await openViewer(page, 'long.md')
    const strip = page.getByTestId('viewer-action-bar').getByTestId('file-backlinks')
    await expect(strip).toBeVisible()
    const body = page.getByTestId('preview-body')
    const last = body.getByText('마지막 줄')
    await expect(last).toBeAttached()
    // 띠 높이까지 반영된 여백으로 맨 끝까지 스크롤한 뒤, 끝줄이 하단 겹침 바(띠 포함) 위에 있어야 한다.
    await expect
      .poll(async () => {
        await body.evaluate((el) => el.scrollTo(0, el.scrollHeight))
        const lastBox = (await last.boundingBox())!
        const barBox = (await page.getByTestId('viewer-action-bar').boundingBox())!
        return lastBox.y + lastBox.height <= barBox.y
      })
      .toBe(true)
  })
})

const LONG_MD = `# 긴 문서\n\n${Array.from({ length: 120 }, (_, k) => `${k + 1}번째 줄 내용입니다.`).join('\n\n')}`
/** 열이 많은 CSV — 390px 에서 가로로 넘친다. */
const WIDE_CSV = [
  Array.from({ length: 14 }, (_, k) => `열${k + 1}`).join(','),
  ...Array.from({ length: 6 }, (_, r) => Array.from({ length: 14 }, (_, k) => `값${r}-${k}`).join(',')),
].join('\n')

test.describe('스와이프 넘김', () => {
  test('왼쪽으로 폭 25% 넘게 밀면 다음, 오른쪽이면 이전', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70), IMG(71), IMG(72)])
    await openViewer(page, '사진70.png')
    const c = await centerOf(page.getByTestId('viewer-stage'))
    await touchDrag(page, c, { x: c.x - 180, y: c.y })
    await expect(page.getByTestId('preview-meta')).toHaveText('2 / 3')
    await touchDrag(page, c, { x: c.x + 180, y: c.y })
    await expect(page.getByTestId('preview-meta')).toHaveText('1 / 3')
  })

  test('짧고 느린 끌기는 제자리 — 무대도 원위치', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70), IMG(71)])
    await openViewer(page, '사진70.png')
    const stage = page.getByTestId('viewer-stage')
    const c = await centerOf(stage)
    // 손을 떼기 전엔 무대가 손가락을 따라 움직여 있어야 한다 — 아니면 "원위치" 확인이 아무것도 안 한 경우에도 통과한다.
    await touchDrag(page, c, { x: c.x - 60, y: c.y }, {
      steps: 6,
      stepDelayMs: 40,
      beforeEnd: async () => expect(await stage.evaluate((el) => getComputedStyle(el).transform)).not.toBe('none'),
    })
    await expect.poll(() => stage.evaluate((el) => getComputedStyle(el).transform)).toBe('none')
    await expect(page.getByTestId('preview-meta')).toHaveText('1 / 2')
  })

  test('처음에서 오른쪽으로 밀어도 넘어가지 않는다(러버밴드, 순환 없음)', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70), IMG(71)])
    await openViewer(page, '사진70.png')
    const c = await centerOf(page.getByTestId('viewer-stage'))
    await touchDrag(page, c, { x: c.x + 250, y: c.y })
    await expect(page.getByTestId('preview-meta')).toHaveText('1 / 2')
    await expect.poll(() => page.getByTestId('viewer-stage').evaluate((el) => getComputedStyle(el).transform)).toBe('none')
  })

  test('화면 가장자리 20px 안에서 시작한 스와이프는 무시(iOS 뒤로가기 보호)', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70), IMG(71)])
    await openViewer(page, '사진70.png')
    const vw = page.viewportSize()!.width
    const y = (await centerOf(page.getByTestId('viewer-stage'))).y
    await touchDrag(page, { x: vw - 8, y }, { x: vw - 250, y })
    await expect(page.getByTestId('preview-meta')).toHaveText('1 / 2')
  })

  test('넓은 표는 내용이 먼저 — 가장자리에 닿은 뒤 다시 밀어야 다음 파일', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [{ id: 75, name: 'wide.csv', mimeType: 'text/csv', body: WIDE_CSV }, IMG(76)])
    await openViewer(page, 'wide.csv')
    const table = page.getByTestId('csv-table')
    await expect(table).toBeVisible()
    const c = await centerOf(table)
    await touchDrag(page, { x: c.x + 100, y: c.y }, { x: c.x - 100, y: c.y })
    // 넘기지 않은 것뿐 아니라 표가 실제로 먼저 스크롤됐는지 — 제스처가 아무 일도 안 한 경우와 구분.
    await expect.poll(() => table.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    await expect(page.getByTestId('preview-meta')).toHaveText('1 / 2')
    // 오른쪽 끝까지 스크롤된 상태에서 다시 밀면 넘어간다.
    await table.evaluate((el) => (el.scrollLeft = el.scrollWidth))
    await touchDrag(page, { x: c.x + 100, y: c.y }, { x: c.x - 100, y: c.y })
    await expect(page.getByTestId('preview-meta')).toHaveText('2 / 2')
  })

  test('세로 끌기는 문서 스크롤(네이티브) — 넘기지 않는다, 가로 스와이프는 스크롤을 건드리지 않는다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [MD(77, 'long.md', LONG_MD), IMG(78)])
    await openViewer(page, 'long.md')
    const body = page.getByTestId('preview-body')
    await expect(body).toContainText('1번째 줄')
    const c = await centerOf(body)
    await touchDrag(page, { x: c.x, y: c.y + 150 }, { x: c.x, y: c.y - 150 })
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    await expect(page.getByTestId('preview-meta')).toHaveText('1 / 2')
    // 스크롤된 문서 위에서도 가로 스와이프는 넘김(가로 스크롤 영역이 없으므로).
    await touchDrag(page, c, { x: c.x - 180, y: c.y })
    await expect(page.getByTestId('preview-meta')).toHaveText('2 / 2')
  })

  test('본문 안 버튼(다시 시도) 위에서 시작한 스와이프는 넘기지 않는다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70), IMG(71)])
    await page.route((u) => u.pathname === '/api/v1/drive/files/70/content', (r) => r.fulfill({ status: 500, body: '' }))
    await openViewer(page, '사진70.png')
    const retry = page.getByRole('button', { name: '다시 시도' })
    await expect(retry).toBeVisible()
    const c = await centerOf(retry)
    await touchDrag(page, c, { x: c.x - 200, y: c.y })
    await expect(page.getByTestId('preview-meta')).toHaveText('1 / 2')
  })

  test('스와이프 도중 두 번째 손가락이 닿으면 넘기지 않는다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [MD(72), IMG(73)])
    await openViewer(page, '메모72.md')
    const c = await centerOf(page.getByTestId('viewer-stage'))
    await touchSwipeThenSecondFinger(page, c, -180)
    await expect(page.getByTestId('preview-meta')).toHaveText('1 / 2')
    await expect.poll(() => page.getByTestId('viewer-stage').evaluate((el) => getComputedStyle(el).transform)).toBe('none')
  })

  test('iPad 가로(1180px, 터치) — 데스크톱 배치에서도 스와이프가 동작한다', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1180, height: 820 })
    await stubDriveFiles(page, [IMG(70), IMG(71)])
    await openViewer(page, '사진70.png')
    // 데스크톱 배치 — 하단 바 없음, 헤더 다운로드 있음.
    await expect(page.getByTestId('viewer-action-bar')).toHaveCount(0)
    await expect(page.getByTestId('preview-download')).toBeVisible()
    const c = await centerOf(page.getByTestId('viewer-stage'))
    await touchDrag(page, c, { x: c.x - 400, y: c.y })
    await expect(page.getByTestId('preview-meta')).toContainText('2 / 2')
  })
})

test.describe('아래로 닫기·탭 바 토글', () => {
  test('원래 크기 이미지에서 아래로 쓸면 닫히고 URL 의 preview 도 사라진다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70)])
    await openViewer(page, '사진70.png')
    const c = await centerOf(page.getByTestId('viewer-stage'))
    await touchDrag(page, { x: c.x, y: c.y - 100 }, { x: c.x, y: c.y + 250 })
    await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`/drive/spaces/${SPACE_ID}$`))
  })

  test('문서는 맨 위에서 당길 때만 닫힌다 — 중간이면 스크롤', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [MD(77, 'long.md', LONG_MD)])
    await openViewer(page, 'long.md')
    const body = page.getByTestId('preview-body')
    await expect(body).toContainText('1번째 줄')
    await body.evaluate((el) => (el.scrollTop = 600))
    const c = await centerOf(body)
    await touchDrag(page, { x: c.x, y: c.y - 120 }, { x: c.x, y: c.y + 120 })
    await expect(page.getByTestId('attachment-viewer')).toBeVisible()
    await body.evaluate((el) => (el.scrollTop = 0))
    await touchDrag(page, { x: c.x, y: c.y - 120 }, { x: c.x, y: c.y + 220 })
    await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
  })

  test('탭하면 상·하단 바와 ‹ › 가 숨고(inert) 다시 탭하면 돌아온다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70), IMG(71)])
    await openViewer(page, '사진70.png')
    const c = await centerOf(page.getByTestId('viewer-stage'))
    await touchTap(page, c)
    await expect(page.getByTestId('viewer-top-bar')).toHaveAttribute('inert', '')
    await expect(page.getByTestId('viewer-action-bar')).toHaveAttribute('inert', '')
    // ‹ › 도 바와 함께 숨는다(inert — 접근성 트리·탭 순서에서 빠짐).
    await expect(page.locator('button[aria-label="다음 파일"]')).toHaveAttribute('inert', '')
    await touchTap(page, c)
    await expect(page.getByTestId('viewer-top-bar')).not.toHaveAttribute('inert', '')
    await expect(page.locator('button[aria-label="다음 파일"]')).not.toHaveAttribute('inert', '')
  })

  test('숨긴 바에는 Tab 이 들어가지 않는다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70), IMG(71)])
    await openViewer(page, '사진70.png')
    await touchTap(page, await centerOf(page.getByTestId('viewer-stage')))
    await expect(page.getByTestId('viewer-top-bar')).toHaveAttribute('inert', '')
    for (let k = 0; k < 6; k++) {
      await page.keyboard.press('Tab')
      const inBars = await page.evaluate(() =>
        !!document.activeElement?.closest('[data-testid="viewer-top-bar"], [data-testid="viewer-action-bar"]'))
      expect(inBars).toBe(false)
    }
  })

  // 참고: 탭의 click 이 포커스를 본문·다이얼로그로 옮기므로 이 테스트는 R7 없이도 통과할 수 있다 — R7 은 방어적 규칙(블루투스 키보드·스크린리더 경로)이고 회귀 신호로만 둔다.
  test('끝까지 스와이프한 뒤에도 탭이 바를 숨긴다(제스처 넘김은 ‹ › 로 포커스를 옮기지 않음)', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [IMG(70), IMG(71)])
    await openViewer(page, '사진70.png')
    const c = await centerOf(page.getByTestId('viewer-stage'))
    await touchDrag(page, c, { x: c.x - 180, y: c.y })
    await expect(page.getByTestId('preview-meta')).toHaveText('2 / 2')
    await touchTap(page, c)
    await expect(page.getByTestId('viewer-top-bar')).toHaveAttribute('inert', '')
  })

  test('요약 시트 위 탭은 바를 숨기지 않는다', async ({ authenticatedPage: page }) => {
    await stubDriveFiles(page, [MD(80, 'plan.md')])
    await openViewer(page, 'plan.md')
    await page.getByTestId('viewer-slot-summary').tap()
    const sheet = page.getByTestId('viewer-summary-sheet')
    await expect(sheet.getByTestId('drive-summary-card')).toBeVisible()
    await touchTap(page, await centerOf(sheet.getByTestId('drive-summary-card')))
    // eslint-disable-next-line playwright/no-wait-for-timeout -- "탭 판정 지연(300ms) 동안 바가 숨지 않음" 부재 확인이라 조건 대기로 바꿀 수 없다
    await page.waitForTimeout(400)
    await expect(page.getByTestId('viewer-top-bar')).not.toHaveAttribute('inert', '')
  })

  test('가로 모드는 바가 기본 숨김, 탭하면 표시 — 세로로 돌리면 다시 보이고 넘침 없음', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 844, height: 390 })
    await stubDriveFiles(page, [IMG(70), IMG(71)])
    await openViewer(page, '사진70.png')
    await expect(page.getByTestId('viewer-top-bar')).toHaveAttribute('inert', '')
    await touchTap(page, await centerOf(page.getByTestId('viewer-stage')))
    await expect(page.getByTestId('viewer-top-bar')).not.toHaveAttribute('inert', '')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByTestId('viewer-top-bar')).not.toHaveAttribute('inert', '')
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(page.getByTestId('viewer-top-bar')).toHaveAttribute('inert', '')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
