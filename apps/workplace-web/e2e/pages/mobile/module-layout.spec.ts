// 모바일 목록↔상세 스택(WP-124) — 사이드바가 탭 첫 화면 목록이 되고, 상세에선 본문만 + 뒤로가기.
// 여기엔 실제 폭(목록 전체 폭·가로 넘침, @layout)만 남긴다. 상세 ✦ AI 시트·딥링크 ‹ = 모듈 루트·/tasks·/settings·/drive 목록·
// /profile 리다이렉트는 페이지 테스트 src/pages/mobile/moduleLayout.test.tsx 가 지킨다(WP-981).
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'

test('채팅: 목록 전체폭 → 채널 진입 시 탭바 숨김·뒤로가기 → 목록', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/chat')
  const sidebar = page.getByTestId('channel-sidebar')
  await expect(sidebar).toBeVisible()
  expect((await sidebar.boundingBox())!.width).toBeGreaterThan(380)
  await expectNoHorizontalOverflow(page)
  await sidebar.getByText('모바일-개편').click()
  await expect(page).toHaveURL(/\/chat\/channels\/1$/)
  await expect(page.getByTestId('channel-sidebar')).toHaveCount(0)
  await expect(page.getByTestId('mobile-tabbar')).toHaveCount(0)
  await page.getByTestId('mobile-back').click()
  await expect(page).toHaveURL(/\/chat$/)
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
})
