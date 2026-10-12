import type { Page } from '@playwright/test'

import type { PlatformUserSearchItem, TenantSummary } from '../../src/types/platform'
import { expect, test } from '../fixtures/platform-auth.fixture'

// 테넌트 목록/생성 E2E.
// authenticatedPage 픽스처(인증 목 + hasSession + GET /tenants→[] 기본 스텁) 위에서
// 구체적인 `/api/platform/tenants` 라우트를 나중에 등록(LIFO 우선)해 케이스별 응답을 제공한다.

function tenant(overrides: Partial<TenantSummary> = {}): TenantSummary {
  return {
    id: 1,
    slug: 'acme',
    name: 'Acme Corp',
    status: 'ACTIVE',
    memberCount: 3,
    createdAt: '2026-01-15T09:00:00Z',
    ...overrides,
  }
}

/**
 * GET /tenants 를 mutable 목록으로 스텁. 반환된 핸들로 목록을 갱신할 수 있어
 * react-query invalidate 후 재조회(2번째 GET)에 변경된 목록을 반영한다.
 * GET 이 아닌 메서드는 route.fallback() 으로 흘려보내 POST 스텁이 처리하게 한다.
 */
async function stubTenantList(page: Page, initial: TenantSummary[]) {
  const state = { list: initial }
  await page.route('**/api/platform/tenants', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(state.list),
      })
    }
    return route.fallback()
  })
  return state
}

/** GET /users/search 스텁 — 검색어(q) 별 결과를 돌려주고, 받은 q 를 기록한다. */
async function stubUserSearch(
  page: Page,
  resolve: (q: string) => PlatformUserSearchItem[],
) {
  const queries: string[] = []
  await page.route('**/api/platform/users/search?*', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? ''
    queries.push(q)
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(resolve(q)),
    })
  })
  return queries
}

const KIM: PlatformUserSearchItem = {
  id: 7,
  name: '김운영',
  username: 'kim.ops@example.com',
  email: 'kim.ops@example.com',
}
const KIM_NO_EMAIL: PlatformUserSearchItem = {
  id: 8,
  name: '김운영2',
  username: 'kimops2',
  email: null,
}

