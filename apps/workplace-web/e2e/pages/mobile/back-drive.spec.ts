// 모바일 뒤로가기 히스토리 — 드라이브 미리보기(?preview)·휴지통(?view=trash)·첨부 미리보기(WP-208).
import type { Page } from '@playwright/test'

import { createSpace, makeTrashList, personalSpace } from '../../factories/drive.factory'
import { json } from '../../fixtures/mobile-chat'
import { expect, test } from '../../fixtures/mobile.fixture'

const SPACE_ID = 1
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
// 실데이터 폭 검증용 긴 파일명.
const LONG_NAME = '2026_하반기_전사_워크숍_현장사진_메인무대_리허설_고해상도_원본_최종본.png'

async function stubDrive(page: Page) {
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json([personalSpace(), createSpace()])) : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`, (r) =>
    r.fulfill(json({
      folders: [],
      files: [{ id: 70, folderId: null, fileId: 200, name: LONG_NAME, mimeType: 'image/png', sizeBytes: 100, category: 'IMAGE', createdAt: '2026-01-01T00:00:00Z' }],
    })))
  await page.route((u) => u.pathname === '/api/v1/drive/files/70/thumbnail', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG_1x1 }))
  await page.route((u) => u.pathname === '/api/v1/drive/files/70/content', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG_1x1 }))
  await page.route('**/api/v1/drive/spaces/*/trash', (r) => r.fulfill({ json: makeTrashList() }))
}

test('미리보기: goBack 은 모달만 닫고 드라이브에 남는다 — 닫기(ESC)도 같은 결과', async ({ authenticatedPage: page }) => {
  await stubDrive(page)
  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await page.getByRole('button', { name: LONG_NAME, exact: true }).tap()
  await expect(page.getByTestId('preview-body')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/drive/spaces/${SPACE_ID}\\?preview=70$`))

  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/drive/spaces/${SPACE_ID}$`))
  await expect(page.getByTestId('preview-body')).toHaveCount(0)
  await expect(page.getByTestId('drive-page')).toBeVisible()

  await page.getByRole('button', { name: LONG_NAME, exact: true }).tap()
  await expect(page.getByTestId('preview-body')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(new RegExp(`/drive/spaces/${SPACE_ID}$`))
})

test('미리보기 딥링크 → 닫기는 드라이브에 남는다', async ({ authenticatedPage: page }) => {
  await stubDrive(page)
  await page.goto(`/drive/spaces/${SPACE_ID}?preview=70`)
  await expect(page.getByTestId('preview-body')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(new RegExp(`/drive/spaces/${SPACE_ID}$`))
  await expect(page.getByTestId('drive-page')).toBeVisible()
})

test('없는 preview id 딥링크는 찾을 수 없음 안내를 보이고 닫힌다', async ({ authenticatedPage: page }) => {
  await stubDrive(page)
  await page.goto(`/drive/spaces/${SPACE_ID}?preview=999`)
  await expect(page.getByTestId('preview-not-found')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(new RegExp(`/drive/spaces/${SPACE_ID}$`))
})

test('휴지통: goBack 은 휴지통 뷰만 닫는다 — ← 드라이브 도 같은 결과, 딥링크도 드라이브에 남는다', async ({ authenticatedPage: page }) => {
  await stubDrive(page)
  await page.goto(`/drive/spaces/${SPACE_ID}`)
  // 모바일 PageHeader 는 actions 를 ⋯ 메뉴에 담는다.
  await page.getByTestId('mobile-header-more').tap()
  await page.getByTestId('trash-toggle').tap()
  await expect(page.getByTestId('trash-view')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/drive/spaces/${SPACE_ID}\\?view=trash$`))

  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/drive/spaces/${SPACE_ID}$`))
  await expect(page.getByTestId('trash-view')).toHaveCount(0)

  await page.goto(`/drive/spaces/${SPACE_ID}?view=trash`)
  await expect(page.getByTestId('trash-view')).toBeVisible()
  await page.getByTestId('mobile-header-more').tap()
  await page.getByTestId('trash-toggle').tap()
  await expect(page).toHaveURL(new RegExp(`/drive/spaces/${SPACE_ID}$`))
  await expect(page.getByTestId('trash-view')).toHaveCount(0)
})

test('첨부 모아보기 미리보기: goBack 은 모달만 닫는다', async ({ authenticatedPage: page }) => {
  await page.route('**/api/v1/drive/spaces', (r) => r.fulfill({ json: [{ id: 1, name: '내 드라이브', type: 'PERSONAL' }] }))
  await page.route('**/api/v1/drive/attachments**', (r) =>
    r.fulfill({
      json: {
        items: [{
          fileId: 77, name: LONG_NAME, mimeType: 'image/png', sizeBytes: 1234, hasThumbnail: true,
          sourceType: 'ISSUE', sourceLabel: 'PROJ-1 제목', deepLink: '/projects/PROJ/issues/1',
          downloadUrl: '/api/v1/projects/PROJ/issues/1/attachments/77/content', attachedAt: '2026-07-01T10:00:00Z',
        }],
        nextCursor: null,
      },
    }))
  await page.route('**/api/v1/drive/files/77/thumbnail', (r) => r.fulfill({ status: 404 }))
  await page.route('**/api/v1/projects/PROJ/issues/1/attachments/77/content', (r) => r.fulfill({ contentType: 'image/png', body: PNG_1x1 }))

  await page.goto('/drive/attachments')
  await page.getByRole('button', { name: LONG_NAME, exact: true }).tap()
  await expect(page.getByTestId('preview-body')).toBeVisible()
  // WP-277: 통합 뷰어의 묶음 키는 file:{fileId} — 콜론은 인코딩될 수 있다.
  await expect(page).toHaveURL(/\/drive\/attachments\?preview=file(%3A|:)77$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/drive\/attachments$/)
  await expect(page.getByTestId('preview-body')).toHaveCount(0)
})
