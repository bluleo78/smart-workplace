import { expect, test } from '@playwright/test'

import { mockApi } from '../fixtures/api-mock'

// 이슈 #495 — 부트스트랩 첫 사용자 이후 웹 회원가입을 막는다.
// GET /auth/signup-available 가용성에 따라 가입 폼/링크 노출을 제어.
// 백엔드 없이 page.route 로 가용성 엔드포인트를 모킹한다.

test.describe('회원가입 가용성 게이트 (#495)', () => {
  // available=true → 기존 가입 폼(입력 필드들)이 그대로 보인다.
  test('가용=true 이면 가입 폼이 보인다', async ({ page }) => {
    await mockApi(page, 'GET', '/api/v1/auth/signup-available', { available: true })

    await page.goto('/signup')

    // 폼 입력 필드들이 모두 렌더된다(요소 존재가 아닌 실제 폼 노출 검증).
    await expect(page.getByLabel('아이디 (이메일)')).toBeVisible()
    await expect(page.getByLabel('비밀번호', { exact: true })).toBeVisible()
    await expect(page.getByLabel('비밀번호 확인')).toBeVisible()
    await expect(page.getByLabel('이름')).toBeVisible()
    await expect(page.getByRole('button', { name: '회원가입' })).toBeVisible()
    // 잠김 안내는 보이지 않아야 한다.
    await expect(page.getByText('회원가입이 비활성화되어 있습니다.')).toBeHidden()
  })

  // available=false → 폼 숨김 + 안내 문구 + 로그인 링크만 보인다.
  test('가용=false 이면 폼이 숨겨지고 안내 + 로그인 링크만 보인다', async ({ page }) => {
    await mockApi(page, 'GET', '/api/v1/auth/signup-available', { available: false })

    await page.goto('/signup')

    // 안내 문구 + 로그인 링크 노출.
    await expect(
      page.getByText('회원가입이 비활성화되어 있습니다. 관리자에게 문의하세요.'),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: '로그인' })).toBeVisible()
    // 가입 폼 입력 필드는 렌더되지 않아야 한다.
    await expect(page.getByLabel('아이디 (이메일)')).toBeHidden()
    await expect(page.getByRole('button', { name: '회원가입' })).toBeHidden()
  })

  // available=true 인데 signup POST 가 403 → 에러 메시지 표시(가입 잠김 경합 상황).
  test('가용=true 라도 가입 POST 403 이면 에러 메시지를 표시한다', async ({ page }) => {
    await mockApi(page, 'GET', '/api/v1/auth/signup-available', { available: true })
    // 가입 닫힌 상태에서 호출되면 백엔드는 403 을 반환한다.
    const signupCapture = await mockApi(
      page,
      'POST',
      '/api/v1/auth/signup',
      { status: 403, error: 'Forbidden', message: '회원가입이 비활성화되어 있습니다.' },
      { status: 403, capture: true },
    )

    await page.goto('/signup')

    // 폼 입력 → 제출 파이프라인.
    await page.getByLabel('아이디 (이메일)').fill('first@example.com')
    await page.getByLabel('비밀번호', { exact: true }).fill('Password1!')
    await page.getByLabel('비밀번호 확인').fill('Password1!')
    await page.getByLabel('이름').fill('첫 사용자')
    await page.getByRole('button', { name: '회원가입' }).click()

    // 실제로 signup POST 가 전송되었는지 + payload 검증.
    const req = await signupCapture.waitForRequest()
    const payload = req.payload as { username: string; name: string }
    expect(payload.username).toBe('first@example.com')
    expect(payload.name).toBe('첫 사용자')

    // 403 → serverError 안내 메시지가 화면에 표시된다.
    await expect(page.getByText('회원가입이 비활성화되어 있습니다.')).toBeVisible()
  })

  // 로그인 페이지: 가용=false 이면 회원가입 링크를 숨긴다.
  test('로그인 페이지는 가용=false 이면 회원가입 링크를 숨긴다', async ({ page }) => {
    await mockApi(page, 'GET', '/api/v1/auth/signup-available', { available: false })

    await page.goto('/login')

    await expect(page.getByRole('button', { name: /로그인/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /회원가입/ })).toBeHidden()
  })

  // 로그인 페이지: 가용=true 이면 회원가입 링크가 보인다.
  test('로그인 페이지는 가용=true 이면 회원가입 링크가 보인다', async ({ page }) => {
    await mockApi(page, 'GET', '/api/v1/auth/signup-available', { available: true })

    await page.goto('/login')

    await expect(page.getByRole('link', { name: /회원가입/ })).toBeVisible()
  })
})