test.describe('테넌트 목록', () => {
  // (a) 목록 2건 → 두 행 렌더, 이름/상태 표시
  test('목록을 행으로 렌더한다', async ({ authenticatedPage: page }) => {
    await stubTenantList(page, [
      tenant({ id: 1, name: 'Acme Corp', status: 'ACTIVE' }),
      tenant({ id: 2, name: 'Globex', slug: 'globex', status: 'SUSPENDED' }),
    ])
    await page.goto('/')

    const rows = page.getByTestId('tenant-row')
    await expect(rows).toHaveCount(2)
    await expect(page.getByRole('cell', { name: 'Acme Corp', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Globex', exact: true })).toBeVisible()
    await expect(page.getByText('활성')).toBeVisible()
    await expect(page.getByText('정지됨')).toBeVisible()
    // 슬러그 컬럼 헤더가 한국어로 표시돼야 한다 (회귀: #254)
    await expect(page.getByRole('columnheader', { name: '슬러그' })).toBeVisible()
  })

  // (b) 빈 목록 → 빈 상태 표시
  test('빈 목록이면 빈 상태를 표시한다', async ({ authenticatedPage: page }) => {
    await stubTenantList(page, [])
    await page.goto('/')

    await expect(page.getByTestId('tenant-list-empty')).toBeVisible()
    await expect(page.getByTestId('tenant-row')).toHaveCount(0)
  })

  // (c) 생성 성공 → 다이얼로그 열기·입력·제출(201)·목록 invalidate 재조회로 새 행 반영·성공 토스트
  test('테넌트를 생성하면 목록이 갱신된다', async ({ authenticatedPage: page }) => {
    const state = await stubTenantList(page, [])

    // POST 201 — 응답 후 목록 스텁 상태를 갱신해 재조회 시 새 테넌트가 보이게 한다.
    await page.route('**/api/platform/tenants', async (route) => {
      if (route.request().method() === 'POST') {
        const created = tenant({ id: 10, name: 'New Tenant', slug: 'new-tenant' })
        state.list = [created]
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(created),
        })
      }
      return route.fallback()
    })

    await page.goto('/')
    await page.getByTestId('create-tenant-button').click()

    await page.getByTestId('create-tenant-name').fill('New Tenant')
    await page.getByTestId('create-tenant-slug').fill('new-tenant')
    await page.getByTestId('create-tenant-submit').click()

    // 성공 토스트 + 다이얼로그 닫힘 + 재조회로 새 행 반영
    await expect(page.getByText('테넌트를 생성했습니다.')).toBeVisible()
    await expect(page.getByTestId('create-tenant-submit')).toHaveCount(0)
    await expect(page.getByText('New Tenant')).toBeVisible()
    await expect(page.getByTestId('tenant-row')).toHaveCount(1)
  })

  // (c-1) 소유자를 비우고 생성 → payload 에 ownerUserId 키가 없어야 한다(#496).
  test('소유자를 비우면 payload 에 ownerUserId 가 없다', async ({ authenticatedPage: page }) => {
    const state = await stubTenantList(page, [])
    let body: Record<string, unknown> | undefined
    await page.route('**/api/platform/tenants', async (route) => {
      if (route.request().method() === 'POST') {
        body = route.request().postDataJSON()
        const created = tenant({ id: 11, name: 'Ownerless', memberCount: 0 })
        state.list = [created]
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(created),
        })
      }
      return route.fallback()
    })

    await page.goto('/')
    await page.getByTestId('create-tenant-button').click()
    await page.getByTestId('create-tenant-name').fill('Ownerless')
    // 소유자는 고르지 않는다.
    await page.getByTestId('create-tenant-submit').click()

    await expect(page.getByText('테넌트를 생성했습니다.')).toBeVisible()
    // payload 에 name 만 있고 ownerUserId 키는 아예 없어야 한다.
    expect(body).toEqual({ name: 'Ownerless' })
    expect(body && 'ownerUserId' in body).toBe(false)
  })

  // (c-2) 소유자를 이메일·이름으로 검색해 고르면 payload 에 그 사용자 id(number) 가 실린다(WP-337).
  test('소유자를 검색해 고르면 payload 에 ownerUserId 가 포함된다', async ({
    authenticatedPage: page,
  }) => {
    const state = await stubTenantList(page, [])
    const queries = await stubUserSearch(page, (q) =>
      q.toLowerCase().includes('kim') || q.includes('김') ? [KIM, KIM_NO_EMAIL] : [],
    )
    let body: Record<string, unknown> | undefined
    await page.route('**/api/platform/tenants', async (route) => {
      if (route.request().method() === 'POST') {
        body = route.request().postDataJSON()
        const created = tenant({ id: 12, name: 'Owned' })
        state.list = [created]
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(created),
        })
      }
      return route.fallback()
    })

    await page.goto('/')
    await page.getByTestId('create-tenant-button').click()
    await page.getByTestId('create-tenant-name').fill('Owned')
    await page.getByTestId('create-tenant-owner').fill('kim')

    const options = page.getByTestId('create-tenant-owner-option')
    await expect(options).toHaveCount(2)
    // 이메일 없는 사용자는 보조줄에 아이디 + "이메일 없음" 을 보여준다.
    await expect(options.nth(1)).toContainText('아이디 kimops2 · 이메일 없음')
    await options.first().click()

    // 선택 카드로 바뀐다.
    const selected = page.getByTestId('create-tenant-owner-selected')
    await expect(selected).toContainText('김운영')
    await expect(selected).toContainText('kim.ops@example.com')

    await page.getByTestId('create-tenant-submit').click()
    await expect(page.getByText('테넌트를 생성했습니다.')).toBeVisible()
    expect(body).toEqual({ name: 'Owned', ownerUserId: 7 })
    // 디바운스 — 타이핑 중간값마다 요청하지 않고 최종 검색어로만 조회한다.
    expect(queries).toEqual(['kim'])
  })

  // (c-3) 키보드 ↓/Enter 로 고르고, ✕ 로 해제하면 소유자 없이 생성된다(WP-337).
  test('키보드로 고른 소유자를 해제하면 ownerUserId 없이 생성된다', async ({
    authenticatedPage: page,
  }) => {
    const state = await stubTenantList(page, [])
    await stubUserSearch(page, () => [KIM, KIM_NO_EMAIL])
    let body: Record<string, unknown> | undefined
    await page.route('**/api/platform/tenants', async (route) => {
      if (route.request().method() === 'POST') {
        body = route.request().postDataJSON()
        const created = tenant({ id: 13, name: 'Cleared', memberCount: 0 })
        state.list = [created]
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(created),
        })
      }
      return route.fallback()
    })

    await page.goto('/')
    await page.getByTestId('create-tenant-button').click()
    await page.getByTestId('create-tenant-name').fill('Cleared')
    const owner = page.getByTestId('create-tenant-owner')
    await owner.fill('김운')
    await expect(page.getByTestId('create-tenant-owner-option')).toHaveCount(2)
    await owner.press('ArrowDown')
    await owner.press('Enter')
    await expect(page.getByTestId('create-tenant-owner-selected')).toContainText('김운영2')

    await page.getByTestId('create-tenant-owner-clear').click()
    await expect(page.getByTestId('create-tenant-owner-selected')).toHaveCount(0)
    // 해제 후 입력창으로 포커스가 돌아온다.
    await expect(page.getByTestId('create-tenant-owner')).toBeFocused()

    await page.getByTestId('create-tenant-submit').click()
    await expect(page.getByText('테넌트를 생성했습니다.')).toBeVisible()
    expect(body).toEqual({ name: 'Cleared' })
  })

  // (c-4) 안내 상태 — 2글자 미만, 결과 없음. Esc 는 목록만 닫고 다이얼로그는 유지(WP-337).
  test('소유자 검색 안내를 보여주고 Esc 는 목록만 닫는다', async ({ authenticatedPage: page }) => {
    await stubTenantList(page, [])
    await stubUserSearch(page, () => [])

    await page.goto('/')
    await page.getByTestId('create-tenant-button').click()
    const owner = page.getByTestId('create-tenant-owner')
    const list = page.getByTestId('create-tenant-owner-list')

    await owner.fill('n')
    await expect(list).toHaveText('2글자 이상 입력하세요')
    await owner.fill('nobody@example.com')
    await expect(list).toHaveText('일치하는 사용자가 없습니다')

    await owner.press('Escape')
    await expect(list).toHaveCount(0)
    // 목록만 닫고 입력한 글자·다이얼로그는 그대로 둔다.
    await expect(owner).toHaveValue('nobody@example.com')
    await expect(page.getByTestId('create-tenant-submit')).toBeVisible()
  })

  // (c-5) 쳤지만 고르지 않고 생성 → 제출을 막고 안내한다(소유자 없는 테넌트가 조용히 생기지 않게, WP-337).
  test('소유자를 입력만 하고 고르지 않으면 생성을 막는다', async ({ authenticatedPage: page }) => {
    await stubTenantList(page, [])
    await stubUserSearch(page, () => [KIM])
    let posted = false
    await page.route('**/api/platform/tenants', (route) => {
      if (route.request().method() === 'POST') posted = true
      return route.fallback()
    })

    await page.goto('/')
    await page.getByTestId('create-tenant-button').click()
    await page.getByTestId('create-tenant-name').fill('Typed')
    await page.getByTestId('create-tenant-owner').fill('kim.ops@example.com')
    // 열린 후보 목록이 제출 버튼을 덮으므로 Esc 로 목록만 닫고 제출한다.
    await page.getByTestId('create-tenant-owner').press('Escape')
    await page.getByTestId('create-tenant-submit').click()

    await expect(
      page.getByText('목록에서 소유자를 고르거나, 소유자 없이 만들려면 입력을 지우세요.'),
    ).toBeVisible()
    expect(posted).toBe(false)

    // 목록에서 고르면 안내가 사라지고, 포커스는 카드의 ✕ 버튼으로 옮겨간다.
    await page.getByTestId('create-tenant-owner').click()
    await page.getByTestId('create-tenant-owner-option').first().click()
    await expect(
      page.getByText('목록에서 소유자를 고르거나, 소유자 없이 만들려면 입력을 지우세요.'),
    ).toHaveCount(0)
    await expect(page.getByTestId('create-tenant-owner-clear')).toBeFocused()
  })

  // (d) 생성 중복 slug(400) → 에러 메시지 표시, 다이얼로그 유지
  test('생성 실패 시 에러를 표시하고 다이얼로그를 유지한다', async ({
    authenticatedPage: page,
  }) => {
    await stubTenantList(page, [])

    await page.route('**/api/platform/tenants', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 400,
            error: 'Bad Request',
            message: '이미 사용 중인 slug 입니다.',
          }),
        })
      }
      return route.fallback()
    })

    await page.goto('/')
    await page.getByTestId('create-tenant-button').click()

    await page.getByTestId('create-tenant-name').fill('Dup')
    await page.getByTestId('create-tenant-slug').fill('acme')
    await page.getByTestId('create-tenant-submit').click()

    await expect(page.getByTestId('create-tenant-error')).toHaveText('이미 사용 중인 slug 입니다.')
    // 다이얼로그 유지 — 제출 버튼이 여전히 보인다.
    await expect(page.getByTestId('create-tenant-submit')).toBeVisible()
  })
})
