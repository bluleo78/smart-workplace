// 로그인 → 테넌트 선택 → 전체 리로드 → 홈 착지 흐름(#219 P3) E2E — 여러 화면을 넘는 흐름(@flow)만 남긴다.
// 단일소속 바로 진입·무소속 안내·select-tenant 5xx 안내와 다중소속 선택 payload 는
// 화면 컴포넌트 테스트 src/pages/authPages.test.tsx 가 지킨다(WP-971).
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
  // WP-48 — 로그인 페이지가 마운트 시 SSO 가용성(/auth/sso/status)도 조회한다. 미스텁 시 로컬 백엔드로 누수돼 401 → refresh 실패 → /login 강제 이동으로 테스트가 깨진다.
  await mockApi(page, 'GET', '/api/v1/auth/sso/status', { m365: false })
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
  await page.route('**/api/v1/events', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }),
  )
}

test('다중소속 로그인 → 워크스페이스 선택 → select-tenant 호출 후 홈 착지', { tag: '@flow' }, async ({ page }) => {
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
