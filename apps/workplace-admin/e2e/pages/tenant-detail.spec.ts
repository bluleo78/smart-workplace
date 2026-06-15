import type { Page } from '@playwright/test'

import type { TenantDetail, TenantMember } from '../../src/types/platform'
import { expect, test } from '../fixtures/platform-auth.fixture'

// 테넌트 상세/멤버/정지·활성화 E2E.
// authenticatedPage 픽스처(인증 목 + catch-all 404) 위에서 구체 라우트를 나중에 등록(LIFO 우선)한다.
// 주의: 글롭 `**/api/platform/tenants/1` 은 `.../1/members` 를 매칭하지 않으므로(후행 와일드카드 없음)
//       단건/멤버/정지 라우트는 서로 독립이다.

function tenantDetail(overrides: Partial<TenantDetail> = {}): TenantDetail {
  return {
    id: 1,
    slug: 'acme',
    name: 'Acme Corp',
    status: 'ACTIVE',
    memberCount: 2,
    createdAt: '2026-01-15T09:00:00Z',
    ...overrides,
  }
}

function member(overrides: Partial<TenantMember> = {}): TenantMember {
  return {
    userId: 1,
    username: 'owner',
    name: '소유자',
    email: 'owner@example.com',
    role: 'OWNER',
    status: 'ACTIVE',
    ...overrides,
  }
}

/**
 * GET /tenants/1 를 mutable 상태로 스텁. 반환된 state 로 status 를 바꾸면
 * invalidate 후 재조회(2번째 GET)에 변경 상태가 반영된다.
 */
async function stubTenantDetail(page: Page, initial: TenantDetail) {
  const state = { tenant: initial }
  await page.route('**/api/platform/tenants/1', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(state.tenant),
      })
    }
    return route.fallback()
  })
  return state
}

// 멤버 목록 스텁(GET).
async function stubMembers(page: Page, members: TenantMember[]) {
  await page.route('**/api/platform/tenants/1/members', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(members),
    }),
  )
}

test.describe('테넌트 상세', () => {
  // (a) 상세 + 멤버 렌더
  test('테넌트 정보와 멤버를 렌더한다', async ({ authenticatedPage: page }) => {
    await stubTenantDetail(page, tenantDetail())
    await stubMembers(page, [
      member({ userId: 1, name: '소유자', role: 'OWNER' }),
      member({ userId: 2, name: '구성원', email: 'm@example.com', role: 'MEMBER' }),
    ])

    await page.goto('/tenants/1')

    await expect(page.getByTestId('tenant-detail-name')).toHaveText('Acme Corp')
    await expect(page.getByText('acme', { exact: true })).toBeVisible()
    await expect(page.getByTestId('tenant-status')).toHaveText('활성')
    // 슬러그 필드 레이블이 한국어로 표시돼야 한다 (회귀: #254)
    await expect(page.getByText('슬러그', { exact: true })).toBeVisible()

    const rows = page.getByTestId('member-row')
    await expect(rows).toHaveCount(2)
    // 이름 열
    await expect(page.getByRole('cell', { name: '소유자' }).first()).toBeVisible()
    await expect(page.getByRole('cell', { name: '구성원' })).toBeVisible()
    // role badge — 한국어 번역 표시 (refs #255)
    await expect(page.getByRole('cell', { name: '소유자' }).first()).toBeVisible()
    await expect(page.getByRole('cell', { name: '멤버' })).toBeVisible()
    // member status — 한국어 번역 표시 (refs #255)
    await expect(page.getByRole('cell', { name: '활성' }).first()).toBeVisible()
  })

  // (b) 정지: ACTIVE → 정지 클릭 → 확인 → POST suspend → 재조회로 SUSPENDED 반영
  test('정지하면 상태가 SUSPENDED 로 바뀐다', async ({ authenticatedPage: page }) => {
    const state = await stubTenantDetail(page, tenantDetail({ status: 'ACTIVE' }))
    await stubMembers(page, [member()])

    // POST /suspend — 200, 상태 토글(재조회 시 SUSPENDED).
    await page.route('**/api/platform/tenants/1/suspend', (route) => {
      if (route.request().method() === 'POST') {
        state.tenant = { ...state.tenant, status: 'SUSPENDED' }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(state.tenant),
        })
      }
      return route.fallback()
    })

    await page.goto('/tenants/1')
    await expect(page.getByTestId('tenant-status')).toHaveText('활성')

    await page.getByTestId('suspend-button').click()
    await page.getByTestId('confirm-suspend').click()

    // invalidate 후 재조회로 상태 badge 가 정지됨 으로 바뀐다(텍스트 변화 대기).
    await expect(page.getByTestId('tenant-status')).toHaveText('정지됨')
    await expect(page.getByText('테넌트를 정지했습니다.')).toBeVisible()
  })

  // (c) SUSPENDED → 활성화 버튼 노출(정지 버튼 대신)
  test('SUSPENDED 면 활성화 버튼을 노출한다', async ({ authenticatedPage: page }) => {
    await stubTenantDetail(page, tenantDetail({ status: 'SUSPENDED' }))
    await stubMembers(page, [member()])

    await page.goto('/tenants/1')

    await expect(page.getByTestId('tenant-status')).toHaveText('정지됨')
    await expect(page.getByTestId('activate-button')).toBeVisible()
    await expect(page.getByTestId('suspend-button')).toHaveCount(0)
  })

  // (d) 404 → "찾을 수 없습니다" 안내
  test('존재하지 않는 테넌트면 안내를 표시한다', async ({ authenticatedPage: page }) => {
    await page.route('**/api/platform/tenants/999', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ status: 404, error: 'Not Found', message: 'tenant not found' }),
      }),
    )

    await page.goto('/tenants/999')

    await expect(page.getByTestId('tenant-not-found')).toBeVisible()
    await expect(page.getByTestId('tenant-detail-name')).toHaveCount(0)
  })
})
