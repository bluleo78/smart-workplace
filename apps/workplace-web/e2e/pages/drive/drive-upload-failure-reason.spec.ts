// 다중 업로드 중 백엔드 400(크기/유형) 발생 시 실패 사유가 토스트에 노출되는지 검증.
import type { Page } from '@playwright/test'

import { createSpace, personalSpace } from '../../factories/drive.factory'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1

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

test.describe('드라이브 업로드 실패 사유', () => {
  test('다중 업로드 400 시 백엔드 메시지를 토스트에 노출한다', async ({ authenticatedPage: page }) => {
    await stubSpaces(page)
    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ folders: [], files: [] }),
            })
          : route.fallback(),
    )
    // 업로드 POST 는 400 + ErrorResponse.message 반환.
    await page.route(`**/api/v1/drive/spaces/${SPACE_ID}/files`, async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'IMAGE 파일은 최대 10MB까지 업로드할 수 있습니다' }),
        })
      } else {
        await route.fallback()
      }
    })

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await expect(page.getByTestId('drive-page')).toBeVisible({ timeout: 15000 })

    // hidden file-input 에 2개 파일 주입 → 다중 업로드 분기.
    await page.getByTestId('file-input').setInputFiles([
      { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from('x') },
      { name: 'b.png', mimeType: 'image/png', buffer: Buffer.from('y') },
    ])

    // 요약 토스트에 백엔드 사유가 포함되어야 한다(파일명만이 아님).
    await expect(page.getByText(/IMAGE 파일은 최대 10MB/)).toBeVisible({ timeout: 10000 })
  })
})
