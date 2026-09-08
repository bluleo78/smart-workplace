// #701: 파일 목록에 windowing 이 없어 파일 수만큼 썸네일 쿼리가 즉시 발사되던 N+1 문제 —
// IntersectionObserver 지연 로딩으로 뷰포트 밖 항목은 최초 렌더 시 요청을 만들지 않는지 검증.
import type { Page } from '@playwright/test'

import { createFile, createSpace, personalSpace } from '../../factories/drive.factory'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1
const FILE_COUNT = 60

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

function manyImageFiles() {
  return Array.from({ length: FILE_COUNT }, (_, i) =>
    createFile({ id: 100 + i, name: `photo-${i}.png`, mimeType: 'image/png', category: 'IMAGE' }),
  )
}

test('파일 목록 진입 시 뷰포트 밖 썸네일은 요청하지 않고, 스크롤하면 추가 요청이 발생한다', async ({
  authenticatedPage: page,
}) => {
  await stubSpaces(page)
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ folders: [], files: manyImageFiles() }),
          })
        : route.fallback(),
  )

  const requestedIds = new Set<number>()
  await page.route(
    (url) => /^\/api\/v1\/drive\/files\/\d+\/thumbnail$/.test(url.pathname),
    (route) => {
      const id = Number(route.request().url().match(/files\/(\d+)\/thumbnail/)?.[1])
      requestedIds.add(id)
      return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from([]) })
    },
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByText('photo-0.png')).toBeVisible()

  // 초기 렌더 직후 잠시 대기 — 지연 로딩이 아니라면 이 시점에 이미 FILE_COUNT 만큼 요청이 나갔을 것.
  await page.waitForTimeout(500)
  const countAfterInitialRender = requestedIds.size
  expect(countAfterInitialRender).toBeGreaterThan(0)
  // 뷰포트 밖(60개 중 후반부) 항목은 아직 요청되지 않아 전체 파일 수보다 적어야 한다(N+1 해소 확인).
  expect(countAfterInitialRender).toBeLessThan(FILE_COUNT)

  // 목록 끝까지 스크롤 → 나머지 항목이 뷰포트에 들어오며 추가 요청이 발생.
  await page.getByText(`photo-${FILE_COUNT - 1}.png`).scrollIntoViewIfNeeded()
  await expect.poll(() => requestedIds.size).toBeGreaterThan(countAfterInitialRender)
})
