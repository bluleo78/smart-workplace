// ProfileSettingsPage 비밀번호 변경 폼 — 새 비밀번호 복잡도(대/소문자·숫자) 클라이언트 검증 회귀 테스트 (이슈 #794)
// 회원가입(auth.ts)·구성원 추가(AddMemberDialog.tsx)와 동일한 규칙을 changePasswordSchema 에도 적용해
// 서버 왕복 없이 클라이언트 단계에서 차단되고 한국어 안내 메시지가 표시되는지 검증한다.
import { expect, test } from '../../fixtures/auth.fixture'

test.describe('프로필 설정 — 새 비밀번호 복잡도 검증', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/settings/profile')
    await expect(page.locator('[data-slot="card-title"]:has-text("비밀번호 변경")')).toBeVisible()
  })

  // 입력 → 클라이언트 검증(zod) → UI 에러 반영 파이프라인 검증
  test('대문자 없이 소문자+숫자만 입력하면 서버 요청 없이 한국어 에러가 즉시 표시된다', async ({
    authenticatedPage: page,
  }) => {
    // 서버로 요청이 가면 실패시키는 라우트 — 클라이언트 검증이 먼저 막아야 이 라우트가 호출되지 않는다
    let changePasswordCalled = false
    await page.route('**/api/v1/users/me/password', (route) => {
      changePasswordCalled = true
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          message:
            'Password must contain at least one uppercase letter, one lowercase letter, and one digit',
        }),
      })
    })

    await page.locator('#current-password').fill('wrongpass')
    await page.locator('#new-password').fill('newpass123')
    await page.locator('#confirm-password').fill('newpass123')
    await page.locator('button:has-text("비밀번호 변경")').click()

    // 한국어 인라인 에러 메시지가 표시된다 — 영문 서버 메시지가 아니다
    await expect(page.getByText('대문자를 1자 이상 포함해야 합니다')).toBeVisible()
    await expect(page.getByText(/Password must contain/)).toHaveCount(0)
    expect(changePasswordCalled).toBe(false)
  })

  test('숫자 없이 대소문자만 입력하면 한국어 에러가 표시된다', async ({ authenticatedPage: page }) => {
    await page.locator('#new-password').fill('NewPassword')
    await page.locator('#new-password').blur()

    await expect(page.getByText('숫자를 1자 이상 포함해야 합니다')).toBeVisible()
  })

  test('대/소문자·숫자를 모두 포함하면 복잡도 에러가 표시되지 않는다', async ({
    authenticatedPage: page,
  }) => {
    await page.locator('#new-password').fill('NewPass123')
    await page.locator('#new-password').blur()

    await expect(page.getByText('대문자를 1자 이상 포함해야 합니다')).toHaveCount(0)
    await expect(page.getByText('소문자를 1자 이상 포함해야 합니다')).toHaveCount(0)
    await expect(page.getByText('숫자를 1자 이상 포함해야 합니다')).toHaveCount(0)
  })
})
