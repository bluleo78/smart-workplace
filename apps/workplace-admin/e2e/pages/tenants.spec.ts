import type { Page } from '@playwright/test'

import type { PlatformUserLookup, TenantSummary } from '../../src/types/platform'
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
    deletedAt: null,
    purgeError: null,
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

/** GET /users/lookup 스텁 — 이메일이 users 에 있으면 200, 없으면 404. 조회된 이메일 목록을 돌려준다. */
async function stubUserLookup(page: Page, users: PlatformUserLookup[]) {
  const queried: string[] = []
  await page.route('**/api/platform/users/lookup?*', (route) => {
    const email = new URL(route.request().url()).searchParams.get('email') ?? ''
    queried.push(email)
    const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase())
    return user
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
      : route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })
  return queried
}

const KIM: PlatformUserLookup = {
  userId: 7,
  name: '김운영',
  email: 'kim.ops@example.com',
  isPlatformAdmin: false,
  ownerEligible: true,
}
const OPERATOR: PlatformUserLookup = {
  userId: 1,
  name: '운영자',
  email: 'op@example.com',
  isPlatformAdmin: true,
  ownerEligible: true,
}
const AGENT: PlatformUserLookup = {
  userId: 9,
  name: '봇',
  email: 'bot@example.com',
  isPlatformAdmin: false,
  ownerEligible: false,
}

