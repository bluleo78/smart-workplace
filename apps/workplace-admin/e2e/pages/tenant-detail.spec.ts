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
    quotaBytes: 10737418240,
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
    isPlatformOperator: false,
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

  // (a-2) 멤버 테이블 컬럼 분리: username(사용자 ID) 과 email 이 별도 열로 표시돼야 한다.
  test('멤버 테이블이 이름/사용자 ID/이메일을 분리해 보여준다', async ({ authenticatedPage: page }) => {
    await stubTenantDetail(page, tenantDetail())
    // username ≠ email 인 멤버를 포함해 두 컬럼이 독립적으로 검증된다.
    await stubMembers(page, [
      member({ userId: 1, username: 'a@x.kr', name: '홍길동', email: 'b@y.kr', role: 'MEMBER', status: 'ACTIVE' }),
    ])

    await page.goto('/tenants/1')

    const row = page.getByTestId('member-row').first()
    // 사용자 ID(username) 셀 — input 이 'a@x.kr'
    await expect(row.getByText('a@x.kr')).toBeVisible()
    // 이메일 셀 — output 은 'b@y.kr' (username 과 다른 값)
    await expect(row.getByText('b@y.kr')).toBeVisible()
    // 헤더에 "사용자 ID" 컬럼이 있어야 한다
    await expect(page.getByRole('columnheader', { name: '사용자 ID' })).toBeVisible()
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

  // (d) 드라이브 한도 수정 → PATCH 호출 + 성공 토스트
  test('드라이브 한도를 수정하면 PATCH 가 호출된다', async ({ authenticatedPage: page }) => {
    await stubTenantDetail(page, tenantDetail({ quotaBytes: 10737418240 }))
    await stubMembers(page, [member()])
    let body: unknown
    await page.route('**/api/platform/tenants/1/quota', (route) => {
      body = route.request().postDataJSON()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(tenantDetail({ quotaBytes: 5368709120 })),
      })
    })
    await page.goto('/tenants/1')
    await page.getByTestId('quota-gb-input').fill('5')
    await page.getByTestId('quota-save').click()
    await expect.poll(() => body).toEqual({ quotaBytes: 5368709120 })
    await expect(page.getByText('한도를 저장했습니다', { exact: false })).toBeVisible()
  })

  // (f) 멤버 추가(#497): 폼 입력 → POST payload 검증 → 201 → 목록/카운트 반영, 성공 토스트.
  test('멤버를 추가하면 목록과 카운트에 반영된다', async ({ authenticatedPage: page }) => {
    const detailState = await stubTenantDetail(page, tenantDetail({ memberCount: 1 }))
    // 멤버 목록을 mutable 로 스텁 — 추가 성공 시 새 멤버를 push 하고 memberCount 도 올려
    // invalidate→재조회로 변화가 보이게 한다.
    const membersState = { list: [member({ userId: 1, name: '소유자', role: 'OWNER' })] }
    await page.route('**/api/platform/tenants/1/members', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(membersState.list),
        })
      }
      return route.fallback()
    })

    let body: Record<string, unknown> | undefined
    await page.route('**/api/platform/tenants/1/members', async (route) => {
      if (route.request().method() === 'POST') {
        body = route.request().postDataJSON()
        const created = member({
          userId: 2,
          username: 'newbie@example.com',
          name: '신규멤버',
          email: 'newbie@example.com',
          role: 'MEMBER',
          status: 'ACTIVE',
        })
        membersState.list = [...membersState.list, created]
        detailState.tenant = { ...detailState.tenant, memberCount: 2 }
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(created),
        })
      }
      return route.fallback()
    })

    await page.goto('/tenants/1')
    await expect(page.getByTestId('member-row')).toHaveCount(1)
    await expect(page.getByTestId('tenant-member-count')).toHaveText('1')

    await page.getByTestId('add-member-button').click()
    await page.getByTestId('add-member-email').fill('newbie@example.com')
    await page.getByTestId('add-member-name').fill('신규멤버')
    await page.getByTestId('add-member-password').fill('Passw0rd')
    // 역할은 기본값 MEMBER 로 둔다.
    await page.getByTestId('add-member-submit').click()

    await expect(page.getByText('멤버를 추가했습니다.')).toBeVisible()
    // POST payload 검증 — {email, name, password, role}.
    expect(body).toEqual({
      email: 'newbie@example.com',
      name: '신규멤버',
      password: 'Passw0rd',
      role: 'MEMBER',
    })
    // invalidate→재조회로 멤버 행 2개 + 멤버수 2 반영.
    // 행 카운트는 ['tenant', id, 'members'], 멤버수 카드는 ['tenant', id] 무효화를 각각 검증한다.
    await expect(page.getByTestId('member-row')).toHaveCount(2)
    await expect(page.getByRole('cell', { name: '신규멤버' })).toBeVisible()
    await expect(page.getByTestId('tenant-member-count')).toHaveText('2')
  })

  // (g) 멤버 추가 — 역할 '소유자' 선택 → payload.role 이 OWNER 로 전송된다(#497).
  test('역할로 소유자를 선택하면 OWNER 로 전송된다', async ({ authenticatedPage: page }) => {
    await stubTenantDetail(page, tenantDetail())
    await stubMembers(page, [member()])
    let body: Record<string, unknown> | undefined
    await page.route('**/api/platform/tenants/1/members', async (route) => {
      if (route.request().method() === 'POST') {
        body = route.request().postDataJSON()
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(
            member({ userId: 3, name: '대표', email: 'boss@example.com', role: 'OWNER' }),
          ),
        })
      }
      return route.fallback()
    })

    await page.goto('/tenants/1')
    await page.getByTestId('add-member-button').click()
    await page.getByTestId('add-member-email').fill('boss@example.com')
    await page.getByTestId('add-member-name').fill('대표')
    await page.getByTestId('add-member-password').fill('Passw0rd')
    // 소유자(대표관리자) 라디오 선택.
    await page.getByTestId('add-member-role-owner').check()
    await page.getByTestId('add-member-submit').click()

    await expect(page.getByText('멤버를 추가했습니다.')).toBeVisible()
    expect(body?.role).toBe('OWNER')
  })

  // (h) 멤버 추가 — 이메일 중복(409) → 에러 표시, 다이얼로그 유지(#497).
  test('이메일이 중복이면 에러를 표시하고 다이얼로그를 유지한다', async ({
    authenticatedPage: page,
  }) => {
    await stubTenantDetail(page, tenantDetail())
    await stubMembers(page, [member()])
    await page.route('**/api/platform/tenants/1/members', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 409,
            error: 'Conflict',
            message: '이미 사용 중인 이메일입니다.',
          }),
        })
      }
      return route.fallback()
    })

    await page.goto('/tenants/1')
    await page.getByTestId('add-member-button').click()
    await page.getByTestId('add-member-email').fill('dup@example.com')
    await page.getByTestId('add-member-name').fill('중복')
    await page.getByTestId('add-member-password').fill('Passw0rd')
    await page.getByTestId('add-member-submit').click()

    await expect(page.getByTestId('add-member-error')).toHaveText('이미 사용 중인 이메일입니다.')
    // 다이얼로그 유지 — 제출 버튼이 여전히 보인다.
    await expect(page.getByTestId('add-member-submit')).toBeVisible()
  })

  // (i) 멤버 추가 — 비밀번호 규칙 위반 시 인라인 검증 에러(#497).
  test('비밀번호 규칙 위반 시 인라인 에러를 표시한다', async ({ authenticatedPage: page }) => {
    await stubTenantDetail(page, tenantDetail())
    await stubMembers(page, [member()])

    await page.goto('/tenants/1')
    await page.getByTestId('add-member-button').click()
    await page.getByTestId('add-member-email').fill('weak@example.com')
    await page.getByTestId('add-member-name').fill('약한비번')
    // 대문자/숫자 없는 8자 미만 비밀번호.
    await page.getByTestId('add-member-password').fill('abc')
    await page.getByTestId('add-member-submit').click()

    // zod 인라인 검증 메시지가 보이고, 다이얼로그는 닫히지 않는다.
    await expect(page.getByText('비밀번호는 8자 이상이어야 합니다')).toBeVisible()
    await expect(page.getByTestId('add-member-submit')).toBeVisible()
  })

  // (e) 404 → "찾을 수 없습니다" 안내
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

  // (j) 운영자 핀 — isPlatformOperator=true 멤버에만 핀이 표시된다.
  test('운영자 계정 멤버는 핀이 표시되고 원본이 보인다', async ({ authenticatedPage: page }) => {
    await stubTenantDetail(page, tenantDetail())
    await stubMembers(page, [
      member({ userId: 1, username: 'm***@c***.com', name: '홍**', email: 'm***@c***.com', role: 'MEMBER', status: 'ACTIVE', isPlatformOperator: false }),
      member({ userId: 2, username: 'op@corp.com', name: '운영자김', email: 'op@corp.com', role: 'MEMBER', status: 'ACTIVE', isPlatformOperator: true }),
    ])

    await page.goto('/tenants/1')

    // 운영자 멤버 행에는 핀이 표시된다.
    const opRow = page.getByTestId('member-row').filter({ hasText: '운영자김' })
    await expect(opRow.getByTestId('operator-pin')).toBeVisible()

    // 일반(마스킹) 멤버 행에는 핀이 없다.
    const maskedRow = page.getByTestId('member-row').filter({ hasText: '홍**' })
    await expect(maskedRow.getByTestId('operator-pin')).toHaveCount(0)
  })
})
