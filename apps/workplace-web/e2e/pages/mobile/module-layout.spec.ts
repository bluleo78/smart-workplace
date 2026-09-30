// 모바일 목록↔상세 스택(WP-124) — 사이드바가 탭 첫 화면 목록이 되고, 상세에선 본문만 + 뒤로가기.
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'

test('채팅: 목록 전체폭 → 채널 진입 시 탭바 숨김·뒤로가기 → 목록', async ({ authenticatedPage: page }) => {
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

test('상세 헤더 ✦ 는 AI 풀스크린을 열고 닫기로 상세에 돌아온다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/chat/channels/1')
  await page.getByTestId('mobile-back-ai').click()
  await expect(page.getByTestId('ai-fullscreen')).toBeVisible()
  await page.getByTestId('ai-panel-close').click()
  await expect(page.getByTestId('ai-fullscreen')).toHaveCount(0)
  await expect(page).toHaveURL(/\/chat\/channels\/1$/)
})

test('딥링크 진입 후 뒤로 = 모듈 루트(앱 밖으로 나가지 않음)', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/chat/channels/1')
  await page.getByTestId('mobile-back').click()
  await expect(page).toHaveURL(/\/chat$/)
})

test('작업 관리: /tasks 는 사이드바 목록, 데스크톱 리다이렉트 없음', async ({ authenticatedPage: page }) => {
  await page.goto('/tasks')
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(page.getByTestId('issue-sidebar')).toBeVisible()
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
})

test('설정: /settings 는 프로필로 리다이렉트하지 않고 목록을 보인다', async ({ authenticatedPage: page }) => {
  await page.goto('/settings')
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByTestId('settings-sidebar')).toBeVisible()
})

test('드라이브: /drive 는 스페이스 목록을 보인다', async ({ authenticatedPage: page }) => {
  await page.goto('/drive')
  await expect(page).toHaveURL(/\/drive$/)
  await expect(page.getByTestId('drive-sidebar')).toBeVisible()
})

test('호환 리다이렉트: /profile 은 모바일에서도 /settings/profile 로 이동해 본문을 보인다', async ({ authenticatedPage: page }) => {
  await page.goto('/profile')
  await expect(page).toHaveURL(/\/settings\/profile$/)
  await expect(page.getByTestId('mobile-back')).toBeVisible()
  await expect(page.locator('main, [data-mobile-scroll-root]').first()).not.toBeEmpty()
})
