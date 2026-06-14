import { expect, test } from '@playwright/test'

// 스캐폴딩 스모크 — 앱이 뜨고 임시 App 이 렌더되는지만 확인한다.
// (인증/페이지 E2E 는 후속 태스크에서 추가)
test('renders scaffolding placeholder', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('workplace-admin')).toBeVisible()
})
