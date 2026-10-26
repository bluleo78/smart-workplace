// 설정 앱 내비게이션 — 사이드바 선택 항목의 계산된 배경색(@layout)만 남는다.
// 구 경로 리다이렉트·관리 그룹 비노출·비어드민 직접 접근 차단은 src/pages/settings/settingsNav.test.tsx(페이지 테스트)가 지킨다.
import { expect, test } from '../../fixtures/auth.fixture'
import { expectSelectedRow } from '../../fixtures/selection'

// WP-368 — 사이드바 활성 항목은 선택 전용 표시(bg-selected + 막대), 비활성은 없다(공용 sidebarLinkClass).
test('설정 사이드바의 활성 항목은 bg-selected·selection-bar 를 갖고 배경색이 다르다 (WP-368)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.goto('/settings/profile')
  const sidebar = page.getByTestId('settings-sidebar')
  const active = sidebar.locator('a[aria-current="page"]')
  await expect(active).toHaveCount(1)
  await expectSelectedRow(active, sidebar.locator('a:not([aria-current="page"])').first())
})
