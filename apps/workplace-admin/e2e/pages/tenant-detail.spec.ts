import type { Page } from '@playwright/test'

import type { TenantDetail, TenantMember } from '../../src/types/platform'
import { expectTheme, textContrast, withTheme } from '../fixtures/contrast'
import { expect, test } from '../fixtures/platform-auth.fixture'

// 테넌트 상세/멤버/정지·활성화 E2E.
// authenticatedPage 픽스처(인증 목 + catch-all 404) 위에서 구체 라우트를 나중에 등록(LIFO 우선)한다.
// 주의: 글롭 `**/api/platform/tenants/7` 은 `.../1/members` 를 매칭하지 않으므로(후행 와일드카드 없음)
//       단건/멤버/정지 라우트는 서로 독립이다.

function tenantDetail(overrides: Partial<TenantDetail> = {}): TenantDetail {
  return {
    // 기본 테넌트(id=1)는 deletable=false 라 위험 구역이 숨겨지므로(WP-341) 일반 테넌트 id 를 쓴다.
    id: 7,
    slug: 'acme',
    name: 'Acme Corp',
    status: 'ACTIVE',
    memberCount: 2,
    createdAt: '2026-01-15T09:00:00Z',
    quotaBytes: 10737418240,
    deletedAt: null,
    purgeError: null,
    deletable: true,
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
 * GET /tenants/7 를 mutable 상태로 스텁. 반환된 state 로 status 를 바꾸면
 * invalidate 후 재조회(2번째 GET)에 변경 상태가 반영된다.
 */
async function stubTenantDetail(page: Page, initial: TenantDetail) {
  const state = { tenant: initial }
  await page.route('**/api/platform/tenants/7', (route) => {
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
  await page.route('**/api/platform/tenants/7/members', (route) =>
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

    await page.goto('/tenants/7')

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

    await page.goto('/tenants/7')

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
    await page.route('**/api/platform/tenants/7/suspend', (route) => {
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

    await page.goto('/tenants/7')
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

    await page.goto('/tenants/7')

    await expect(page.getByTestId('tenant-status')).toHaveText('정지됨')
    await expect(page.getByTestId('activate-button')).toBeVisible()
    await expect(page.getByTestId('suspend-button')).toHaveCount(0)
  })

  // WP-303: "정지됨" 경고 배지(Badge warning) 글자 대비가 라이트·다크 모두 AA(4.5:1) 이상.
  for (const theme of ['light', 'dark'] as const) {
    test(`정지됨 배지 글자 대비가 AA 이상이다 — ${theme} (WP-303)`, async ({ authenticatedPage: page }) => {
      await withTheme(page, theme)
      await stubTenantDetail(page, tenantDetail({ status: 'SUSPENDED' }))
      await stubMembers(page, [member()])

      await page.goto('/tenants/7')
      const badge = page.getByTestId('tenant-status')
      await expect(badge).toHaveText('정지됨')
      await expectTheme(page, theme)
      // 배지는 color 트랜지션이 있어 테마 적용 직후 값이 중간색일 수 있다 — 조건 대기로 잰다.
      await expect.poll(() => textContrast(badge)).toBeGreaterThanOrEqual(4.5)
    })
  }

  // (d) 드라이브 한도 수정 → PATCH 호출 + 성공 토스트
  test('드라이브 한도를 수정하면 PATCH 가 호출된다', async ({ authenticatedPage: page }) => {
    await stubTenantDetail(page, tenantDetail({ quotaBytes: 10737418240 }))
    await stubMembers(page, [member()])
    let body: unknown
    await page.route('**/api/platform/tenants/7/quota', (route) => {
      body = route.request().postDataJSON()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(tenantDetail({ quotaBytes: 5368709120 })),
      })
    })
    await page.goto('/tenants/7')
    // 테넌트 상세가 async 로드된 뒤 useEffect 가 입력을 현재 한도(10GB)로 채운다. 그 전에 fill 하면
    // 로드가 fill 을 덮어써(예: '10'+'5'='105') 비결정 실패한다 → 로드 완료(값 '10')를 기다린 뒤 fill.
    await expect(page.getByTestId('quota-gb-input')).toHaveValue('10')
    await page.getByTestId('quota-gb-input').fill('5')
    await page.getByTestId('quota-save').click()
    await expect.poll(() => body).toEqual({ quotaBytes: 5368709120 })
    await expect(page.getByText('한도를 저장했습니다', { exact: false })).toBeVisible()
  })

  // (f) 멤버 추가 — 이메일 확인(못 찾음) → 폼 입력 → POST payload 검증 → 201 → 목록/카운트 반영, 성공 토스트.
  test('이메일 확인 후 신규 사용자를 추가하면 목록과 카운트에 반영된다', async ({
    authenticatedPage: page,
  }) => {
    const detailState = await stubTenantDetail(page, tenantDetail({ memberCount: 1 }))
    const membersState = { list: [member({ userId: 1, name: '소유자', role: 'OWNER' })] }
    await page.route('**/api/platform/tenants/7/members', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(membersState.list),
        })
      }
      return route.fallback()
    })
    await page.route('**/api/platform/users/lookup*', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ status: 404, error: 'Not Found', message: 'not found' }),
      }),
    )

    let body: Record<string, unknown> | undefined
    await page.route('**/api/platform/tenants/7/members', async (route) => {
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

    await page.goto('/tenants/7')
    await expect(page.getByTestId('member-row')).toHaveCount(1)
    await expect(page.getByTestId('tenant-member-count')).toHaveText('1')

    await page.getByTestId('add-member-button').click()
    await page.getByTestId('add-member-email').fill('newbie@example.com')
    await page.getByTestId('add-member-check').click()
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
    await expect(page.getByTestId('member-row')).toHaveCount(2)
    await expect(page.getByRole('cell', { name: '신규멤버' })).toBeVisible()
    await expect(page.getByTestId('tenant-member-count')).toHaveText('2')
  })

  // (g) 멤버 추가 — 역할 '소유자' 선택 → payload.role 이 OWNER 로 전송된다.
  test('역할로 소유자를 선택하면 OWNER 로 전송된다', async ({ authenticatedPage: page }) => {
    await stubTenantDetail(page, tenantDetail())
    await stubMembers(page, [member()])
    await page.route('**/api/platform/users/lookup*', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ status: 404, error: 'Not Found', message: 'not found' }),
      }),
    )
    let body: Record<string, unknown> | undefined
    await page.route('**/api/platform/tenants/7/members', async (route) => {
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

    await page.goto('/tenants/7')
    await page.getByTestId('add-member-button').click()
    await page.getByTestId('add-member-email').fill('boss@example.com')
    await page.getByTestId('add-member-check').click()
    await page.getByTestId('add-member-name').fill('대표')
    await page.getByTestId('add-member-password').fill('Passw0rd')
    // 소유자(대표관리자) 라디오 선택.
    await page.getByTestId('add-member-role-owner').check()
    await page.getByTestId('add-member-submit').click()

    await expect(page.getByText('멤버를 추가했습니다.')).toBeVisible()
    expect(body?.role).toBe('OWNER')
  })

  // (h) 멤버 추가 — 이메일 확인 시점엔 없었지만(레이스) 제출 시 409 → 에러 표시, 다이얼로그 유지.
  test('제출 시 이메일 중복(409)이면 에러를 표시하고 다이얼로그를 유지한다', async ({
    authenticatedPage: page,
  }) => {
    await stubTenantDetail(page, tenantDetail())
    await stubMembers(page, [member()])
    await page.route('**/api/platform/users/lookup*', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ status: 404, error: 'Not Found', message: 'not found' }),
      }),
    )
    await page.route('**/api/platform/tenants/7/members', (route) => {
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

    await page.goto('/tenants/7')
    await page.getByTestId('add-member-button').click()
    await page.getByTestId('add-member-email').fill('dup@example.com')
    await page.getByTestId('add-member-check').click()
    await page.getByTestId('add-member-name').fill('중복')
    await page.getByTestId('add-member-password').fill('Passw0rd')
    await page.getByTestId('add-member-submit').click()

    await expect(page.getByTestId('add-member-error')).toHaveText('이미 사용 중인 이메일입니다.')
    // 다이얼로그 유지 — 제출 버튼이 여전히 보인다.
    await expect(page.getByTestId('add-member-submit')).toBeVisible()
  })

  // (i) 멤버 추가 — 비밀번호 규칙 위반 시 인라인 검증 에러.
  test('비밀번호 규칙 위반 시 인라인 에러를 표시한다', async ({ authenticatedPage: page }) => {
    await stubTenantDetail(page, tenantDetail())
    await stubMembers(page, [member()])
    await page.route('**/api/platform/users/lookup*', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ status: 404, error: 'Not Found', message: 'not found' }),
      }),
    )

    await page.goto('/tenants/7')
    await page.getByTestId('add-member-button').click()
    await page.getByTestId('add-member-email').fill('weak@example.com')
    await page.getByTestId('add-member-check').click()
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

    await page.goto('/tenants/7')

    // 운영자 멤버 행에는 핀이 표시된다.
    const opRow = page.getByTestId('member-row').filter({ hasText: '운영자김' })
    await expect(opRow.getByTestId('operator-pin')).toBeVisible()

    // 일반(마스킹) 멤버 행에는 핀이 없다.
    const maskedRow = page.getByTestId('member-row').filter({ hasText: '홍**' })
    await expect(maskedRow.getByTestId('operator-pin')).toHaveCount(0)
  })

  // (k) 기존 사용자 추가 — 이메일 확인 시 찾으면 계정 생성 없이 멤버십만 추가한다.
  test('이메일 확인 시 기존 사용자를 찾으면 계정 생성 없이 추가한다', async ({
    authenticatedPage: page,
  }) => {
    const detailState = await stubTenantDetail(page, tenantDetail({ memberCount: 1 }))
    const membersState = { list: [member({ userId: 1, name: '소유자', role: 'OWNER' })] }
    await page.route('**/api/platform/tenants/7/members', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(membersState.list),
        })
      }
      return route.fallback()
    })
    await page.route('**/api/platform/users/lookup*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          userId: 5,
          name: '기존사용자',
          email: 'existing@example.com',
          isPlatformAdmin: false,
          ownerEligible: true,
        }),
      }),
    )
    let body: Record<string, unknown> | undefined
    await page.route('**/api/platform/tenants/7/members/existing', (route) => {
      body = route.request().postDataJSON()
      const created = member({
        userId: 5,
        username: 'existing@example.com',
        name: '기존사용자',
        email: 'existing@example.com',
        role: 'MEMBER',
      })
      membersState.list = [...membersState.list, created]
      detailState.tenant = { ...detailState.tenant, memberCount: 2 }
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(created),
      })
    })

    await page.goto('/tenants/7')
    await page.getByTestId('add-member-button').click()
    await page.getByTestId('add-member-email').fill('existing@example.com')
    await page.getByTestId('add-member-check').click()

    await expect(page.getByTestId('add-member-found-card')).toContainText('기존사용자')
    // 이름/비밀번호 입력란은 노출되지 않는다 — 계정 생성 없이 추가.
    await expect(page.getByTestId('add-member-name')).toHaveCount(0)
    await page.getByTestId('add-member-submit').click()

    await expect(page.getByText('멤버를 추가했습니다.')).toBeVisible()
    expect(body).toEqual({ userId: 5, role: 'MEMBER' })
    await expect(page.getByTestId('member-row')).toHaveCount(2)
    await expect(page.getByTestId('tenant-member-count')).toHaveText('2')
  })

  // (l) 기존 사용자 추가 — 이미 이 테넌트의 멤버면 409 → 에러 표시, 다이얼로그 유지.
  test('기존 사용자가 이미 멤버면 에러를 표시하고 다이얼로그를 유지한다', async ({
    authenticatedPage: page,
  }) => {
    await stubTenantDetail(page, tenantDetail())
    await stubMembers(page, [member()])
    await page.route('**/api/platform/users/lookup*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          userId: 1,
          name: '소유자',
          email: 'owner@example.com',
          isPlatformAdmin: false,
          ownerEligible: true,
        }),
      }),
    )
    await page.route('**/api/platform/tenants/7/members/existing', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 409,
          error: 'Conflict',
          message: '이미 이 테넌트의 멤버입니다.',
        }),
      }),
    )

    await page.goto('/tenants/7')
    await page.getByTestId('add-member-button').click()
    await page.getByTestId('add-member-email').fill('owner@example.com')
    await page.getByTestId('add-member-check').click()
    await expect(page.getByTestId('add-member-found-card')).toBeVisible()
    await page.getByTestId('add-member-submit').click()

    await expect(page.getByTestId('add-member-error')).toHaveText('이미 이 테넌트의 멤버입니다.')
    await expect(page.getByTestId('add-member-submit')).toBeVisible()
  })

  // (m) 확인 후 이메일을 수정하면 재확인이 필요하다(오래된 조회 결과 방지).
  test('확인 후 이메일을 수정하면 재확인이 필요하다', async ({ authenticatedPage: page }) => {
    await stubTenantDetail(page, tenantDetail())
    await stubMembers(page, [member()])
    await page.route('**/api/platform/users/lookup*', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ status: 404, error: 'Not Found', message: 'not found' }),
      }),
    )

    await page.goto('/tenants/7')
    await page.getByTestId('add-member-button').click()
    await page.getByTestId('add-member-email').fill('a@example.com')
    await page.getByTestId('add-member-check').click()
    await expect(page.getByTestId('add-member-name')).toBeVisible()

    await page.getByTestId('add-member-email').fill('b@example.com')
    await expect(page.getByTestId('add-member-name')).toHaveCount(0)
  })
  // WP-336: 편집 → PATCH payload 검증 → 재조회로 이름·slug 반영 + 성공 토스트.
  test('테넌트 이름·slug 를 편집하면 PATCH 후 화면에 반영된다', async ({ authenticatedPage: page }) => {
    const state = await stubTenantDetail(page, tenantDetail())
    await stubMembers(page, [member()])
    let body: unknown
    await page.route('**/api/platform/tenants/7', (route) => {
      if (route.request().method() === 'PATCH') {
        body = route.request().postDataJSON()
        state.tenant = { ...state.tenant, name: '주식회사 아이에이클라우드 솔루션즈 코리아', slug: 'iacloud-solutions-korea' }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.tenant) })
      }
      return route.fallback()
    })

    await page.goto('/tenants/7')
    await page.getByTestId('edit-tenant-button').click()
    // 다이얼로그는 현재 값으로 채워져 열린다.
    await expect(page.getByTestId('edit-tenant-name')).toHaveValue('Acme Corp')
    await expect(page.getByTestId('edit-tenant-slug')).toHaveValue('acme')

    await page.getByTestId('edit-tenant-name').fill('주식회사 아이에이클라우드 솔루션즈 코리아')
    await page.getByTestId('edit-tenant-slug').fill('iacloud-solutions-korea')
    await page.getByTestId('edit-tenant-submit').click()

    await expect.poll(() => body).toEqual({
      name: '주식회사 아이에이클라우드 솔루션즈 코리아',
      slug: 'iacloud-solutions-korea',
    })
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('tenant-detail-name')).toHaveText('주식회사 아이에이클라우드 솔루션즈 코리아')
    await expect(page.getByText('iacloud-solutions-korea')).toBeVisible()
    await expect(page.getByText('테넌트 정보를 저장했습니다.')).toBeVisible()
  })

  // WP-336: 서버 400(slug 중복)은 다이얼로그 안에 메시지로 보이고 닫히지 않는다.
  test('slug 중복이면 다이얼로그에 서버 메시지를 보여준다', async ({ authenticatedPage: page }) => {
    await stubTenantDetail(page, tenantDetail())
    await stubMembers(page, [member()])
    await page.route('**/api/platform/tenants/7', (route) => {
      if (route.request().method() === 'PATCH') {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ status: 400, message: '이미 사용 중인 slug 입니다: taken' }),
        })
      }
      return route.fallback()
    })

    await page.goto('/tenants/7')
    await page.getByTestId('edit-tenant-button').click()
    await expect(page.getByTestId('edit-tenant-slug')).toHaveValue('acme')
    await page.getByTestId('edit-tenant-slug').fill('taken')
    await page.getByTestId('edit-tenant-submit').click()

    await expect(page.getByTestId('edit-tenant-error')).toHaveText('이미 사용 중인 slug 입니다: taken')
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  // WP-336: 이름 공백·slug 형식 위반은 요청 없이 필드 에러로 막는다.
  test('이름이 비었거나 slug 형식이 틀리면 저장하지 않는다', async ({ authenticatedPage: page }) => {
    await stubTenantDetail(page, tenantDetail())
    await stubMembers(page, [member()])
    let patched = false
    await page.route('**/api/platform/tenants/7', (route) => {
      if (route.request().method() === 'PATCH') patched = true
      return route.fallback()
    })

    await page.goto('/tenants/7')
    await page.getByTestId('edit-tenant-button').click()
    await expect(page.getByTestId('edit-tenant-name')).toHaveValue('Acme Corp')
    await page.getByTestId('edit-tenant-name').fill('   ')
    await page.getByTestId('edit-tenant-slug').fill('Upper_Case')
    await page.getByTestId('edit-tenant-submit').click()

    await expect(page.getByText('이름을 입력하세요')).toBeVisible()
    await expect(page.getByText('영문 소문자·숫자·하이픈만 사용할 수 있습니다')).toBeVisible()
    expect(patched).toBe(false)
  })

  // WP-341: 위험 구역 — 삭제하면 삭제됨 배너·복원·영구 삭제가 나오고 편집 UI 는 잠긴다.
  test('활성 테넌트 삭제 → 삭제됨 배너·복원·영구 삭제 노출, 편집 비활성', async ({ authenticatedPage: page }) => {
    const state = await stubTenantDetail(page, tenantDetail())
    await stubMembers(page, [member()])
    await page.route('**/api/platform/tenants/7/delete', (route) => {
      state.tenant = { ...state.tenant, status: 'DELETED', deletedAt: '2026-10-12T01:00:00Z' }
      return route.fulfill({ status: 204 })
    })
    await page.goto('/tenants/7')
    await page.getByTestId('danger-zone').getByTestId('delete-button').click()
    await page.getByTestId('confirm-delete').click()
    await expect(page.getByTestId('tenant-deleted-banner')).toContainText('2026-10-12에 삭제된 테넌트입니다')
    await expect(page.getByTestId('restore-button')).toBeVisible()
    await expect(page.getByTestId('purge-button')).toBeVisible()
    await expect(page.getByTestId('suspend-button')).toHaveCount(0)
    // 삭제된 테넌트는 이름·slug 편집 불가(서버 409) — 편집 버튼 자체를 숨긴다.
    await expect(page.getByTestId('edit-tenant-button')).toHaveCount(0)
    await expect(page.getByTestId('add-member-button')).toBeDisabled()
    await expect(page.getByTestId('quota-save')).toBeDisabled()
  })

  // WP-341: 기본 테넌트(id=1)는 회원가입 귀속 대상이라 삭제할 수 없다 — 위험 구역(삭제 버튼)을 렌더하지 않는다.
  test('기본 테넌트(id=1)는 위험 구역과 삭제 버튼을 보여주지 않는다', async ({ authenticatedPage: page }) => {
    await page.route('**/api/platform/tenants/1', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(tenantDetail({ id: 1, slug: 'default', name: 'Default Workspace', deletable: false })),
      }),
    )
    await page.route('**/api/platform/tenants/1/members', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([member()]) }),
    )
    await page.goto('/tenants/1')
    await expect(page.getByTestId('tenant-status')).toHaveText('활성')
    // 정지 등 다른 운영 액션은 그대로 노출된다.
    await expect(page.getByTestId('suspend-button')).toBeVisible()
    await expect(page.getByTestId('danger-zone')).toHaveCount(0)
    await expect(page.getByTestId('delete-button')).toHaveCount(0)
  })

  // WP-341: 삭제 실패 시 서버 메시지를 토스트로 보여준다.
  test('삭제가 거부되면 서버 메시지를 토스트로 보여준다', async ({ authenticatedPage: page }) => {
    await stubTenantDetail(page, tenantDetail())
    await stubMembers(page, [member()])
    await page.route('**/api/platform/tenants/7/delete', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ message: '이미 삭제된 테넌트입니다.' }),
      }),
    )
    await page.goto('/tenants/7')
    await page.getByTestId('delete-button').click()
    await page.getByTestId('confirm-delete').click()
    await expect(page.getByText('이미 삭제된 테넌트입니다.')).toBeVisible()
    await expect(page.getByTestId('tenant-status')).toHaveText('활성')
  })

  test('복원하면 활성으로 돌아온다', async ({ authenticatedPage: page }) => {
    const state = await stubTenantDetail(page, tenantDetail({ status: 'DELETED', deletedAt: '2026-10-12T01:00:00Z' }))
    await stubMembers(page, [member()])
    await page.route('**/api/platform/tenants/7/restore', (route) => {
      state.tenant = { ...state.tenant, status: 'ACTIVE', deletedAt: null }
      return route.fulfill({ status: 204 })
    })
    await page.goto('/tenants/7')
    // 삭제된 상태로 진입하면 편집 버튼이 없고, 복원 후 다시 나타난다.
    await expect(page.getByTestId('edit-tenant-button')).toHaveCount(0)
    await page.getByTestId('restore-button').click()
    await expect(page.getByTestId('tenant-status')).toHaveText('활성')
    await expect(page.getByTestId('tenant-deleted-banner')).toHaveCount(0)
    await expect(page.getByTestId('edit-tenant-button')).toBeVisible()
  })

  test('영구 삭제 다이얼로그 — 이름이 정확해야 버튼 활성, 요청 후 진행 중 표시', async ({ authenticatedPage: page }) => {
    const state = await stubTenantDetail(page, tenantDetail({ status: 'DELETED', deletedAt: '2026-10-12T01:00:00Z' }))
    await stubMembers(page, [member()])
    let body: unknown
    await page.route('**/api/platform/tenants/7/purge', (route) => {
      body = route.request().postDataJSON()
      state.tenant = { ...state.tenant, status: 'PURGING' }
      return route.fulfill({ status: 202 })
    })
    await page.goto('/tenants/7')
    await page.getByTestId('purge-button').click()
    const dialog = page.getByTestId('purge-dialog')
    await expect(dialog).toContainText('되돌릴 수 없습니다')
    await dialog.getByTestId('purge-confirm-input').fill('Acme')
    await expect(dialog.getByTestId('purge-confirm')).toBeDisabled()
    // 대소문자가 다르면 거부(서버와 같은 대소문자 구분 비교).
    await dialog.getByTestId('purge-confirm-input').fill('acme corp')
    await expect(dialog.getByTestId('purge-confirm')).toBeDisabled()
    await dialog.getByTestId('purge-confirm-input').fill('Acme Corp')
    await dialog.getByTestId('purge-confirm').click()
    await expect(page.getByTestId('tenant-purging-banner')).toBeVisible()
    expect(body).toEqual({ confirmName: 'Acme Corp' })
    await expect(page.getByTestId('restore-button')).toBeDisabled()
    await expect(page.getByTestId('danger-zone')).toHaveCount(0)
  })

  test('저장된 이름에 앞뒤 공백이 있어도 trim 한 이름으로 영구 삭제 확인이 된다', async ({ authenticatedPage: page }) => {
    await stubTenantDetail(page, tenantDetail({ name: 'Acme ', status: 'DELETED', deletedAt: '2026-10-12T01:00:00Z' }))
    await stubMembers(page, [])
    await page.goto('/tenants/7')
    await page.getByTestId('purge-button').click()
    const dialog = page.getByTestId('purge-dialog')
    await dialog.getByTestId('purge-confirm-input').fill('Acme')
    await expect(dialog.getByTestId('purge-confirm')).toBeEnabled()
  })

  test('영구 삭제 중 단계 재시도 오류가 있으면 배너에 함께 표시한다', async ({ authenticatedPage: page }) => {
    await stubTenantDetail(page, tenantDetail({ status: 'PURGING', deletedAt: '2026-10-12T01:00:00Z',
      purgeError: '파일 삭제 실패' }))
    await stubMembers(page, [])
    await page.goto('/tenants/7')
    await expect(page.getByTestId('tenant-purging-banner')).toContainText(
      '마지막 시도 오류: 파일 삭제 실패. 자동으로 다시 시도합니다.',
    )
  })

  test('영구 삭제 중 → 404 가 되면 완료 토스트 후 삭제됨 탭으로 이동', async ({ authenticatedPage: page }) => {
    let calls = 0
    await page.route('**/api/platform/tenants/7', (route) => {
      calls += 1
      if (calls === 1) {
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify(tenantDetail({ status: 'PURGING', deletedAt: '2026-10-12T01:00:00Z' })) })
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ status: 404, error: 'Not Found', message: 'x' }) })
    })
    await stubMembers(page, [])
    await page.goto('/tenants/7')
    await expect(page.getByText('영구 삭제가 완료되었습니다')).toBeVisible({ timeout: 10_000 })
    await expect(page).toHaveURL(/\/\?view=deleted$/)
  })

  test('영구 삭제 요청 직후 첫 재조회가 바로 404 여도 완료 처리된다', async ({ authenticatedPage: page }) => {
    // 잡이 요청 직후 끝나 PURGING 을 한 번도 못 본 경우 — 캐시 상태는 DELETED 인 채 재조회가 404.
    let purged = false
    await page.route('**/api/platform/tenants/7', (route) => {
      if (purged) {
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ status: 404, error: 'Not Found', message: 'x' }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(tenantDetail({ status: 'DELETED', deletedAt: '2026-10-12T01:00:00Z' })) })
    })
    await page.route('**/api/platform/tenants/7/purge', (route) => {
      purged = true
      return route.fulfill({ status: 202 })
    })
    await stubMembers(page, [])
    await page.goto('/tenants/7')
    await page.getByTestId('purge-button').click()
    const dialog = page.getByTestId('purge-dialog')
    await dialog.getByTestId('purge-confirm-input').fill('Acme Corp')
    await dialog.getByTestId('purge-confirm').click()
    await expect(page.getByText('영구 삭제가 완료되었습니다')).toBeVisible({ timeout: 10_000 })
    await expect(page).toHaveURL(/\/\?view=deleted$/)
  })

  test('지난 영구 삭제 실패 사유와 다시 시도', async ({ authenticatedPage: page }) => {
    await stubTenantDetail(page, tenantDetail({ status: 'DELETED', deletedAt: '2026-10-12T01:00:00Z',
      purgeError: '잔여 데이터 확인 실패: conversation_attention 3행' }))
    await stubMembers(page, [])
    await page.goto('/tenants/7')
    await expect(page.getByTestId('tenant-deleted-banner')).toContainText('conversation_attention 3행')
    await expect(page.getByTestId('purge-button')).toHaveText('영구 삭제 다시 시도')
  })

  // S1: 영구 삭제 다이얼로그 조사 — 받침 유무에 따라 을/를, 조사 앞 공백 없음.
  test('영구 삭제 다이얼로그 문구는 조사를 붙여 쓴다', async ({ authenticatedPage: page }) => {
    await stubTenantDetail(page, tenantDetail({ name: '그린랩 코리아', status: 'DELETED', deletedAt: '2026-10-12T01:00:00Z' }))
    await stubMembers(page, [])
    await page.goto('/tenants/7')
    await page.getByTestId('purge-button').click()
    const dialog = page.getByTestId('purge-dialog')
    await expect(dialog.getByRole('heading')).toHaveText('그린랩 코리아를 영구 삭제할까요?')
    await expect(dialog.locator('label')).toHaveText('확인을 위해 그린랩 코리아를 입력하세요')
  })

  // S4: 영구 삭제 다이얼로그 — 입력란 자동 포커스, 이름 일치 시에만 Enter 로 제출.
  test('영구 삭제 다이얼로그는 입력란에 포커스하고 Enter 로 제출한다', async ({ authenticatedPage: page }) => {
    const state = await stubTenantDetail(page, tenantDetail({ status: 'DELETED', deletedAt: '2026-10-12T01:00:00Z' }))
    await stubMembers(page, [])
    const bodies: unknown[] = []
    await page.route('**/api/platform/tenants/7/purge', (route) => {
      bodies.push(route.request().postDataJSON())
      state.tenant = { ...state.tenant, status: 'PURGING' }
      return route.fulfill({ status: 202 })
    })
    await page.goto('/tenants/7')
    await page.getByTestId('purge-button').click()
    const dialog = page.getByTestId('purge-dialog')
    const input = dialog.getByTestId('purge-confirm-input')
    await expect(input).toBeFocused()
    // 이름 불일치 Enter 는 무시.
    await input.fill('Acme')
    await page.keyboard.press('Enter')
    await expect(dialog).toBeVisible()
    expect(bodies).toEqual([])
    // 일치하면 Enter 로 제출.
    await input.fill('Acme Corp')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('tenant-purging-banner')).toBeVisible()
    expect(bodies).toEqual([{ confirmName: 'Acme Corp' }])
  })

  // S5: 확인 다이얼로그를 닫으면 포커스가 트리거 버튼으로 돌아온다(삭제·영구 삭제·정지).
  test('확인 다이얼로그를 닫으면 포커스가 트리거 버튼으로 돌아온다', async ({ authenticatedPage: page }) => {
    await stubTenantDetail(page, tenantDetail())
    await stubMembers(page, [])
    await page.goto('/tenants/7')
    for (const id of ['delete-button', 'suspend-button']) {
      await page.getByTestId(id).click()
      await expect(page.getByRole('alertdialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('alertdialog')).toHaveCount(0)
      await expect(page.getByTestId(id)).toBeFocused()
    }
  })

  test('영구 삭제 다이얼로그를 닫으면 포커스가 영구 삭제 버튼으로 돌아온다', async ({ authenticatedPage: page }) => {
    await stubTenantDetail(page, tenantDetail({ status: 'DELETED', deletedAt: '2026-10-12T01:00:00Z' }))
    await stubMembers(page, [])
    await page.goto('/tenants/7')
    await page.getByTestId('purge-button').click()
    await expect(page.getByTestId('purge-dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('purge-dialog')).toHaveCount(0)
    await expect(page.getByTestId('purge-button')).toBeFocused()
  })

  // S6: 삭제 확인 다이얼로그가 대상 테넌트 이름을 보여준다.
  test('삭제 확인 다이얼로그에 대상 테넌트 이름이 나온다', async ({ authenticatedPage: page }) => {
    await stubTenantDetail(page, tenantDetail({ name: '그린랩 코리아' }))
    await stubMembers(page, [])
    await page.goto('/tenants/7')
    await page.getByTestId('delete-button').click()
    await expect(page.getByRole('alertdialog').getByRole('heading')).toHaveText('그린랩 코리아를 삭제할까요?')
  })

  // M1: 삭제됨·영구 삭제 중 배너와 "영구 삭제 중…" 배지 글자 대비가 라이트·다크 모두 AA(4.5:1) 이상.
  for (const theme of ['light', 'dark'] as const) {
    test(`삭제됨·영구 삭제 중 배너와 info 배지 대비가 AA 이상이다 — ${theme} (WP-341)`, async ({
      authenticatedPage: page,
    }) => {
      await withTheme(page, theme)
      const state = await stubTenantDetail(
        page,
        tenantDetail({ status: 'DELETED', deletedAt: '2026-10-12T01:00:00Z', purgeError: 'drive: 실패' }),
      )
      await stubMembers(page, [])
      await page.goto('/tenants/7')
      await expectTheme(page, theme)
      await expect.poll(() => textContrast(page.getByTestId('tenant-deleted-banner'))).toBeGreaterThanOrEqual(4.5)
      // 같은 페이지를 PURGING 으로 다시 열어 info 배너·배지를 잰다.
      state.tenant = { ...state.tenant, status: 'PURGING' }
      await page.reload()
      await expectTheme(page, theme)
      await expect.poll(() => textContrast(page.getByTestId('tenant-purging-banner'))).toBeGreaterThanOrEqual(4.5)
      await expect.poll(() => textContrast(page.getByTestId('tenant-status'))).toBeGreaterThanOrEqual(4.5)
    })
  }
})
