// 통합 첨부 뷰어(WP-277) — 드라이브 단건 E2E: 긴 파일명 헤더 보존·0 바이트 텍스트.
// 드라이브 stub 은 drive-preview-formats.spec.ts 의 공간·목록 route 패턴을 따른다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Page } from '@playwright/test'

import { createSpace, personalSpace } from '../../factories/drive.factory'
import { createUser } from '../../factories/auth.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

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

  test('딥링크로 목록에 없는 파일을 열면 1건 묶음', async ({ authenticatedPage: page }) => {
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
