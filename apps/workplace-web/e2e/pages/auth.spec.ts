import { expect, test } from '../fixtures/auth.fixture'

// 로그인 페이지 자체 진입 (인증 불필요)
test('로그인 페이지가 보인다', { tag: '@smoke' }, async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByText('Smart Workplace')).toBeVisible()
  await expect(page.getByRole('button', { name: /로그인/ })).toBeVisible()
})

// 인증된 상태로 진입 시 홈이 보인다 (HomePage)
test('인증 상태에서 홈에 진입한다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Smart Workplace' })).toBeVisible()
})

// ADMIN 권한이면 사용자 관리 페이지 진입 가능
test('관리자 권한으로 사용자 관리 페이지에 진입한다', { tag: '@smoke' }, async ({ adminPage: page }) => {
  // 페이지가 호출하는 사용자 목록 API 를 빈 배열로 모킹
  await page.route('**/api/v1/users**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.goto('/admin/users')
  // 페이지 자체가 렌더 (NotFound 가 아님) 만 확인 — 실제 표 내용은 폴리싱 후
  await expect(page).toHaveURL(/\/admin\/users/)
})
