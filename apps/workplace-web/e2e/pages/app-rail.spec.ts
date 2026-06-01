import { expect, test } from '../fixtures/auth.fixture'

test('홈에 앱 레일이 보이고 상단 GNB는 없다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await page.goto('/')
  await expect(page.getByTestId('app-rail')).toBeVisible()
  await expect(page.getByTestId('module-sidebar')).toHaveCount(0)
})

test('앱 레일 collapse 상태가 새로고침 후 유지된다', async ({ authenticatedPage: page }) => {
  await page.goto('/')
  await page.getByTestId('rail-collapse-toggle').click()
  await page.reload()
  await expect(page.getByTestId('app-rail').getByText('Smart Workplace')).toHaveCount(0)
})
