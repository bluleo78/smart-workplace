// 로그인 → 테넌트 선택 흐름(#219 P3) E2E.
// 비인증 상태(로그인 페이지)에서 시작하므로 authenticatedPage 가 아닌 기본 page 를 쓰고
// 스텁을 직접 건다. select-tenant 는 window.location.assign('/') 전체 리로드라
// 모든 스텁을 제출 전에 등록해 둔다(page.route 핸들러는 리로드 후에도 살아남는다).
import type { Page } from '@playwright/test'

import { createLoginResponse, createMembership, createTokenResponse, createUserDetail } from '../factories/auth.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

// "/" 홈 셸 착지에 필요한 기본 스텁 일괄 등록(setupAuthMocks 비공개라 핵심만 재현).
// 미스텁 시 백엔드 프록시 ECONNREFUSED 누수/레이스(특히 SSE)가 리로드 후 "/" 착지를 깨뜨린다.
async function setupHomeBattery(page: Page) {
  // 리로드 후 init: hasSession → refresh → users/me.
  await mockApi(page, 'POST', '/api/v1/auth/refresh', createTokenResponse())
  // #495 — 로그인 페이지가 마운트 시 가입 가용성을 조회하므로 기본 스텁으로 백엔드 누수 방지.
  await mockApi(page, 'GET', '/api/v1/auth/signup-available', { available: true })
  await mockApi(page, 'GET', '/api/v1/users/me', createUserDetail())
  // 홈 셸 기본 위젯 데이터(my_tasks/issue_list/activity/pinned-views/sessions).
  await mockApi(page, 'GET', '/api/v1/me/issues', { items: [], nextCursor: null, hasMore: false })
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', { items: [], nextCursor: null, hasMore: false })
  await mockApi(page, 'GET', '/api/v1/me/activity', { items: [], nextCursor: null })
  await mockApi(page, 'GET', '/api/v1/me/pinned-views', [])
  await mockApi(page, 'GET', '/api/v1/home/sessions', { items: [], nextCursor: null })
  // 그룹 트리 + 알림 인박스 기본값.
  await page.route(
    (url) => url.pathname === '/api/v1/user-groups',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ shared: [], personal: [] }),
      }),
  )
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 0 })
  await mockApi(page, 'GET', '/api/v1/notifications', [])
  // SSE 스트림은 즉시 닫히는 빈 event-stream 으로 스텁(실네트워크 차단 — 리로드 레이스/frame detached 방지).
  await page.route('**/api/v1/notifications/stream', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }),
  )
  await page.route('**/api/v1/chat/stream', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }),
  )
}

test('다중소속 로그인 → 워크스페이스 선택 → select-tenant 호출 후 홈 착지', async ({ page }) => {
  // login 을 멤버십 2개(Acme 10 / Globex 20)로 목 — tenantOptions 세팅 경로.
  const acme = createMembership({ tenantId: 10, tenantName: 'Acme', tenantSlug: 'acme' })
  const globex = createMembership({ tenantId: 20, tenantName: 'Globex', tenantSlug: 'globex' })
  await mockApi(page, 'POST', '/api/v1/auth/login', createLoginResponse({ memberships: [acme, globex] }))
  // select-tenant payload 캡처 + tenant-scoped 토큰 200 응답.
  const select = await mockApi(page, 'POST', '/api/v1/auth/select-tenant', createTokenResponse(), { capture: true })
  // 리로드 후 "/" 착지에 필요한 init/홈 스텁을 미리 등록(핸들러는 리로드 후에도 유지).
  await setupHomeBattery(page)

  await page.goto('/login')
  // 로그인 폼 입력(username 은 zod email 검증 통과해야 제출됨) → 제출.
  await page.getByLabel('아이디').fill('user@example.com')
  await page.locator('#password').fill('Workplace1')
  await page.getByRole('button', { name: '로그인' }).click()

  // 폼 대신 워크스페이스 선택 카드 노출 + 두 옵션 확인.
  await expect(page.getByText('워크스페이스 선택')).toBeVisible()
  await expect(page.getByTestId('workspace-option-10')).toBeVisible()
  await expect(page.getByTestId('workspace-option-20')).toBeVisible()

  // Acme(10) 선택 → select-tenant payload 검증.
  await page.getByTestId('workspace-option-10').click()
  const req = await select.waitForRequest()
  expect(req.payload).toEqual({ tenantId: 10 })

  // 전환은 window.location.assign('/') 전체 리로드 → 최종 "/" 착지 + 인증 셸 마운트 확인.
  await page.waitForURL('/')
  await expect(page.getByTestId('app-rail')).toBeVisible()
})

