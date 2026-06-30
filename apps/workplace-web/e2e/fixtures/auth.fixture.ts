import { type Page, test as base } from '@playwright/test'

import type { TokenResponse, UserResponse } from '../../src/types/auth'
import type { RoleResponse } from '../../src/types/role'
import { createTokenResponse, createUser } from '../factories/auth.factory'
import { mockApi } from './api-mock'

// 인증 모킹 fixture.
// - 실제 백엔드 없이 인증된 상태 / 관리자 권한 상태의 page 를 제공.
// - 모든 시나리오에서 /api/v1/auth/refresh 도 미리 모킹 (StrictMode 마운트 시 호출).

const MOCK_USER_ROLE: RoleResponse = {
  id: 2, name: 'USER', description: '일반 사용자', isSystem: true,
}
const MOCK_ADMIN_ROLE: RoleResponse = {
  id: 1, name: 'ADMIN', description: '시스템 관리자', isSystem: true,
}

async function setupAuthMocks(page: Page, user: UserResponse, roles: RoleResponse[], token: TokenResponse) {
  // 애니메이션/트랜지션 전역 비활성화 — Radix 다이얼로그·hover 툴바·Sonner 토스트의 전환이
  // Playwright actionability 의 "element is not stable" 을 유발해(부하 시 hover 가 풀리기 전에
  // 클릭을 못 끝냄) 비결정적 플래키의 큰 축이었다. 모든 페이지/네비게이션에 주입한다.
  await page.addInitScript(() => {
    const css = `*, *::before, *::after {
      transition-duration: 0s !important;
      transition-delay: 0s !important;
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      scroll-behavior: auto !important;
    }`
    const inject = () => {
      const style = document.createElement('style')
      style.setAttribute('data-test-no-animation', '')
      style.textContent = css
      document.head.appendChild(style)
    }
    if (document.head) inject()
    else document.addEventListener('DOMContentLoaded', inject)
  })
  await mockApi(page, 'POST', '/api/v1/auth/refresh', token)
  await mockApi(page, 'POST', '/api/v1/auth/login', token)
  await mockApi(page, 'GET', '/api/v1/users/me', { ...user, roles })
  // Phase 6d — 이슈 상세 진입 시 chat thread/messages 가 자동 lazy fetch 되므로,
  // 모든 인증 테스트에 빈 chat 기본 스텁을 깔아 백엔드 프록시(ECONNREFUSED) 누수를 막는다.
  // chat 을 검증하는 spec 은 더 구체적 라우트를 나중에 등록 → 그쪽이 우선한다.
  await page.route('**/api/v1/projects/*/issues/*/chat/thread', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        threadId: 0,
        issueId: 0,
        archivedAt: null,
        members: [],
        recentMessages: [],
      }),
    }),
  )
  await page.route('**/api/v1/chat/threads/*/messages', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
    }),
  )
  // Phase 7c — "/" 홈 셸이 마운트 시 기본 구성(my_tasks/issue_list/activity)을 자동 로드하며
  // /me/issues·/me/watched-issues·/me/activity 를 실제로 fetch 한다. 모든 인증 테스트가
  // 결국 "/" 에 착지하므로(예: 로그아웃) 빈 기본 스텁을 깔아 백엔드 프록시(ECONNREFUSED) 누수를 막는다.
  // mockApi 는 pathname 정확 매칭(쿼리스트링 무시) → ?assignee=me&size=50 등도 매칭된다.
  // 홈을 검증하는 spec 은 더 구체적 응답을 나중에 등록 → 그쪽이 우선한다.
  await mockApi(page, 'GET', '/api/v1/me/issues', { items: [], nextCursor: null, hasMore: false })
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', { items: [], nextCursor: null, hasMore: false })
  await mockApi(page, 'GET', '/api/v1/me/activity', { items: [], nextCursor: null })
  // 고정 홈 대시보드(Dashboard)가 "/" 마운트 시 레이아웃·위젯 데이터를 페치한다.
  // 모든 인증 테스트가 결국 "/" 에 착지하므로 빈 기본 스텁을 깔아 백엔드 프록시(ECONNREFUSED) 누수를 막는다.
  // 대시보드를 검증하는 spec 은 더 구체적 응답을 나중에 등록 → LIFO 로 그쪽이 우선한다.
  await mockApi(page, 'GET', '/api/v1/me/dashboard', { widgets: [] })
  await mockApi(page, 'GET', '/api/v1/me/mail-summary', { unreadCount: 0, recent: [] })
  await mockApi(page, 'GET', '/api/v1/calendar/events', [])
  await mockApi(page, 'GET', '/api/v1/messaging/channels', [])
  await mockApi(page, 'GET', '/api/v1/messaging/dms', [])
  // 이슈 레이아웃의 IssueSidebar 가 마운트 시 /me/pinned-views(고정뷰)를 페치하므로
  // 빈 기본 스텁을 깔아 백엔드 프록시(ECONNREFUSED) 누수를 막는다.
  // 고정뷰를 검증하는 spec 은 더 구체적 목록을 나중에 등록 → 그쪽이 우선한다.
  await mockApi(page, 'GET', '/api/v1/me/pinned-views', [])
  // Phase 7d — "/" 홈 셸 마운트 시 세션 스위처가 /home/sessions 를 페치한다. 모든 인증 테스트가
  // 결국 "/" 에 착지하므로 빈 기본 목록 스텁을 깔아 백엔드 프록시(ECONNREFUSED) 누수를 막는다.
  // 세션을 검증하는 spec 은 더 구체적 목록을 나중에 등록 → 그쪽이 우선한다.
  await mockApi(page, 'GET', '/api/v1/home/sessions', { items: [], nextCursor: null })
  // 위키 에디터가 마운트 시 useWikiMentions(page.id) 로 /wiki/pages/:id/mentions 를 페치하므로
  // 모든 wiki 스펙에서 빈 기본 스텁을 깔아 백엔드 프록시(localhost:9090) 누수를 막는다.
  // 멘션을 검증하는 spec 은 더 구체적 응답을 나중에 등록 → LIFO 로 그쪽이 우선한다.
  await page.route(
    (url) => /^\/api\/v1\/wiki\/pages\/\d+\/mentions$/.test(url.pathname),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  // 백링크(Task 9 예정)도 같은 자리에서 빈 기본 스텁으로 누수 예방.
  await page.route(
    (url) => /^\/api\/v1\/wiki\/pages\/\d+\/backlinks$/.test(url.pathname),
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }),
  )
  // #93 그룹 트리가 마운트되므로 다른 authed 스펙 누수 방지용 기본 빈 트리
  await page.route(
    (url) => url.pathname === '/api/v1/user-groups',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ shared: [], personal: [] }),
      }),
  )
  // 알림 인박스 기본 스텁 — 모든 인증 페이지에서 종/배지가 마운트되므로 기본값 제공.
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 0 })
  await mockApi(page, 'GET', '/api/v1/notifications', [])
  // 통합 SSE 단일 스트림 (#506): /api/v1/events 가 chat·messaging·notify 모두 대체.
  // 미스텁 시 백엔드 프록시로 누수되며, 백엔드 부재 시 503 재연결이 페이지 네비게이션과 레이스를
  // 일으켜(page.goto ERR_ABORTED/frame detached) 상세→목록 이동 테스트가 타임아웃된다.
  // 즉시 닫히는 빈 event-stream 으로 스텁한다.
  await page.route('**/api/v1/events', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }),
  )
  // 인증 컨텍스트가 마운트 시점에 hasSession 플래그를 보고 refresh 를 시도하므로
  // 미리 스토리지에 플래그를 심는다.
  await page.addInitScript(() => window.localStorage.setItem('hasSession', '1'))
}

type AuthFixtures = {
  authenticatedPage: Page
  adminPage: Page
}

export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    // aiAvailable:true — 기존 AI affordance 테스트들이 칩/카드를 기대하므로 기본 활성.
    await setupAuthMocks(page, createUser({ aiAvailable: true }), [MOCK_USER_ROLE], createTokenResponse())
    await use(page)
  },
  adminPage: async ({ page }, use) => {
    await setupAuthMocks(page, createUser(), [MOCK_ADMIN_ROLE, MOCK_USER_ROLE], createTokenResponse())
    await use(page)
  },
})

export { expect } from '@playwright/test'
