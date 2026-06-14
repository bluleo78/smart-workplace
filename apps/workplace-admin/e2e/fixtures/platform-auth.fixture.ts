import { type Page, test as base } from '@playwright/test'

import type { PlatformTokenResponse, PlatformUser } from '../../src/types/platform'

// 운영자 콘솔 인증 모킹 fixture.
// - 실제 백엔드 없이 인증된 상태의 page 를 제공.
// - admin 은 SSE 가 없어 주 flake 원인이 부재. 빠뜨린 엔드포인트가 행이 아니라 즉시 404 로
//   드러나도록 catch-all `**/api/**`→404 를 가장 먼저(LIFO 매칭에서 fallback) 등록한다.

const MOCK_TOKEN: PlatformTokenResponse = {
  accessToken: 'mock-access-token',
  tokenType: 'Bearer',
  expiresIn: 1800,
}

/** 운영자 사용자 팩토리. */
export function createPlatformUser(overrides?: Partial<PlatformUser>): PlatformUser {
  return {
    id: 1,
    username: 'operator',
    name: '운영자',
    email: 'operator@example.com',
    ...overrides,
  }
}

/**
 * 플랫폼 인증 목 설치.
 * catch-all(404)을 먼저 등록 → 이후 등록한 구체 라우트가 LIFO 로 우선한다.
 * 테스트 본문에서 더 구체적인 라우트(예: login 403)를 등록하면 그쪽이 다시 우선한다.
 */
export async function setupPlatformAuthMocks(page: Page, user: PlatformUser = createPlatformUser()) {
  // 1) fallback — 빠뜨린 엔드포인트는 행 대신 즉시 404.
  // 주의: `**/api/**` 글롭은 vite 가 서빙하는 소스 모듈(`/src/api/client.ts` 등)까지 매칭해
  //       React 마운트를 깨뜨린다(부분 문자열 매칭). pathname 이 `/api/` 로 시작하는 것만
  //       잡는 predicate 를 써서 `/src/api/...` 를 절대 건드리지 않게 한다(web fixture 와 동일 관용).
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ status: 404, error: 'Not Found', message: 'unmocked' }),
    }),
  )

  // 2) 구체 라우트(나중 등록 → 우선).
  await page.route('**/api/platform/auth/refresh', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_TOKEN),
    }),
  )
  await page.route('**/api/platform/auth/login', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_TOKEN),
    }),
  )
  await page.route('**/api/platform/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(user),
    }),
  )
  // 테넌트 목록 기본 스텁(빈 배열) — 인증된 홈이 에러 상태로 떨어지지 않게 한다.
  // 테넌트 화면 테스트는 이 라우트를 더 구체적인 핸들러로 오버라이드한다.
  await page.route('**/api/platform/tenants', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    }
    return route.fallback()
  })
}

type PlatformAuthFixtures = {
  authenticatedPage: Page
}

export const test = base.extend<PlatformAuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    await setupPlatformAuthMocks(page)
    // 인증 컨텍스트가 마운트 시 hasSession 플래그를 보고 refresh 로 세션 복원한다.
    await page.addInitScript(() => window.localStorage.setItem('hasSession', '1'))
    await use(page)
  },
})

export { expect } from '@playwright/test'