test('단일소속 로그인 → 선택 카드 없이 바로 홈 진입', async ({ page }) => {
  // login 을 멤버십 1개로 목 — 자동 진입 경로(tenantOptions 미세팅).
  await mockApi(page, 'POST', '/api/v1/auth/login', createLoginResponse())
  await setupHomeBattery(page)

  await page.goto('/login')
  await page.getByLabel('아이디').fill('user@example.com')
  await page.locator('#password').fill('Workplace1')
  await page.getByRole('button', { name: '로그인' }).click()

  // 선택 카드 없이 홈으로 직행(Navigate to="/").
  await expect(page).toHaveURL('/')
  await expect(page.getByTestId('app-rail')).toBeVisible()
  await expect(page.getByText('워크스페이스 선택')).toHaveCount(0)
})

test('무소속(NO_WORKSPACE) 로그인 → 선택 카드 없이 전용 안내 표시', async ({ page }) => {
  // login 을 멤버십 0개로 목 — login() 이 throw 'NO_WORKSPACE' → 인증 미완료(/ 이동 안 함).
  await mockApi(page, 'POST', '/api/v1/auth/login', createLoginResponse({ memberships: [] }))
  // #495 — 로그인 페이지의 가입 가용성 조회 기본 스텁(백엔드 누수 방지).
  await mockApi(page, 'GET', '/api/v1/auth/signup-available', { available: true })

  await page.goto('/login')
  await page.getByLabel('아이디').fill('user@example.com')
  await page.locator('#password').fill('Workplace1')
  await page.getByRole('button', { name: '로그인' }).click()

  // 선택 카드는 뜨지 않고, 비밀번호 오류로 오해되지 않는 전용 안내가 노출된다.
  await expect(page.getByText('워크스페이스 선택')).toHaveCount(0)
  await expect(
    page.getByText('접속 가능한 워크스페이스가 없습니다. 관리자에게 문의하세요.'),
  ).toBeVisible()
})

test('다중소속 로그인 → select-tenant 실패(5xx) 시 에러 안내 + 재시도 가능', async ({ page }) => {
  // login 을 멤버십 2개로 목 → 선택 카드 노출.
  const acme = createMembership({ tenantId: 10, tenantName: 'Acme', tenantSlug: 'acme' })
  const globex = createMembership({ tenantId: 20, tenantName: 'Globex', tenantSlug: 'globex' })
  await mockApi(page, 'POST', '/api/v1/auth/login', createLoginResponse({ memberships: [acme, globex] }))
  // select-tenant 를 500 으로 목 — 리로드 안 일어나므로 홈 스텁 불필요.
  await mockApi(page, 'POST', '/api/v1/auth/select-tenant', { message: '서버 오류' }, { status: 500 })
  // #495 — 로그인 페이지의 가입 가용성 조회 기본 스텁(백엔드 누수 방지).
  await mockApi(page, 'GET', '/api/v1/auth/signup-available', { available: true })

  await page.goto('/login')
  await page.getByLabel('아이디').fill('user@example.com')
  await page.locator('#password').fill('Workplace1')
  await page.getByRole('button', { name: '로그인' }).click()

  await expect(page.getByTestId('workspace-option-10')).toBeVisible()
  await page.getByTestId('workspace-option-10').click()

  // 전환 실패 안내가 노출되고, 카드가 유지되며 옵션 버튼이 다시 활성(재시도 가능)이다.
  await expect(
    page.getByText('워크스페이스 전환에 실패했습니다. 다시 시도해 주세요.'),
  ).toBeVisible()
  await expect(page.getByText('워크스페이스 선택')).toBeVisible()
  await expect(page.getByTestId('workspace-option-10')).toBeEnabled()
})
