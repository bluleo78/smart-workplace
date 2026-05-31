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
  // Phase 7d — "/" 홈 셸 마운트 시 세션 스위처가 /home/sessions 를 페치한다. 모든 인증 테스트가
  // 결국 "/" 에 착지하므로 빈 기본 목록 스텁을 깔아 백엔드 프록시(ECONNREFUSED) 누수를 막는다.
  // 세션을 검증하는 spec 은 더 구체적 목록을 나중에 등록 → 그쪽이 우선한다.
  await mockApi(page, 'GET', '/api/v1/home/sessions', { items: [], nextCursor: null })
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
    await setupAuthMocks(page, createUser(), [MOCK_USER_ROLE], createTokenResponse())
    await use(page)
  },
  adminPage: async ({ page }, use) => {
    await setupAuthMocks(page, createUser(), [MOCK_ADMIN_ROLE, MOCK_USER_ROLE], createTokenResponse())
    await use(page)
  },
})

export { expect } from '@playwright/test'
