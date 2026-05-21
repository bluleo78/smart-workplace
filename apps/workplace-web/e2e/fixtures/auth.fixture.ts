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
