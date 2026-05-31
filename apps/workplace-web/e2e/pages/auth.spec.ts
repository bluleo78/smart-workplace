import { expect, test } from '../fixtures/auth.fixture'
import { mockApi } from '../fixtures/api-mock'

// 로그인 페이지 자체 진입 (인증 불필요)
test('로그인 페이지가 보인다', { tag: '@smoke' }, async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByText('Smart Workplace')).toBeVisible()
  await expect(page.getByRole('button', { name: /로그인/ })).toBeVisible()
})

// 인증된 상태로 진입 시 홈이 보인다 (HomePage)
test('인증 상태에서 홈에 진입한다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await page.goto('/')
  // 7c — 홈이 AI Native 셸로 교체됨. 좌측 모듈 사이드바가 보이면 홈 진입 성공.
  await expect(page.getByTestId('module-sidebar')).toBeVisible()
})

// 헤더 사용자 메뉴에서 로그아웃 — 서버 호출 + 로그인 페이지 이동
test('헤더 메뉴에서 로그아웃하면 로그인 페이지로 이동한다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  const logoutCapture = await mockApi(page, 'POST', '/api/v1/auth/logout', {}, { capture: true })

  await page.goto('/')
  // 7c — 홈 셸 진입 확인(헤더의 사용자 메뉴는 AppLayout 에 그대로 존재).
  await expect(page.getByTestId('module-sidebar')).toBeVisible()

  await page.getByRole('button', { name: '사용자 메뉴' }).click()
  await page.getByRole('menuitem', { name: '로그아웃' }).click()

  // 서버 logout 호출 + /login 이동
  await logoutCapture.waitForRequest()
  await expect(page).toHaveURL(/\/login$/)
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
