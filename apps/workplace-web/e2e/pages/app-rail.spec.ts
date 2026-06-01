import { expect, test } from '../fixtures/auth.fixture'

test('홈에 앱 레일이 보이고 상단 GNB는 없다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await page.goto('/')
  await expect(page.getByTestId('app-rail')).toBeVisible()
  await expect(page.getByTestId('module-sidebar')).toHaveCount(0)
})

test('데스크톱에서 앱 레일은 아이콘 전용이다(앱 마크 표시·워드마크 숨김)', async ({
  authenticatedPage: page,
}) => {
  // 기본 뷰포트(1280)는 lg 브레이크포인트 → 아이콘 레일.
  await page.goto('/')
  // 앱 마크(→홈)는 항상 보인다.
  await expect(page.getByTestId('rail-home')).toBeVisible()
  // 워드마크 "Smart Workplace" 는 lg 에서 숨김(아이콘 전용 정체성).
  await expect(page.getByTestId('app-rail').getByText('Smart Workplace')).toBeHidden()
})
