import type { DriveFile, DriveSpace } from '../src/types/drive'
import { expect, test } from './fixtures/auth.fixture'

/**
 * #526 미리보기 패널 요약 카드. /summary 응답을 라우트 모킹으로 제어해
 * DONE→요약 표시 / 진행중→스켈레톤 / 없음→숨김 3 상태를 검증한다.
 * Office(미리보기 불가) 파일로 진입해 추가 콘텐츠 페치 모킹 없이 카드만 검증.
 */

// 드라이브 진입에 필요한 공통 모킹(drive-content-search.spec 미러) + Office 파일 1개.
async function setupDrive(page: import('@playwright/test').Page) {
  const spaces: DriveSpace[] = [
    { id: 1, name: '내 드라이브', type: 'PERSONAL', archived: false } as DriveSpace,
  ]
  const file: DriveFile = {
    id: 1,
    folderId: null,
    fileId: 10,
    name: '문서.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sizeBytes: 1024,
    category: 'WORD', // IMAGE/PDF/TEXT 아님 → 미리보기 불가 → blob/text 페치 없음
    createdAt: '2026-06-01T00:00:00Z',
    versionCount: 1,
  }
  await page.route('**/api/v1/drive/spaces', (route) => route.fulfill({ json: spaces }))
  await page.route('**/api/v1/drive/spaces/1', (route) => route.fulfill({ json: spaces[0] }))
  await page.route('**/api/v1/drive/spaces/1/items**', (route) =>
    route.fulfill({ json: { folders: [], files: [file] } }),
  )
  await page.route('**/api/v1/drive/quota', (route) =>
    route.fulfill({ json: { usedBytes: 0, quotaBytes: 10737418240 } }),
  )
  // backlinks(참조된 곳) — 모달이 호출. 빈 배열로 안정화.
  await page.route('**/api/v1/drive/files/1/backlinks', (route) => route.fulfill({ json: [] }))
}

async function openPreview(page: import('@playwright/test').Page) {
  await page.goto('/drive')
  await page.waitForURL(/drive\/spaces\/\d+/)
  await page.getByRole('button', { name: '문서.docx' }).click()
  await expect(page.getByTestId('preview-body')).toBeVisible()
}

test('요약 DONE → 카드 표시', async ({ authenticatedPage: page }) => {
  await setupDrive(page)
  await page.route('**/api/v1/drive/files/*/summary', (route) =>
    route.fulfill({ json: { summary: '이 문서의 핵심 요약입니다.', status: 'DONE' } }),
  )
  await openPreview(page)
  await expect(page.getByTestId('drive-summary-card')).toBeVisible()
  await expect(page.getByTestId('drive-summary-card')).toContainText('핵심 요약')
})

test('추출 진행중 → 스켈레톤 표시', async ({ authenticatedPage: page }) => {
  await setupDrive(page)
  await page.route('**/api/v1/drive/files/*/summary', (route) =>
    route.fulfill({ json: { summary: null, status: 'EXTRACTING' } }),
  )
  await openPreview(page)
  await expect(page.getByTestId('drive-summary-loading')).toBeVisible()
})

test('요약 없음 → 카드 숨김', async ({ authenticatedPage: page }) => {
  await setupDrive(page)
  await page.route('**/api/v1/drive/files/*/summary', (route) =>
    route.fulfill({ json: { summary: null, status: 'SKIPPED' } }),
  )
  await openPreview(page)
  await expect(page.getByTestId('drive-summary-card')).toHaveCount(0)
})
