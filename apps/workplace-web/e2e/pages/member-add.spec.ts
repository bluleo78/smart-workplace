// 구성원 추가 — 관리자가 다이얼로그로 새 계정을 만든다(입력→payload→성공 UI).
import { createPageResponse, mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

test('관리자가 구성원을 추가한다', async ({ adminPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/users', createPageResponse([]))

  // POST 캡처 — payload 검증 + 201 응답.
  let captured: any = null
  await page.route(
    (url) => url.pathname === '/api/v1/users',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      captured = route.request().postDataJSON()
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          userId: 99,
          username: 'jane',
          name: '김제인',
          email: 'jane@acme.com',
          role: 'USER',
          status: 'ACTIVE',
        }),
      })
    },
  )

  await page.goto('/settings/users')
  await page.getByRole('button', { name: '구성원 추가' }).click()

  await page.getByTestId('add-member-username').fill('jane')
  await page.getByTestId('add-member-email').fill('jane@acme.com')
  await page.getByTestId('add-member-name').fill('김제인')
  await page.getByTestId('add-member-password').fill('Password123')
  await page.getByTestId('add-member-submit').click()

  // 입력→payload: 분리된 username/email + role 이 그대로 전송돼야 한다.
  await expect.poll(() => captured).toMatchObject({
    username: 'jane',
    email: 'jane@acme.com',
    name: '김제인',
    role: 'USER',
  })
  // 성공 UI: 다이얼로그가 닫힌다.
  await expect(page.getByTestId('add-member-submit')).toHaveCount(0)
})

test('이메일 없이도 구성원을 추가한다', async ({ adminPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/users', createPageResponse([]))
  let captured: any = null
  await page.route(
    (url) => url.pathname === '/api/v1/users',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      captured = route.request().postDataJSON()
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ userId: 1, username: 'noemail', name: '이름만', email: null, role: 'USER', status: 'ACTIVE' }),
      })
    },
  )

  await page.goto('/settings/users')
  await page.getByRole('button', { name: '구성원 추가' }).click()
  await page.getByTestId('add-member-username').fill('noemail')
  await page.getByTestId('add-member-name').fill('이름만')
  await page.getByTestId('add-member-password').fill('Password123')
  await page.getByTestId('add-member-submit').click()

  // 이메일 빈값은 payload 에서 생략(undefined)된다 — 컴포넌트가 email:undefined 로 보낸다.
  await expect.poll(() => captured?.username).toBe('noemail')
  expect(captured.email).toBeUndefined()
})
