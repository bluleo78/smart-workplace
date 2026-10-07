// 휴대폰 드라이브 미리보기(WP-212 → WP-277) — 통합 뷰어는 전체 화면 라이트박스라
// 작은 폰(360px)에서도 뷰포트를 꽉 채우고 가로 넘침이 없다.
import type { Page } from '@playwright/test'

import { createSpace, personalSpace } from '../../factories/drive.factory'
import { json } from '../../fixtures/mobile-chat'
import { expect, test } from '../../fixtures/mobile.fixture'

const SPACE_ID = 1
// 실데이터 폭 검증용 긴 파일명.
const LONG_NAME = '2026_하반기_스마트워크플레이스_도입제안서_최종_검토반영_v3_고객사송부본_요약.md'

async function stubDrive(page: Page) {
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json([personalSpace(), createSpace()])) : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`, (r) =>
    r.fulfill(json({
      folders: [],
      files: [{ id: 70, folderId: null, fileId: 200, name: LONG_NAME, mimeType: 'text/markdown', sizeBytes: 300, category: 'TEXT', createdAt: '2026-01-01T00:00:00Z' }],
    })))
  await page.route((u) => u.pathname === '/api/v1/drive/files/70/thumbnail', (r) => r.fulfill({ status: 404 }))
  await page.route((u) => u.pathname === '/api/v1/drive/files/70/content', (r) =>
    r.fulfill({ status: 200, contentType: 'text/markdown', body: '# 도입 제안 요약\n\n도입 효과와 단계별 일정, 예산 산정 근거를 정리했습니다.' }))
  await page.route((u) => u.pathname === '/api/v1/drive/files/70/summary', (r) => r.fulfill(json({ summary: null, status: 'PENDING' })))
  await page.route((u) => u.pathname === '/api/v1/drive/files/70/backlinks', (r) => r.fulfill(json([])))
}

for (const width of [360, 390]) {
  test(`폭 ${width}px — 미리보기가 전체 화면을 채우고 가로 넘침이 없다`, async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width, height: 800 })
    await stubDrive(page)
    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await page.getByRole('button', { name: LONG_NAME, exact: true }).tap()

    const viewer = page.getByTestId('attachment-viewer')
    await expect(page.getByTestId('preview-body')).toBeVisible()
    const box = (await viewer.boundingBox())!
    // 전체 화면 — 뷰포트를 꽉 채우고 가로 넘침이 없다.
    expect(box.x).toBe(0)
    expect(Math.round(box.width)).toBe(width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}
