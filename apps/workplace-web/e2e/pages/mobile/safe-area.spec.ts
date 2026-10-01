// 노치·홈 인디케이터 안전영역 — iOS 는 viewport 메타에 viewport-fit=cover 가 없으면 env(safe-area-inset-*) 를 0 으로 계산해,
// 탭바의 pb-[env(safe-area-inset-bottom)] 가 무력화되고 홈 인디케이터가 탭 이름을 가린다.
// Playwright(Chromium)는 안전영역을 에뮬레이트하지 못하므로 전제 조건인 메타 설정을 고정한다.
import { expect, test } from '../../fixtures/mobile.fixture'

test('viewport 메타에 viewport-fit=cover — 하단 탭바가 홈 인디케이터 영역을 비울 수 있다', async ({ authenticatedPage: page }) => {
  await page.goto('/')
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
  const content = await page.locator('meta[name="viewport"]').getAttribute('content')
  expect(content).toContain('viewport-fit=cover')
})
