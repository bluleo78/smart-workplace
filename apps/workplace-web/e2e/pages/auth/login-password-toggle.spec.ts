// 로그인 화면의 비밀번호 보기 버튼 키보드 접근(WP-1426) — 실제 브라우저 Tab 순서가 「아이디 → 비밀번호 → 비밀번호 보기 → 로그인」이고
// 보기 버튼에서 Enter 로 비밀번호가 드러나는지 본다. jsdom 은 브라우저 포커스 이동을 재현만 하므로 @input 으로 브라우저에서 지킨다.
// 토글의 type·이름 변화, 비활성·aria-controls 는 vitest(src/components/ui/password-input.test.tsx)가 지킨다.
import { expect, test } from '../../fixtures/auth.fixture'
import { mockApi } from '../../fixtures/api-mock'

test('로그인 화면에서 Tab 으로 비밀번호 보기 버튼에 닿아 Enter 로 비밀번호를 보인다', { tag: ['@input'] }, async ({ page }) => {
  // 로그인 화면이 마운트 시 부르는 가입·SSO 가용성 조회 — 스텁이 없으면 로컬 백엔드로 새어 나간다(auth.spec.ts 와 같은 스텁).
  await mockApi(page, 'GET', '/api/v1/auth/signup-available', { available: true })
  await mockApi(page, 'GET', '/api/v1/auth/sso/status', { m365: false })
  await page.goto('/login')

  const username = page.getByLabel('아이디')
  const password = page.locator('#password')
  await username.focus()
  await expect(username).toBeFocused()

  await page.keyboard.press('Tab')
  await expect(password).toBeFocused()

  // 비밀번호 칸 다음 Tab 은 보기 버튼 — 예전엔 tabIndex=-1 이라 건너뛰고 로그인 버튼으로 갔다.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: '비밀번호 보기' })).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(password).toHaveAttribute('type', 'text')
  await expect(page.getByRole('button', { name: '비밀번호 숨기기' })).toBeFocused()

  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeFocused()
})
