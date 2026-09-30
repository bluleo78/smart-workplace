// 앱 목록(안드로이드식)·탭 편집·알림 화면(WP-121/WP-126).
// 앱 목록: 전체 앱 그리드 + 고정 표시, 길게 눌러 탭바 고정/교체, 아바타 → 계정·워크스페이스 시트.
import type { Page } from '@playwright/test'

import { createMembership } from '../../factories/auth.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'

const ALL_APPS = ['home', 'chat', 'mail', 'calendar', 'tasks', 'drive', 'wiki', 'contacts', 'notifications', 'settings']

/** 탭바 버튼 testid 를 화면 순서대로 — 슬롯 교체가 "같은 자리"에 들어갔는지 검증용. */
async function tabIds(page: Page) {
  // evaluateAll 은 자동 대기가 없으므로 탭바(끝 칸)가 그려진 뒤 수집한다.
  await expect(page.getByTestId('mobile-tab-apps')).toBeVisible()
  return page.getByTestId('mobile-tabbar')
    .locator('[data-testid^="mobile-tab-"]:not([data-testid^="mobile-tab-badge"])')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
}

/**
 * 실제 마우스로 길게 누른다 — 메뉴가 뜰 때까지 누른 채 기다렸다가 뗀다.
 * 떼는 순간 브라우저가 진짜 click 을 발생시키므로 "길게 누르기가 이동을 일으키지 않는다"까지 함께 검증된다.
 */
async function longPress(page: Page, testId: string) {
  await page.getByTestId(testId).hover()
  await page.mouse.down()
  await expect(page.getByTestId('apps-menu')).toBeVisible()
  await page.mouse.up()
}

test('앱 목록: 전체 10개 앱이 순서대로 보이고 탭바 고정 앱엔 표시가 붙는다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps')
  await expect(page.getByTestId('apps-app-settings')).toBeVisible()
  const ids = await page.locator('[data-testid^="apps-app-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  expect(ids).toEqual(ALL_APPS.map((id) => `apps-app-${id}`))
  for (const id of ['home', 'chat', 'mail']) await expect(page.getByTestId(`apps-pinned-${id}`)).toBeVisible()
  await expect(page.getByTestId('apps-pinned-calendar')).toHaveCount(0)
  await expect(page.getByTestId('apps-app-home')).toHaveAccessibleName(/탭바에 고정됨/)
  // 탭바 끝 칸은 "앱" 이고 /apps 에서 활성.
  await expect(page.getByTestId('mobile-tab-apps')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('길게 눌러 탭바에 고정')).toBeVisible()
  // 터치 타깃 44px 이상.
  const box = (await page.getByTestId('apps-app-calendar').boundingBox())!
  expect(box.height).toBeGreaterThanOrEqual(44)
  expect(box.width).toBeGreaterThanOrEqual(44)
  await expectNoHorizontalOverflow(page)
  await page.getByTestId('apps-app-calendar').click()
  await expect(page).toHaveURL(/\/calendar$/)
})

test('길게 누르기: 캘린더를 메일 대신 고정하면 3번째 칸에 들어가고 새로고침 후에도 유지', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps')
  await longPress(page, 'apps-app-calendar')
  // 길게 누르기는 이동을 일으키지 않는다(뗄 때의 click 억제).
  await expect(page).toHaveURL(/\/apps$/)
  await expect(page.getByTestId('apps-swap')).toHaveCount(0)
  await page.getByTestId('apps-pin').click()
  await expect(page.getByText('탭바가 꽉 찼어요 — 바꿀 탭 선택')).toBeVisible()
  await expect(page.getByTestId('apps-replace-mail')).toHaveText(/메일 대신/)
  await expectNoHorizontalOverflow(page)
  await page.getByTestId('apps-replace-mail').click()
  await expect(page.getByTestId('apps-menu')).toHaveCount(0)
  await expect(page.getByText('캘린더를 탭바에 고정했어요')).toBeVisible()
  expect(await tabIds(page)).toEqual(['mobile-tab-home', 'mobile-tab-chat', 'mobile-tab-ai', 'mobile-tab-calendar', 'mobile-tab-apps'])
  await expect(page.getByTestId('apps-pinned-calendar')).toBeVisible()
  await expect(page.getByTestId('apps-pinned-mail')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await page.reload()
  expect(await tabIds(page)).toEqual(['mobile-tab-home', 'mobile-tab-chat', 'mobile-tab-ai', 'mobile-tab-calendar', 'mobile-tab-apps'])
  await expect(page).toHaveURL(/\/apps$/)
})

test('고정된 앱 우클릭(contextmenu): 다른 앱으로 교체하면 같은 자리에 들어간다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps')
  await page.getByTestId('apps-app-chat').click({ button: 'right' })
  await expect(page.getByTestId('apps-menu')).toBeVisible()
  await expect(page.getByTestId('apps-pin')).toHaveCount(0)
  await page.getByTestId('apps-swap').click()
  // 교체 후보는 탭바에 없는 앱만(설정 제외).
  await expect(page.getByTestId('apps-swap-to-home')).toHaveCount(0)
  await expect(page.getByTestId('apps-swap-to-settings')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await page.getByTestId('apps-swap-to-drive').click()
  await expect(page.getByText('드라이브를 탭바에 고정했어요')).toBeVisible()
  expect(await tabIds(page)).toEqual(['mobile-tab-home', 'mobile-tab-drive', 'mobile-tab-ai', 'mobile-tab-mail', 'mobile-tab-apps'])
  await expect(page).toHaveURL(/\/apps$/)
  await expectNoHorizontalOverflow(page)
})

