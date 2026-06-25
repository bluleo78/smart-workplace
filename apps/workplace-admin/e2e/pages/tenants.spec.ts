import type { Page } from '@playwright/test'

import type { TenantSummary } from '../../src/types/platform'
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
    await page.getByTestId('create-tenant-owner').fill('1')
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
    // 소유자 ID 는 비워둔다.
    await page.getByTestId('create-tenant-submit').click()

    await expect(page.getByText('테넌트를 생성했습니다.')).toBeVisible()
    // payload 에 name 만 있고 ownerUserId 키는 아예 없어야 한다.
    expect(body).toEqual({ name: 'Ownerless' })
    expect(body && 'ownerUserId' in body).toBe(false)
  })

  // (c-2) 소유자를 채우면 payload 에 ownerUserId(number) 가 포함된다(#496).
  test('소유자를 채우면 payload 에 ownerUserId 가 포함된다', async ({ authenticatedPage: page }) => {
    const state = await stubTenantList(page, [])
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
    await page.getByTestId('create-tenant-owner').fill('7')
    await page.getByTestId('create-tenant-submit').click()

    await expect(page.getByText('테넌트를 생성했습니다.')).toBeVisible()
    // ownerUserId 가 number 7 로 포함돼야 한다(문자열 아님).
    expect(body).toEqual({ name: 'Owned', ownerUserId: 7 })
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
    await page.getByTestId('create-tenant-owner').fill('1')
    await page.getByTestId('create-tenant-submit').click()

    await expect(page.getByTestId('create-tenant-error')).toHaveText('이미 사용 중인 slug 입니다.')
    // 다이얼로그 유지 — 제출 버튼이 여전히 보인다.
    await expect(page.getByTestId('create-tenant-submit')).toBeVisible()
  })
})
