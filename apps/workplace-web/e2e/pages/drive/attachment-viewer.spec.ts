// 통합 첨부 뷰어(WP-277) — 드라이브 단건 E2E: 긴 파일명 헤더 보존·0 바이트 텍스트.
// 드라이브 stub 은 drive-preview-formats.spec.ts 의 공간·목록 route 패턴을 따른다.
import type { Page } from '@playwright/test'

import { createSpace, personalSpace } from '../../factories/drive.factory'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1

interface StubFile {
  id: number
  name: string
  mimeType: string
  sizeBytes: number
}

/** 공간·목록·콘텐츠·썸네일(404)·요약(PENDING)·참조된 곳([]) 을 route 로 막는다. */
async function stubDriveFiles(page: Page, files: StubFile[], bodies: Record<number, string>) {
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
      (r) => r.fulfill({ status: 200, contentType: f.mimeType, body: bodies[f.id] ?? '' }),
    )
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/thumbnail`, (r) => r.fulfill({ status: 404 }))
    await page.route(
      (u) => u.pathname === `/api/v1/drive/files/${f.id}/summary`,
      (r) => r.fulfill({ json: { summary: null, status: 'PENDING' } }),
    )
    await page.route((u) => u.pathname === `/api/v1/drive/files/${f.id}/backlinks`, (r) => r.fulfill({ json: [] }))
  }
}

/** 드라이브 목록에서 파일명 버튼을 눌러 뷰어를 연다. */
async function openPreview(page: Page, name: string) {
  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await page.getByRole('button', { name, exact: true }).click()
  await expect(page.getByTestId('preview-body')).toBeVisible()
}

test('확장자 없는 긴 이름도 헤더 버튼이 화면 안에 남는다', async ({ authenticatedPage: page }) => {
  const name = 'x'.repeat(200)
  await stubDriveFiles(page, [{ id: 70, name, mimeType: 'text/plain', sizeBytes: 4 }], { 70: 'body' })
  await openPreview(page, name)
  await expect(page.getByRole('button', { name: '닫기' })).toBeInViewport()
  await expect(page.getByTestId('preview-download')).toBeInViewport()
})

test('0 바이트 텍스트는 오류가 아니라 빈 미리보기', async ({ authenticatedPage: page }) => {
  await stubDriveFiles(page, [{ id: 71, name: 'empty.txt', mimeType: 'text/plain', sizeBytes: 0 }], { 71: '' })
  await openPreview(page, 'empty.txt')
  await expect(page.getByTestId('preview-body')).not.toContainText('미리보기를 불러오지 못했습니다.')
  await expect(page.getByTestId('preview-loading')).toHaveCount(0)
})