test('길게 누르기 메뉴의 열기는 앱으로 이동, 설정은 길게 눌러도 메뉴가 없다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps')
  // 설정은 고정 불가 — 우클릭해도 메뉴가 뜨지 않는다.
  await page.getByTestId('apps-app-settings').click({ button: 'right' })
  await expect(page.getByTestId('apps-menu')).toHaveCount(0)
  await expect(page).toHaveURL(/\/apps$/)
  await longPress(page, 'apps-app-wiki')
  await expectNoHorizontalOverflow(page)
  await page.getByTestId('apps-open').click()
  await expect(page).toHaveURL(/\/wiki$/)
})

test('아바타 → 계정 시트: 이름·이메일, 워크스페이스(✓ 현재), 프로필, 로그아웃', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  const acorn = createMembership()
  const globex = createMembership({ tenantId: 20, tenantName: 'Globex', tenantSlug: 'globex' })
  // 기본 fixture 엔 활성 테넌트가 없으므로 미리 심는다(AuthContext 가 localStorage 에서 복원).
  await page.addInitScript((m) => localStorage.setItem('activeTenant', JSON.stringify(m)), acorn)
  await mockApi(page, 'GET', '/api/v1/auth/memberships', [acorn, globex])
  await page.goto('/apps')
  // 본문엔 더 이상 레일용 스위처·유저 메뉴가 없다.
  await expect(page.getByTestId('workspace-switcher')).toHaveCount(0)
  await expect(page.getByTestId('rail-user-menu')).toHaveCount(0)
  const avatar = page.getByTestId('apps-account')
  await expect(avatar).toHaveAccessibleName('내 계정')
  await expect(avatar).toHaveText('테')
  await avatar.click()
  const sheet = page.getByTestId('apps-account-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText('테스트 사용자')).toBeVisible()
  await expect(sheet.getByText('test@example.com')).toBeVisible()
  await expect(sheet.getByText('워크스페이스', { exact: true })).toBeVisible()
  await expect(sheet.getByTestId('apps-workspace-1')).toContainText('에이콘 워크스페이스')
  await expect(sheet.getByTestId('apps-workspace-1')).toHaveAttribute('aria-current', 'true')
  await expect(sheet.getByTestId('apps-workspace-20')).toContainText('Globex')
  await expect(sheet.getByTestId('apps-profile')).toBeVisible()
  await expect(sheet.getByTestId('apps-logout')).toHaveText(/로그아웃/)
  await expectNoHorizontalOverflow(page)
  await sheet.getByTestId('apps-profile').click()
  await expect(page).toHaveURL(/\/settings\/profile$/)
})

test('계정 시트의 로그아웃은 로그인 화면으로', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await mockApi(page, 'POST', '/api/v1/auth/logout', {})
  await page.goto('/apps')
  await page.getByTestId('apps-account').click()
  await expectNoHorizontalOverflow(page)
  await page.getByTestId('apps-logout').click()
  await expect(page).toHaveURL(/\/login/)
})

test('구 경로 /more · /more/tabs 는 /apps · /apps/tabs 로 리다이렉트', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/more')
  await expect(page).toHaveURL(/\/apps$/)
  await expect(page.getByTestId('apps-app-home')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.goto('/more/tabs')
  await expect(page).toHaveURL(/\/apps\/tabs$/)
  await expect(page.getByText('탭바 순서 편집')).toBeVisible()
  await expect(page.getByTestId('mobile-tab-apps')).toHaveAttribute('aria-current', 'page')
  await expectNoHorizontalOverflow(page)
})

test('데스크톱 폭에서 /apps · /more 는 홈으로(모바일 전용 화면)', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/apps')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/more')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('mobile-tabbar')).toHaveCount(0)
})

test('앱 목록의 "탭바 순서 편집" 링크 → /apps/tabs', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps')
  await page.getByTestId('apps-edit-tabs').click()
  await expect(page).toHaveURL(/\/apps\/tabs$/)
  await expectNoHorizontalOverflow(page)
})

test('탭 편집: 메일을 빼고 캘린더를 넣으면 새로고침 후에도 유지', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps/tabs')
  await page.getByTestId('tab-edit-remove-2').click() // mail
  await page.getByTestId('tab-edit-add-calendar').click()
  await page.getByTestId('tab-edit-save').click()
  await expect(page).toHaveURL(/\/apps$/)
  await page.reload()
  await expect(page.getByTestId('mobile-tab-calendar')).toBeVisible()
  await expect(page.getByTestId('mobile-tab-mail')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('탭 편집: 3칸 미만이면 저장 불가', async ({ authenticatedPage: page }) => {
  await page.goto('/apps/tabs')
  await page.getByTestId('tab-edit-remove-0').click()
  await expect(page.getByTestId('tab-edit-save')).toBeDisabled()
  await expectNoHorizontalOverflow(page)
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
  await expectNoHorizontalOverflow(page)
})

test('알림 화면: 빈 상태', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/notifications', [])
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 0 })
  await page.goto('/notifications')
  await expect(page.getByTestId('inbox-empty')).toBeVisible()
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})
