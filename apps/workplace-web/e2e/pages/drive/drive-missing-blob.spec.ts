// #739: 드라이브 원본 유실(blob missing) 파일 가시화 E2E.
// 정상 파일과 available:false 파일이 섞인 목록에서 배지·클릭 차단·오버플로 메뉴 비활성을 검증한다.
import type { Page } from '@playwright/test'

import { createFile, createSpace, personalSpace } from '../../factories/drive.factory'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1

// 공간 목록 — DriveSidebar 가 마운트 시 페치한다(drive.spec.ts 패턴 동일).
async function stubSpaces(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([personalSpace(), createSpace()]),
          })
        : route.fallback(),
  )
}

function stubItems(page: Page, files: unknown[]) {
  return page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ folders: [], files }),
          })
        : route.fallback(),
  )
}

test('정상 파일 행 — 배지 없음, 클릭 시 미리보기 모달이 열린다', async ({ authenticatedPage: page }) => {
  const file = createFile({ id: 20, name: 'ok.txt', category: 'TEXT', available: true })
  await stubSpaces(page)
  await stubItems(page, [file])
  // 썸네일(TEXT 는 미제공 → 404 허용)
  await page.route(
    (url) => url.pathname === `/api/v1/drive/files/${file.id}/thumbnail`,
    (route) => route.fulfill({ status: 404, body: '' }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/drive/files/${file.id}/content`,
    (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'hello' }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/drive/files/${file.id}/summary`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ summary: null, status: 'PENDING' }),
      }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/drive/files/${file.id}/backlinks`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()

  await expect(page.getByTestId('missing-blob-badge')).toHaveCount(0)

  await page.getByRole('button', { name: 'ok.txt' }).click()
  await expect(page.getByTestId('preview-body')).toBeVisible()
})

test('유실 파일 행 — "원본 유실" 배지 노출, 클릭 시 모달 대신 안내 문구', async ({
  authenticatedPage: page,
}) => {
  const file = createFile({ id: 21, name: 'lost.txt', category: 'TEXT', available: false })
  await stubSpaces(page)
  await stubItems(page, [file])

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()

  await expect(page.getByTestId('missing-blob-badge')).toBeVisible()
  await expect(page.getByTestId('missing-blob-badge')).toHaveText('원본 유실')

  await page.getByRole('button', { name: 'lost.txt' }).click()
  await expect(page.getByTestId('preview-body')).toHaveCount(0)
  await expect(page.getByText('이 파일의 원본이 유실되어 열거나 내려받을 수 없습니다.')).toBeVisible()
})

test('유실 파일의 오버플로 메뉴 — 다운로드 항목 disabled', async ({ authenticatedPage: page }) => {
  const file = createFile({ id: 22, name: 'lost2.txt', category: 'TEXT', available: false })
  await stubSpaces(page)
  await stubItems(page, [file])

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()

  const row = page.getByRole('listitem').filter({ hasText: 'lost2.txt' })
  await row.hover()
  // 인라인 "다운로드" 버튼도 disabled 상태여야 한다(#739: 유실 파일은 다운로드 차단).
  await expect(row.getByRole('button', { name: 'lost2.txt 다운로드' })).toBeDisabled()
  await expect(row.getByRole('button', { name: 'lost2.txt 공유 링크' })).toBeDisabled()

  // ⋯ 더보기 안의 "복사"도 disabled — 복제할 바이트가 없어 서버가 404(유실)를 반환하므로(#739).
  // "이동"은 메타데이터만 바꾸므로 유실 파일에도 허용된다.
  await row.getByRole('button', { name: 'lost2.txt 더보기' }).click()
  await expect(page.getByRole('menuitem', { name: '복사' })).toBeDisabled()
  await expect(page.getByRole('menuitem', { name: '이동' })).toBeEnabled()
})