/** POST /tenants 201 스텁 — 받은 payload 를 기록하고 목록 상태에 새 테넌트를 넣는다. */
async function stubCreateTenant(page: Page, state: { list: TenantSummary[] }, created: TenantSummary) {
  const captured: { body?: Record<string, unknown> } = {}
  await page.route('**/api/platform/tenants', (route) => {
    if (route.request().method() === 'POST') {
      captured.body = route.request().postDataJSON()
      state.list = [created]
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) })
    }
    return route.fallback()
  })
  return captured
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

    await expect(page.getByText('아직 테넌트가 없습니다.')).toBeVisible()
    await expect(page.getByTestId('tenant-row')).toHaveCount(0)
  })

  // (d) 운영 중/삭제됨 탭 — 목록 API 는 모든 상태를 반환하고 콘솔이 탭으로 나눈다(WP-341).
  test('운영 중/삭제됨 탭으로 나뉘고 건수가 보인다', async ({ authenticatedPage: page }) => {
    await stubTenantList(page, [
      tenant({ id: 1, name: 'Acme', status: 'ACTIVE' }),
      tenant({ id: 2, name: 'Beta', status: 'SUSPENDED' }),
      tenant({ id: 3, name: 'Gamma', status: 'DELETED', deletedAt: '2026-10-10T01:00:00Z' }),
      tenant({ id: 4, name: 'Old', status: 'PURGING', deletedAt: '2026-09-28T01:00:00Z' }),
    ])
    await page.goto('/')
    await expect(page.getByTestId('tenant-view-active')).toContainText('운영 중 2')
    await expect(page.getByTestId('tenant-view-deleted')).toContainText('삭제됨 2')
    await expect(page.getByTestId('tenant-row')).toHaveCount(2)
    await page.getByTestId('tenant-view-deleted').click()
    await expect(page).toHaveURL(/view=deleted/)
    await expect(page.getByTestId('tenant-row')).toHaveCount(2)
    await expect(page.getByRole('columnheader', { name: '삭제일' })).toBeVisible()
    await expect(page.getByText('영구 삭제 중…')).toBeVisible()
    // 새로고침해도 URL 쿼리로 보던 탭이 유지된다.
    await page.reload()
    await expect(page.getByTestId('tenant-view-deleted')).toHaveAttribute('data-state', 'on')
  })

  // S7: 보기 전환은 aria-pressed 토글 그룹 — tab 역할을 쓰지 않고, 키보드(Tab/Enter)로 전환된다.
  test('보기 전환은 aria-pressed 토글이고 키보드로 전환된다', async ({ authenticatedPage: page }) => {
    await stubTenantList(page, [
      tenant({ id: 1, name: 'Acme', status: 'ACTIVE' }),
      tenant({ id: 3, name: 'Gamma', status: 'DELETED', deletedAt: '2026-10-10T01:00:00Z' }),
    ])
    await page.goto('/')
    const active = page.getByTestId('tenant-view-active')
    const deleted = page.getByTestId('tenant-view-deleted')
    await expect(page.getByRole('tab')).toHaveCount(0)
    await expect(page.getByRole('group', { name: '테넌트 보기' })).toBeVisible()
    await expect(active).toHaveAttribute('aria-pressed', 'true')
    await expect(deleted).toHaveAttribute('aria-pressed', 'false')
    await deleted.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/view=deleted/)
    await expect(deleted).toHaveAttribute('aria-pressed', 'true')
    await expect(active).toHaveAttribute('aria-pressed', 'false')
  })

  // S8: 행은 이름 링크로 키보드 진입 — Tab 으로 포커스, Enter 로 상세 이동(이중 이동 없음).
  test('행을 키보드로 열 수 있다', async ({ authenticatedPage: page }) => {
    await page.route('**/api/platform/tenants/3', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
    )
    await stubTenantList(page, [tenant({ id: 3, name: 'Gamma', status: 'DELETED', deletedAt: '2026-10-10T01:00:00Z' })])
    await page.goto('/?view=deleted')
    const link = page.getByTestId('tenant-row-link')
    await link.focus()
    await expect(link).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/tenants\/3$/)
    // 뒤로 가면 곧바로 목록 — 링크+행 핸들러로 이력이 두 번 쌓이지 않았다.
    await page.goBack()
    await expect(page).toHaveURL(/\/\?view=deleted$/)
    // 마우스로 행의 다른 칸을 눌러도 기존처럼 열린다.
    await page.getByTestId('tenant-row').getByText('acme').click()
    await expect(page).toHaveURL(/\/tenants\/3$/)
  })

  // (f) 삭제일이 없으면(null) 생성일로 대체하지 않고 '-' 를 보여준다(N8).
  test('삭제됨 탭에서 deletedAt 이 없으면 삭제일 칸은 - 이다', async ({ authenticatedPage: page }) => {
    await stubTenantList(page, [tenant({ id: 3, name: 'Gamma', status: 'DELETED', deletedAt: null, createdAt: '2026-01-02T00:00:00Z' })])
    await page.goto('/?view=deleted')
    const cells = page.getByTestId('tenant-row').getByRole('cell')
    await expect(cells.last()).toHaveText('-')
  })

  // (e) 삭제됨 탭 빈 상태 — 생성 버튼 없이 안내 문구만.
  test('삭제됨 탭 빈 상태', async ({ authenticatedPage: page }) => {
    await stubTenantList(page, [tenant({ id: 1, status: 'ACTIVE' })])
    await page.goto('/?view=deleted')
    await expect(page.getByText('삭제된 테넌트가 없습니다.')).toBeVisible()
    await expect(page.getByRole('button', { name: '첫 테넌트 생성' })).toHaveCount(0)
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

  // WP-669 — 생성 폼도 수정 폼과 같은 slug 규칙으로 막는다(형식·64자). 고치면 그대로 생성된다.
  test('형식이 틀리거나 64자를 넘는 slug 는 생성 요청 없이 필드 오류로 막는다', async ({
    authenticatedPage: page,
  }) => {
    const state = await stubTenantList(page, [])
    let body: Record<string, unknown> | undefined
    let posts = 0
    await page.route('**/api/platform/tenants', async (route) => {
      if (route.request().method() === 'POST') {
        posts++
        body = route.request().postDataJSON()
        const created = tenant({ id: 12, name: 'Slug Check', slug: 'slug-check' })
        state.list = [created]
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) })
      }
      return route.fallback()
    })

    await page.goto('/')
    await page.getByTestId('create-tenant-button').click()
    await page.getByTestId('create-tenant-name').fill('Slug Check')
    for (const [bad, msg] of [
      ['Bad Slug/한글', '영문 소문자·숫자·하이픈만 사용할 수 있습니다'],
      ['a'.repeat(65), '64자 이하로 입력하세요'],
    ]) {
      await page.getByTestId('create-tenant-slug').fill(bad)
      await page.getByTestId('create-tenant-submit').click()
      await expect(page.getByText(msg)).toBeVisible()
    }
    expect(posts).toBe(0)

    await page.getByTestId('create-tenant-slug').fill('slug-check')
    await page.getByTestId('create-tenant-submit').click()
    await expect(page.getByText('테넌트를 생성했습니다.')).toBeVisible()
    expect(body).toEqual({ name: 'Slug Check', slug: 'slug-check' })
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
    // 소유자 이메일은 비워둔다.
    await page.getByTestId('create-tenant-submit').click()

    await expect(page.getByText('테넌트를 생성했습니다.')).toBeVisible()
    // payload 에 name 만 있고 ownerUserId 키는 아예 없어야 한다.
    expect(body).toEqual({ name: 'Ownerless' })
    expect(body && 'ownerUserId' in body).toBe(false)
  })

  // (c-2) 소유자 이메일을 확인하면 찾은 사용자 id(number) 가 payload 에 실린다(WP-337).
  test('소유자 이메일을 확인하면 payload 에 ownerUserId 가 포함된다', async ({
    authenticatedPage: page,
  }) => {
    const state = await stubTenantList(page, [])
    await stubUserLookup(page, [KIM])
    const captured = await stubCreateTenant(page, state, tenant({ id: 12, name: 'Owned' }))

    await page.goto('/')
    await page.getByTestId('create-tenant-button').click()
    await page.getByTestId('create-tenant-name').fill('Owned')
    // 숫자 ID 가 아니라 이메일을 받는다 — 글자 입력이 막히지 않아야 한다(원래 버그).
    await page.getByTestId('create-tenant-owner').fill('KIM.ops@example.com')
    // Enter 는 폼 제출이 아니라 확인으로 동작한다.
    await page.getByTestId('create-tenant-owner').press('Enter')

    const found = page.getByTestId('create-tenant-owner-found')
    await expect(found).toContainText('김운영')
    await expect(found).toContainText('kim.ops@example.com')
    expect(captured.body).toBeUndefined()

    await page.getByTestId('create-tenant-submit').click()
    await expect(page.getByText('테넌트를 생성했습니다.')).toBeVisible()
    expect(captured.body).toEqual({ name: 'Owned', ownerUserId: 7 })
  })

  // (c-3) 없는 이메일 → 안내하고 생성을 막는다(소유자 없는 테넌트가 조용히 생기지 않게).
  test('없는 소유자 이메일이면 안내하고 생성을 막는다', async ({ authenticatedPage: page }) => {
    const state = await stubTenantList(page, [])
    await stubUserLookup(page, [KIM])
    const captured = await stubCreateTenant(page, state, tenant({ id: 13 }))

    await page.goto('/')
    await page.getByTestId('create-tenant-button').click()
    await page.getByTestId('create-tenant-name').fill('NoOwner')
    await page.getByTestId('create-tenant-owner').fill('nobody@example.com')
    await page.getByTestId('create-tenant-owner-check').click()

    await expect(page.getByText('해당 이메일의 사용자가 없습니다.', { exact: false })).toBeVisible()
    await page.getByTestId('create-tenant-submit').click()
    await expect(page.getByTestId('create-tenant-submit')).toBeVisible()
    expect(captured.body).toBeUndefined()
  })

  // (c-4) 이메일만 치고 확인하지 않음 → 확인을 요구한다. 확인 후 이메일을 고치면 결과가 초기화돼 다시 확인해야 한다.
  test('소유자 이메일을 확인하지 않으면 생성을 막고, 고치면 다시 확인해야 한다', async ({
    authenticatedPage: page,
  }) => {
    const state = await stubTenantList(page, [])
    await stubUserLookup(page, [KIM])
    const captured = await stubCreateTenant(page, state, tenant({ id: 14 }))

    await page.goto('/')
    await page.getByTestId('create-tenant-button').click()
    await page.getByTestId('create-tenant-name').fill('Unchecked')
    const owner = page.getByTestId('create-tenant-owner')
    await owner.fill('kim.ops@example.com')
    await page.getByTestId('create-tenant-submit').click()
    await expect(page.getByText('확인 버튼으로 이메일을 확인하세요.')).toBeVisible()
    expect(captured.body).toBeUndefined()

    await page.getByTestId('create-tenant-owner-check').click()
    await expect(page.getByTestId('create-tenant-owner-found')).toBeVisible()
    await owner.fill('kim.ops2@example.com')
    await expect(page.getByTestId('create-tenant-owner-found')).toHaveCount(0)
  })

  // (c-6) 앞뒤 공백이 붙은 이메일도 공백을 걷고 조회하며, 비어 있는 소유자 칸에서 Enter 는 그대로 제출한다.
  test('공백 붙은 소유자 이메일을 조회하고, 빈 칸 Enter 는 제출한다', async ({
    authenticatedPage: page,
  }) => {
    const state = await stubTenantList(page, [])
    const queried = await stubUserLookup(page, [KIM])
    const captured = await stubCreateTenant(page, state, tenant({ id: 15, name: 'Trim' }))

    await page.goto('/')
    await page.getByTestId('create-tenant-button').click()
    await page.getByTestId('create-tenant-name').fill('Trim')
    const owner = page.getByTestId('create-tenant-owner')
    await owner.fill(' kim.ops@example.com ')
    await page.getByTestId('create-tenant-owner-check').click()
    await expect(page.getByTestId('create-tenant-owner-found')).toBeVisible()
    expect(queried).toEqual(['kim.ops@example.com'])

    // 소유자를 비우고 그 칸에서 Enter → 소유자 없이 생성된다.
    await owner.fill('')
    await owner.press('Enter')
    await expect(page.getByText('테넌트를 생성했습니다.')).toBeVisible()
    expect(captured.body).toEqual({ name: 'Trim' })
  })

  // (c-7) 플랫폼 관리자는 배지와 함께 확인되고, 확인 후 소유자 칸 Enter 는 바로 제출한다.
  test('플랫폼 관리자 소유자는 배지를 보여주고, 확인 후 Enter 로 제출된다', async ({
    authenticatedPage: page,
  }) => {
    const state = await stubTenantList(page, [])
    await stubUserLookup(page, [OPERATOR])
    const captured = await stubCreateTenant(page, state, tenant({ id: 16, name: 'Op' }))

    await page.goto('/')
    await page.getByTestId('create-tenant-button').click()
    await page.getByTestId('create-tenant-name').fill('Op')
    const owner = page.getByTestId('create-tenant-owner')
    await owner.fill('op@example.com')
    await owner.press('Enter')
    const found = page.getByTestId('create-tenant-owner-found')
    await expect(found.getByTestId('platform-admin-badge')).toHaveText('플랫폼 관리자')
    // 확인 중에도 포커스가 입력칸에 남아 있다(readOnly).
    await expect(owner).toBeFocused()

    await owner.press('Enter')
    await expect(page.getByText('테넌트를 생성했습니다.')).toBeVisible()
    expect(captured.body).toEqual({ name: 'Op', ownerUserId: 1 })
  })

  // (c-8) 에이전트·비활성 계정은 확인 단계에서 바로 소유자 불가로 안내하고 생성을 막는다.
  test('에이전트·비활성 계정은 소유자로 지정할 수 없다', async ({ authenticatedPage: page }) => {
    const state = await stubTenantList(page, [])
    await stubUserLookup(page, [AGENT])
    const captured = await stubCreateTenant(page, state, tenant({ id: 17 }))

    await page.goto('/')
    await page.getByTestId('create-tenant-button').click()
    await page.getByTestId('create-tenant-name').fill('Bot')
    await page.getByTestId('create-tenant-owner').fill('bot@example.com')
    await page.getByTestId('create-tenant-owner-check').click()

    await expect(page.getByText('에이전트나 비활성 계정은 소유자로 지정할 수 없습니다.')).toBeVisible()
    await page.getByTestId('create-tenant-submit').click()
    await expect(page.getByTestId('create-tenant-submit')).toBeVisible()
    expect(captured.body).toBeUndefined()
  })

  // (c-5) 형식이 틀린 이메일은 조회하지 않고 형식 오류를 보여준다.
  test('형식이 틀린 소유자 이메일은 조회하지 않는다', async ({ authenticatedPage: page }) => {
    await stubTenantList(page, [])
    const queried = await stubUserLookup(page, [KIM])

    await page.goto('/')
    await page.getByTestId('create-tenant-button').click()
    await page.getByTestId('create-tenant-owner').fill('kim')
    await page.getByTestId('create-tenant-owner-check').click()

    await expect(page.getByText('올바른 이메일 형식이 아닙니다')).toBeVisible()
    expect(queried).toEqual([])
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
