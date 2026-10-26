// 연락처 그룹 보기 브레드크럼 — 폭 부족 접기(WP-977, 05-page-patterns §B-1 「브레드크럼」·「접기」).
// 항목 수(시작점 포함 4단계)로는 접히지 않는 경로가 1024px 에서 헤더 폭이 모자라 「…」로 접히는지,
// 접힌 경로가 오른쪽 검색 범위 칩·검색창과 겹치지 않는지는 실제 레이아웃 폭이 있어야 판정된다(@layout).
// 경로 렌더·링크 이동·시작점 문구는 페이지 테스트(src/pages/contacts/contactsBreadcrumb.test.tsx)가 지킨다.
import type { Page } from '@playwright/test'

import { page as contactPage } from '../../factories/contacts.factory'
import { sharedDetail, sharedNode, tree } from '../../factories/userGroups.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { measureBox } from '../../fixtures/wait'

const L1 = '경영지원본부 글로벌 재무전략 총괄 부문'
const L2 = '경영전략실 중장기 사업계획 수립 담당'
const CURRENT = '재경팀 연결결산 및 세무조정 파트'

/** 긴 이름의 3단계 조직(10 › 11 › 12) — 시작점 「조직도」까지 4단계라 항목 수 상한(4)에는 걸리지 않는다. */
async function stubGroups(page: Page) {
  const body = tree({
    shared: [
      sharedNode({
        id: 10,
        name: L1,
        children: [sharedNode({ id: 11, name: L2, parentId: 10, children: [sharedNode({ id: 12, name: CURRENT, parentId: 11 })] })],
      }),
    ],
    personal: [],
  })
  await page.route(
    (url) => url.pathname === '/api/v1/user-groups',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  )
  await page.route(
    (url) => url.pathname === '/api/v1/user-groups/12',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sharedDetail({ id: 12, name: CURRENT, parentId: 11 })),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/v1/contacts',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contactPage([])) }),
  )
}

test('1024px 에서 긴 경로는 가운데가 「…」로 접히고 검색 범위 칩·검색창과 겹치지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1024, height: 800 })
  await stubGroups(page)
  await page.goto('/contacts?group=12')

  const crumb = page.getByTestId('contact-breadcrumb')
  const more = page.getByTestId('breadcrumb-more')
  // 폭 부족으로 접힌다 — 시작점·「…」·현재만 남고 조상 링크는 보이지 않는다.
  await expect(more).toBeVisible()
  await expect(page.getByTestId('contact-breadcrumb-root')).toBeVisible()
  await expect(page.getByTestId(`contact-breadcrumb-12`)).toBeVisible()
  await expect(crumb.getByRole('link')).toHaveCount(0)

  const scope = page.getByTestId('contact-search-scope')
  const search = page.getByTestId('contact-search')
  await expect(scope).toBeVisible()
  await expect(async () => {
    const [nav, current, chip, input] = await Promise.all([
      measureBox(crumb),
      measureBox(page.getByTestId('contact-breadcrumb-12')),
      measureBox(scope),
      measureBox(search),
    ])
    // 현재 항목(말줄임될 수 있음)은 nav 안에 머문다.
    expect(current.x + current.width, '현재 항목 우측 ≤ nav 우측').toBeLessThanOrEqual(nav.x + nav.width + 0.5)
    // 경로는 범위 칩·검색창 앞에서 끝난다.
    expect(nav.x + nav.width, 'nav 우측 ≤ 범위 칩 좌측').toBeLessThanOrEqual(chip.x)
    expect(nav.x + nav.width, 'nav 우측 ≤ 검색창 좌측').toBeLessThanOrEqual(input.x)
  }).toPass()

  // 「…」 메뉴는 접힌 조상을 위에서 아래 순서로 보인다.
  await more.click()
  await expect(page.getByRole('menuitem')).toHaveText([L1, L2])
})
