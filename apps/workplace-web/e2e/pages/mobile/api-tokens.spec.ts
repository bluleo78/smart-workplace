// 모바일 설정 > API 토큰 — 여섯 열 표가 화면 밖으로 밀려 상태·「폐기」가 옆으로 밀어야만 보이던 문제(WP-617).
// 휴대폰에서는 앞자리·만료·마지막 사용을 이름 아래 한 줄로 모으고, 표는 가로로 넘치지 않는다.
import type { Locator } from '@playwright/test'

import { oauthConnection } from '../../factories/oauth.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, expectBodyNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'

/** 실제처럼 긴 이름 — 짧은 목데이터로는 폭 넘침이 드러나지 않는다. */
const LONG_NAME = 'Claude Code 노트북 연동용 개인 토큰 (회사 맥북 프로 16인치)'

/** 요소가 말줄임·잘림 없이 제 폭을 다 쓴다 — scrollWidth 가 clientWidth 를 넘지 않는다(잘림은 jsdom 이 못 잰다). */
async function expectNotClipped(el: Locator, label: string) {
  const { sw, cw } = await el.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }))
  expect(sw, `${label}: scrollWidth ${sw} > clientWidth ${cw}`).toBeLessThanOrEqual(cw)
}

/** 표를 감싼 스크롤 칸이 가로로 넘치지 않는다(1px 오차 허용) — 넘치면 상태·단추가 옆으로 밀어야만 보인다. */
async function expectTableNoOverflow(table: Locator, label: string) {
  const { scrollWidth, clientWidth } = await table.evaluate((el) => {
    const scroller = el.parentElement!
    return { scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth }
  })
  expect(scrollWidth, `${label} scrollWidth ${scrollWidth} vs clientWidth ${clientWidth}`).toBeLessThanOrEqual(clientWidth + 1)
}

test('API 토큰 목록 — 가로 넘침 없이 상태·폐기가 화면 안에, 앞자리·만료는 이름 아래 한 줄로 (WP-617)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  // 「연결된 앱」 절(WP-1687)이 읽는 연결 목록 — 빈 목록(절 숨김). 목이 없으면 503 → 오류 줄이 섞인다.
  await mockApi(page, 'GET', '/api/v1/users/me/oauth-connections', [])
  await page.route(/\/api\/v1\/users\/me\/api-tokens$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 1,
          name: LONG_NAME,
          tokenPrefix: 'swp_a1b2c3d4',
          tenantId: 1,
          expiresAt: '2027-01-20T00:00:00Z',
          createdAt: '2026-10-01T00:00:00Z',
          lastUsedAt: '2026-10-19T03:00:00Z',
          revokedAt: null,
        },
      ]),
    }),
  )
  await page.goto('/settings/tokens')
  const row = page.getByTestId('token-row-1')
  await expect(row).toContainText(LONG_NAME.slice(0, 10))
  // 앞자리·만료는 이름 아래 한 줄에(데스크톱 열은 숨김), 열 머리도 한국어.
  await expect(page.getByTestId('token-meta-1')).toBeVisible()
  await expect(page.getByTestId('token-meta-1')).toContainText('swp_a1b2c3d4…')
  await expect(page.getByTestId('token-meta-1')).toContainText('만료')
  await expect(page.getByRole('columnheader', { name: 'prefix' })).toHaveCount(0)
  // 상태 배지와 「폐기」가 가로 스크롤 없이 화면 안에 보인다.
  const revoke = page.getByTestId('token-revoke-1')
  await expect(revoke).toBeInViewport({ ratio: 1 })
  await expect(row.getByText('활성')).toBeInViewport({ ratio: 1 })
  const table = page.getByRole('table', { name: 'API 토큰 목록' })
  await expectTableNoOverflow(table, '표')
  await expectBodyNoHorizontalOverflow(page)
})

