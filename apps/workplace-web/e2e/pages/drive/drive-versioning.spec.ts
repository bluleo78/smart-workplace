// #79: 버전 이력 모달 표시·롤백 E2E (백엔드 없이 page.route 모킹).
import type { Page } from '@playwright/test'

import { createFile, personalSpace } from '../../factories/drive.factory'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1

// 공간 목록 스텁 — DriveSidebar 마운트 시 페치.
async function stubSpaces(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([personalSpace()]),
          })
        : route.fallback(),
  )
}

test('버전 이력 모달 표시·롤백', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  const file = createFile({ id: 5, name: 'doc.txt', versionCount: 2 })
  await stubSpaces(page)
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ folders: [], files: [file] }),
      }),
  )
  // 버전 목록 — v2(현재), v1(이전)
  await page.route(
    (url) => url.pathname === `/api/v1/drive/files/5/versions`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            versionNo: 2,
            fileId: 11,
            sizeBytes: 200,
            uploadedBy: 1,
            uploadedByName: '홍길동',
            createdAt: '2026-06-21T01:00:00Z',
            comment: null,
            current: true,
          },
          {
            versionNo: 1,
            fileId: 10,
            sizeBytes: 100,
            uploadedBy: 1,
            uploadedByName: '홍길동',
            createdAt: '2026-06-21T00:00:00Z',
            comment: null,
            current: false,
          },
        ]),
      }),
  )
  // 롤백 — v1 → versionCount 3으로 갱신된 파일 반환
  await page.route(
    (url) => url.pathname === `/api/v1/drive/files/5/versions/1/rollback`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...file, versionCount: 3 }),
      }),
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()
  // v2 뱃지 확인 — 호버 전에도 뱃지는 표시됨
  const fileItem = page.getByRole('listitem').filter({ hasText: 'doc.txt' })
  await expect(page.getByTestId('version-badge')).toHaveText('v2')
  // 버전 이력은 ⋯ 더보기 메뉴로 이동(파일 행 액션 재편) — 호버 후 ⋯ 열고 항목 클릭
  await fileItem.hover()
  await fileItem.getByRole('button', { name: /더보기/ }).click()
  await page.getByRole('menuitem', { name: '버전 이력' }).click()
  await expect(page.getByTestId('version-history-modal')).toBeVisible()
  // 버전 행 표시 확인
  await expect(page.getByTestId('version-row-2')).toContainText('현재')
  await expect(page.getByTestId('version-row-1')).toBeVisible()
  // v1 롤백 클릭 → 모달이 유지되어야 함
  await page.getByTestId('rollback-1').click()
  // 롤백 후 목록 재조회가 트리거됨(에러 없이 모달 유지)
  await expect(page.getByTestId('version-history-modal')).toBeVisible()
})
