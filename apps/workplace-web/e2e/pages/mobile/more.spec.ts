// 더보기·탭 편집·알림 화면(WP-126).
import { mockApi } from '../../fixtures/api-mock'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'

test('더보기 그리드에서 탭바에 없는 앱으로 이동', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/more')
  await expect(page.getByTestId('more-app-home')).toHaveCount(0) // 탭바에 이미 있음
  await page.getByTestId('more-app-calendar').click()
  await expect(page).toHaveURL(/\/calendar$/)
  await expectNoHorizontalOverflow(page)
})

test('탭 편집: 메일을 빼고 캘린더를 넣으면 새로고침 후에도 유지', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/more/tabs')
  await page.getByTestId('tab-edit-remove-2').click() // mail
  await page.getByTestId('tab-edit-add-calendar').click()
  await page.getByTestId('tab-edit-save').click()
  await page.reload()
  await expect(page.getByTestId('mobile-tab-calendar')).toBeVisible()
  await expect(page.getByTestId('mobile-tab-mail')).toHaveCount(0)
})

test('탭 편집: 3칸 미만이면 저장 불가', async ({ authenticatedPage: page }) => {
  await page.goto('/more/tabs')
  await page.getByTestId('tab-edit-remove-0').click()
  await expect(page.getByTestId('tab-edit-save')).toBeDisabled()
})

test('홈 멘션 셀(openInbox) 은 모바일에서 /notifications 로 이동', async ({ authenticatedPage: page }) => {
  // 합성 위젯만 있는 레이아웃 — 멘션 셀은 openInbox() 를 호출하는 버튼(#273, SynthesisLayer.tsx:323).
  await mockApi(page, 'GET', '/api/v1/me/dashboard', {
    widgets: [{ id: 'synthesis', type: 'synthesis', count: 5, hidden: false }],
  })
  await mockApi(page, 'GET', '/api/v1/notifications', [])
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 0 })
  await page.goto('/')
  await page.getByTestId('dashboard-counts').getByRole('button', { name: /^멘션/ }).click()
  await expect(page).toHaveURL(/\/notifications$/)
})

test('알림 화면: 빈 상태', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/notifications', [])
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 0 })
  await page.goto('/notifications')
  await expect(page.getByTestId('inbox-empty')).toBeVisible()
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
})