// WP-1126: 요약 줄 세 항목(앞자리·만료·마지막 사용)이 한 줄 말줄임에 잘려 「사용 …」이 어느 행에서도 안 보였다.
// 항목 단위로 줄바꿈해 만료일·마지막 사용일이 끝까지 보이는지 잰다(잘림·넘침은 jsdom 이 못 잰다).
test('API 토큰 요약 줄 — 만료일·마지막 사용일이 잘리지 않고 끝까지 보인다 (WP-1126)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  const token = (id: number, expiresAt: string | null, lastUsedAt: string | null) => ({
    id, name: `${LONG_NAME} ${id}`, tokenPrefix: 'swp_oIxUennT', tenantId: 1, expiresAt, createdAt: '2026-10-01T00:00:00Z', lastUsedAt, revokedAt: null,
  })
  // 연결 목록 — 빈 목록(절 숨김).
  await mockApi(page, 'GET', '/api/v1/users/me/oauth-connections', [])
  await page.route(/\/api\/v1\/users\/me\/api-tokens$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        token(1, '2027-01-01T00:00:00Z', '2026-10-28T03:00:00Z'),
        token(2, '2026-12-31T00:00:00Z', null),
        token(3, null, '2026-10-19T03:00:00Z'),
      ]),
    }),
  )
  await page.goto('/settings/tokens')
  for (const id of [1, 2, 3]) {
    const meta = page.getByTestId(`token-meta-${id}`)
    await expect(meta).toContainText('사용')
    // 만료·사용 항목은 말줄임 없이 제 폭을 다 쓰고, 요약 줄 상자 안에 들어온다.
    for (const part of ['expiry', 'used']) {
      const el = page.getByTestId(`token-meta-${id}-${part}`)
      await expect(el).toBeInViewport({ ratio: 1 })
      await expectNotClipped(el, `token ${id} ${part}`)
    }
  }
  await expect(page.getByTestId('token-meta-1-expiry')).toHaveText(/^만료 2027\. 1\. 1\.$/)
  await expect(page.getByTestId('token-meta-1-used')).toHaveText(/^사용 2026\. 10\. 28\.$/)
  await expectBodyNoHorizontalOverflow(page)
})

/** 공백 없는 DCR 앱 이름 — 동적 등록 앱은 이름이 임의 문자열이라 줄바꿈 지점이 없어도 칸 안에 들어와야 한다. */
const NO_SPACE_APP = 'SuperLongDynamicallyRegisteredConnectorName'.repeat(3)
const LONG_TENANT = '누리커머스 고객경험 혁신 태스크포스 워크스페이스'

// WP-1687 — 「연결된 앱」 절: 긴 앱 이름(공백 있음·없음)·긴 워크스페이스 이름·긴 호스트에도 「끊기」가 화면 안에 있고,
// 요약 줄(연결·사용)이 잘리지 않으며, 끊기 확인 창도 화면 밖으로 나가지 않는다(넘침은 jsdom 이 못 잰다).
test('연결된 앱 — 긴 앱·워크스페이스 이름도 가로 넘침 없이 끊기·요약 줄이 화면 안에, 확인 창도 넘치지 않는다 (WP-1687)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  await page.route(/\/api\/v1\/users\/me\/api-tokens$/, (route) => route.fulfill({ json: [] }))
  await mockApi(page, 'GET', '/api/v1/users/me/oauth-connections', [
    oauthConnection({ id: 1, clientName: LONG_NAME, tenantName: LONG_TENANT, lastUsedAt: '2026-11-15T03:00:00Z' }),
    oauthConnection({ id: 2, clientName: NO_SPACE_APP, unverified: true, redirectHost: 'very-long-subdomain.connector.example.com' }),
    oauthConnection({ id: 3 }),
  ])
  await page.goto('/settings/tokens')
  for (const id of [1, 2, 3]) {
    await expect(page.getByTestId(`oauth-connection-row-${id}`)).toBeVisible()
    // 끊기 단추가 가로 스크롤 없이 화면 안에 통째로 보인다.
    await expect(page.getByTestId(`oauth-connection-revoke-${id}`)).toBeInViewport({ ratio: 1 })
    // 요약 줄의 「연결 …」·「사용 …」 항목은 말줄임 없이 제 폭을 다 쓴다.
    const items = page.getByTestId(`oauth-connection-meta-${id}`).locator('span', { hasText: /^(연결|사용) / })
    await expect(items).toHaveCount(2)
    for (const el of await items.all()) {
      await expect(el).toBeInViewport({ ratio: 1 })
      await expectNotClipped(el, `연결 ${id} 요약 항목`)
    }
  }
  const table = page.getByRole('table', { name: '연결된 앱 목록' })
  await expectTableNoOverflow(table, '연결된 앱 표')
  await expectBodyNoHorizontalOverflow(page)

  // 이름이 가장 긴 줄 2 의 끊기 확인 창 — 긴 이름이 창을 화면 밖으로 밀지 않는다.
  await page.getByTestId('oauth-connection-revoke-2').click()
  const dialog = page.getByTestId('oauth-connection-confirm-dialog')
  await expect(dialog).toBeVisible()
  const box = await dialog.boundingBox()
  expect(box!.x, `확인 창 x ${box!.x}`).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width, `확인 창 우측 ${box!.x + box!.width}`).toBeLessThanOrEqual(390)
  // 창 안 본문도 가로로 넘치지 않는다 — 공백 없는 앱 이름이 줄바꿈(break-words)되지 않으면 창은 화면 안이어도 본문이 잘린다.
  const description = dialog.getByText(/연결을 끊으시겠습니까\?/)
  await expectNotClipped(description, '확인 창 본문')
  await expectBodyNoHorizontalOverflow(page)
})
