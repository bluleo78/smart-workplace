// 드라이브 프리뷰 모달 리사이즈 E2E(#731) — CSS 네이티브 resize 활성 + 초기 크기 확대 검증.
// drive-preview-formats.spec.ts 의 파일목록 + 프리뷰 모달 진입 패턴을 복제한다.
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1

// 드라이브 사이드바가 마운트 시 페치하는 공간 목록 + 쿼터.
async function stubSpaces(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              {
                id: SPACE_ID,
                type: 'PERSONAL',
                name: '내 드라이브',
                ownerId: 1,
                role: 'OWNER',
                archived: false,
                createdAt: '2026-06-01T00:00:00Z',
              },
            ]),
          })
        : route.fallback(),
  )
  await page.route(
    (url) => url.pathname === '/api/v1/drive/quota',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ usedBytes: 0, quotaBytes: 10737418240 }),
      }),
  )
}

test.describe('드라이브 프리뷰 모달 리사이즈(#731)', () => {
  // Markdown 파일로 모달을 열고, DialogContent 가 리사이즈 가능(resize:both)하며
  // 초기 폭이 과거(max-w-3xl=768px)보다 넓어졌는지 확인한다.
  test('프리뷰 모달은 크기 조절 가능하고 초기 폭이 넓다', async ({ authenticatedPage: page }) => {
    await stubSpaces(page)

    const MD_FILE = {
      id: 80,
      folderId: null,
      fileId: 300,
      name: 'readme.md',
      mimeType: 'text/markdown',
      sizeBytes: 30,
      category: 'TEXT',
      createdAt: '2026-01-01T00:00:00Z',
    }

    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ folders: [], files: [MD_FILE] }),
            })
          : route.fallback(),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${MD_FILE.id}/thumbnail`,
      (route) => route.fulfill({ status: 404, body: '' }),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${MD_FILE.id}/content`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'text/markdown', body: '# 제목' }),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${MD_FILE.id}/summary`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ summary: null, status: 'PENDING' }),
        }),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${MD_FILE.id}/backlinks`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await page.getByRole('button', { name: 'readme.md' }).click()

    const content = page.locator('[data-slot="dialog-content"]')
    await expect(content).toBeVisible()

    // 핵심: CSS 네이티브 리사이즈가 활성(우하단 코너 드래그 그립).
    await expect(content).toHaveCSS('resize', 'both')

    // 초기 폭이 과거(768px)보다 확실히 넓다(기본 1280 뷰포트에서 w-[64rem]=1024px 적용).
    const box = await content.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThan(900)

    // 본문이 flex 로 높이를 채워 스크롤 컨테이너로 동작(min-h-0 flex-1 overflow-auto).
    const body = page.getByTestId('preview-body')
    await expect(body).toBeVisible()
    await expect(body).toHaveCSS('overflow-y', 'auto')
  })
})
