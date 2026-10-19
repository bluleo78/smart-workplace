// 볼 수 없거나 없는 노트 공간 주소 E2E(WP-559) — 내 공간 목록에 없는 공간을 열면 「새 페이지 만들기」 빈 상태 대신
// 「노트 공간을 찾을 수 없습니다」 안내와 「노트 목록으로」만 보이고, 누르면 기본 화면(첫 공간)으로 간다. 데스크톱·모바일 둘 다.
import type { Page } from '@playwright/test'

import type { WikiPageSummary, WikiSpace } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'

const MY_SPACE_ID = 1
const FOREIGN_SPACE_ID = 8

// 내 공간은 하나뿐 — 8번은 목록에 없다(남의 공간이거나 없는 공간). 그 공간의 트리 조회는 서버처럼 404.
async function mockWiki(page: Page) {
  const mine: WikiSpace = { id: MY_SPACE_ID, type: 'PERSONAL', name: '내 노트', ownerId: 1, role: 'OWNER', createdAt: '2026-06-01T00:00:00Z' }
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([mine]) })
        : route.fallback(),
  )
  await page.route(
    (url) => /^\/api\/v1\/wiki\/spaces\/\d+\/pages$/.test(url.pathname),
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      if (route.request().url().includes(`/spaces/${FOREIGN_SPACE_ID}/`)) {
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: `위키 공간을 찾을 수 없습니다: ${FOREIGN_SPACE_ID}` }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([] as WikiPageSummary[]) })
    },
  )
}

for (const mobile of [false, true]) {
  test(`${mobile ? '모바일' : '데스크톱'} — 볼 수 없는 공간 주소는 만들기 대신 안내와 「노트 목록으로」를 보인다`, async ({
    authenticatedPage: page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    await mockWiki(page)

    await page.goto(`/wiki/spaces/${FOREIGN_SPACE_ID}`)
    const notice = page.getByTestId('wiki-space-unavailable')
    await expect(notice).toBeVisible()
    await expect(notice.getByText('노트 공간을 찾을 수 없습니다')).toBeVisible()
    // 눌러도 404 인 생성 진입점은 없다 — 빈 상태 버튼도, 사이드바 ＋ 도.
    await expect(page.getByRole('button', { name: '새 페이지 만들기' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '새 페이지', exact: true })).toHaveCount(0)

    await notice.getByRole('button', { name: '노트 목록으로' }).click()
    await expect(page).toHaveURL(new RegExp(`/wiki/spaces/${MY_SPACE_ID}$`))
    await expect(page.getByTestId('wiki-space-unavailable')).toHaveCount(0)
  })
}
