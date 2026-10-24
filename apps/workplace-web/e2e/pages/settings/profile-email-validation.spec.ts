// WP-912 — 프로필 이메일 칸(type=email)에 잘못된 주소를 넣고 저장하면 브라우저 기본 말풍선이 먼저 떠 제출을 막아,
// zod 의 한국어 안내(「유효한 이메일을 입력하세요」)가 화면에 남지 않았다. 폼 noValidate 로 zod 안내가 칸 아래에 보이고 저장 요청은 나가지 않는다.
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'

test('프로필 이메일이 잘못되면 칸 아래에 한국어 안내를 보이고 저장하지 않는다 (WP-912)', async ({
  authenticatedPage: page,
}) => {
  const updates = trackRequests(page, 'PUT', '/api/v1/users/me')
  await page.goto('/settings/profile')
  const email = page.locator('#profile-email')
  await email.fill('not-an-email')
  await page.getByRole('button', { name: '저장' }).first().click()

  await expect(page.getByText('유효한 이메일을 입력하세요')).toBeVisible()
  // 브라우저 기본 검증이 제출을 가로채지 않았다 — 칸이 「유효하지 않음」으로 남아 있지만 앱 문구가 보인다.
  expect(await email.evaluate((el: HTMLInputElement) => el.form?.noValidate)).toBe(true)
  expect(updates.count()).toBe(0)
})
