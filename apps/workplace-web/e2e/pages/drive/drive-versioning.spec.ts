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
            sizeBytes: 2048,
            uploadedBy: 1,
            uploadedByName: '홍길동',
            createdAt: '2026-06-21T01:00:00Z',
            comment: null,
            current: true,
          },
          {
            versionNo: 1,
            fileId: 10,
            // 1024바이트 미만 — Math.round(x/1024) 인라인 계산 시 "0KB"로 잘못 표시되던 회귀 케이스(#792)
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
  // 파일 크기 포맷 확인(#792) — 1024바이트 미만은 "N B", 이상은 "N.N KB"
  await expect(page.getByTestId('version-row-2')).toContainText('2.0 KB')
  await expect(page.getByTestId('version-row-1')).toContainText('100 B')
  await expect(page.getByTestId('version-row-1')).not.toContainText('0KB')
  // v1 롤백 클릭 → 확인 다이얼로그(#815)가 먼저 뜨고, 아직 API 호출 안 됨
  let rollbackCalled = false
  await page.route(
    (url) => url.pathname === `/api/v1/drive/files/5/versions/1/rollback`,
    (route) => {
      rollbackCalled = true
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...file, versionCount: 3 }),
      })
    },
  )
  await page.getByTestId('rollback-1').click()
  await expect(page.getByTestId('rollback-confirm-dialog')).toBeVisible()
  expect(rollbackCalled).toBe(false)
  // 확인 클릭 → 그제서야 API 호출
  await page.getByTestId('rollback-confirm-action').click()
  await expect(page.getByTestId('rollback-confirm-dialog')).not.toBeVisible()
  // 롤백 후 목록 재조회가 트리거됨(에러 없이 모달 유지)
  await expect(page.getByTestId('version-history-modal')).toBeVisible()
  expect(rollbackCalled).toBe(true)
})

test('버전 롤백 확인 다이얼로그 — 취소 시 롤백 미실행 (#815)', async ({
  authenticatedPage: page,
}) => {
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
            sizeBytes: 2048,
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
  let rollbackCalled = false
  await page.route(
    (url) => url.pathname === `/api/v1/drive/files/5/versions/1/rollback`,
    (route) => {
      rollbackCalled = true
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...file, versionCount: 3 }),
      })
    },
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()
  const fileItem = page.getByRole('listitem').filter({ hasText: 'doc.txt' })
  await fileItem.hover()
  await fileItem.getByRole('button', { name: /더보기/ }).click()
  await page.getByRole('menuitem', { name: '버전 이력' }).click()
  await expect(page.getByTestId('version-history-modal')).toBeVisible()

  await page.getByTestId('rollback-1').click()
  await expect(page.getByTestId('rollback-confirm-dialog')).toBeVisible()
  // 취소 클릭 → 다이얼로그 닫히고 롤백 API 미호출
  await page.getByRole('button', { name: '취소' }).click()
  await expect(page.getByTestId('rollback-confirm-dialog')).not.toBeVisible()
  await expect(page.getByTestId('version-history-modal')).toBeVisible()
  expect(rollbackCalled).toBe(false)
  // v1이 여전히 "현재"로 표시되지 않음(=롤백 미실행) — v2가 현재 유지
  await expect(page.getByTestId('version-row-2')).toContainText('현재')
})
