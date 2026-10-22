// 제출·검증 오류가 스크린리더에 알려지는지(WP-733) — 서버 오류는 알림 영역(role=alert), 칸 오류는 알림 + 입력칸 연결
// (aria-invalid·aria-describedby). 화면에만 빨간 글씨로 보이고 소리로는 알려지지 않던 로그인·가입·구성원 추가를 지킨다.
import { createPageResponse, mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

test.describe('로그인', () => {
  test.beforeEach(async ({ page }) => {
    // 로그인 페이지가 마운트 시 SSO 가용성·가입 가용성을 조회한다 — 미스텁이면 로컬 백엔드로 샌다.
    await mockApi(page, 'GET', '/api/v1/auth/sso/status', { m365: false })
    await mockApi(page, 'GET', '/api/v1/auth/signup-available', { available: false })
  })

  test('틀린 비밀번호의 실패 문구가 알림으로 읽힌다', async ({ page }) => {
    await mockApi(
      page,
      'POST',
      '/api/v1/auth/login',
      { status: 401, error: 'Unauthorized', message: 'Invalid credentials' },
      { status: 401 },
    )
    await page.goto('/login')
    await page.getByLabel('아이디').fill('alice@t.local')
    await page.locator('#password').fill('wrongpass1')
    await page.getByRole('button', { name: '로그인' }).click()

    await expect(page.getByRole('alert')).toHaveText('아이디 또는 비밀번호가 올바르지 않습니다.')
  })

  test('빈 칸 오류는 알림으로 읽히고 해당 입력칸의 설명으로 연결된다', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: '로그인' }).click()

    const username = page.getByLabel('아이디')
    await expect(username).toHaveAttribute('aria-invalid', 'true')
    await expect(username).toHaveAccessibleDescription('아이디를 입력하세요')
    const password = page.locator('#password')
    await expect(password).toHaveAttribute('aria-invalid', 'true')
    await expect(password).toHaveAccessibleDescription('비밀번호를 입력하세요')
    await expect(page.getByRole('alert')).toHaveText(['아이디를 입력하세요', '비밀번호를 입력하세요'])

    // 고치면 연결이 풀린다.
    await username.fill('alice@t.local')
    await expect(username).not.toHaveAttribute('aria-invalid', 'true')
    await expect(username).toHaveAccessibleDescription('')
  })
})

test('가입 서버 오류가 알림으로 읽힌다', async ({ page }) => {
  await mockApi(page, 'GET', '/api/v1/auth/signup-available', { available: true })
  await mockApi(
    page,
    'POST',
    '/api/v1/auth/signup',
    { status: 403, error: 'Forbidden', message: '회원가입이 비활성화되어 있습니다.' },
    { status: 403 },
  )
  await page.goto('/signup')
  await page.getByLabel('아이디 (이메일)').fill('first@example.com')
  await page.getByLabel('비밀번호', { exact: true }).fill('Password1!')
  await page.getByLabel('비밀번호 확인').fill('Password1!')
  await page.getByLabel('이름').fill('첫 사용자')
  await page.getByRole('button', { name: '회원가입' }).click()

  await expect(page.getByRole('alert')).toHaveText('회원가입이 비활성화되어 있습니다.')
})

test('구성원 추가 칸 오류가 알림으로 읽히고 입력칸과 연결된다', async ({ adminPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/members', createPageResponse([]))
  await page.goto('/settings/users')
  await page.getByRole('button', { name: '구성원 추가' }).click()
  await page.getByTestId('add-member-username').fill('not-an-email')
  await page.getByTestId('add-member-submit').click()

  const username = page.getByTestId('add-member-username')
  await expect(username).toHaveAttribute('aria-invalid', 'true')
  await expect(username).toHaveAccessibleDescription(/아이디는 이메일 형식이어야 합니다/)
  const name = page.getByTestId('add-member-name')
  await expect(name).toHaveAttribute('aria-invalid', 'true')
  await expect(name).toHaveAccessibleDescription('이름을 입력하세요')
  await expect(page.getByRole('dialog').getByRole('alert').first()).toBeVisible()
})
