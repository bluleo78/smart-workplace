// WP-48 구성원 추가 — 워크스페이스 SSO 가 켜져 있으면 "SSO 전용(비밀번호 없음)" 을 고를 수 있다.
import { createPageResponse, mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

const sso = (enabled: boolean) => ({ available: true, enabled, adminConsentUrl: null, passwordlessMemberCount: 0 })

test('SSO 전용 구성원은 비밀번호 없이 전송된다', async ({ adminPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/members', createPageResponse([]))
  await mockApi(page, 'GET', '/api/v1/admin/sso', sso(true))
  const post = await mockApi(page, 'POST', '/api/v1/users',
    { userId: 9, username: 'hong@acme.com', name: '홍', email: null, role: 'USER', status: 'ACTIVE' },
    { status: 201, capture: true })

  await page.goto('/settings/users')
  await page.getByRole('button', { name: '구성원 추가' }).click()
  await expect(page.getByLabel('SSO 전용 (비밀번호 없음)')).toBeChecked()
  await expect(page.getByTestId('add-member-password')).toHaveCount(0)
  await expect(page.getByText('회사 계정 주소(이메일)를 입력하세요.')).toBeVisible()

  await page.getByTestId('add-member-username').fill('hong@acme.com')
  await page.getByTestId('add-member-name').fill('홍')
  await page.getByTestId('add-member-submit').click()

  await expect.poll(() => post.lastRequest()?.payload).toEqual({ username: 'hong@acme.com', name: '홍', role: 'USER' })
})

test('SSO 전용은 이메일 형식 아이디만 허용한다', async ({ adminPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/members', createPageResponse([]))
  await mockApi(page, 'GET', '/api/v1/admin/sso', sso(true))
  await page.goto('/settings/users')
  await page.getByRole('button', { name: '구성원 추가' }).click()
  await page.getByTestId('add-member-username').fill('hong')
  await page.getByTestId('add-member-name').fill('홍')
  await page.getByTestId('add-member-submit').click()
  await expect(page.getByText('아이디는 이메일 형식이어야 합니다')).toBeVisible()
})

test('SSO 가 꺼져 있으면 로그인 방식 선택이 없다', async ({ adminPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/members', createPageResponse([]))
  await mockApi(page, 'GET', '/api/v1/admin/sso', sso(false))
  await page.goto('/settings/users')
  await page.getByRole('button', { name: '구성원 추가' }).click()
  await expect(page.getByText('로그인 방식')).toHaveCount(0)
  await expect(page.getByTestId('add-member-password')).toBeVisible()
})
