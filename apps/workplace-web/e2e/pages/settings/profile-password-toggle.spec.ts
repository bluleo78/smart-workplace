// ProfileSettingsPage 비밀번호 변경 폼 — 표시/숨김 토글 회귀 테스트 (이슈 #263)
// 비밀번호 필드 3개(현재/새/확인) 각각의 Eye 버튼 클릭 → type 전환을 검증한다.
import { expect, test } from '../../fixtures/auth.fixture'

test.describe('프로필 설정 — 비밀번호 표시/숨김 토글', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/settings/profile')
    // 비밀번호 변경 카드 헤더가 렌더링될 때까지 대기 (CardTitle: div[data-slot=card-title])
    await expect(page.locator('[data-slot="card-title"]:has-text("비밀번호 변경")')).toBeVisible()
  })

  // 각 필드의 초기 상태(password), 토글 후 상태(text), 재토글(password) 파이프라인 검증
  for (const [label, id] of [
    ['현재 비밀번호', 'current-password'],
    ['새 비밀번호', 'new-password'],
    ['비밀번호 확인', 'confirm-password'],
  ] as const) {
    test(`${label} 필드 — 토글 버튼이 존재하고 type 이 password↔text 전환된다`, async ({
      authenticatedPage: page,
    }) => {
      const input = page.locator(`#${id}`)
      // 초기 상태: 숨김 (password)
      await expect(input).toHaveAttribute('type', 'password')

      // 토글 버튼은 aria-label "비밀번호 보기"로 접근
      const toggleBtn = page.locator(`#${id} ~ button[aria-label]`)
      await expect(toggleBtn).toHaveAttribute('aria-label', '비밀번호 보기')

      // 클릭 → 표시 (text)
      await toggleBtn.click()
      await expect(input).toHaveAttribute('type', 'text')
      await expect(toggleBtn).toHaveAttribute('aria-label', '비밀번호 숨기기')

      // 재클릭 → 다시 숨김 (password)
      await toggleBtn.click()
      await expect(input).toHaveAttribute('type', 'password')
      await expect(toggleBtn).toHaveAttribute('aria-label', '비밀번호 보기')
    })
  }
})
