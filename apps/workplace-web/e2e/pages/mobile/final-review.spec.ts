// 모바일 셸 최종 리뷰 보정(WP-121) — 탭바가 숨은 탭 루트 상세의 AI 진입점, /settings 막다른 길,
// 캘린더 헤더 과밀, 탭 재탭 스크롤, ai-mode 비영속, 데스크톱 인박스 → 모바일 전환, 알림 제목 중복을 고정한다.
import { createChannel, createDm } from '../../factories/messaging.factory'
import { member, memberDetail, page as makeContactPage } from '../../factories/contacts.factory'
import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'

test('메일 본문(탭바 숨김)에서도 ✦ 로 AI 풀스크린을 연다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary()])
  await mockApi(page, 'GET', '/api/v1/mail/messages/10', detail())
  await page.goto('/mail/1')
  await page.getByTestId('mail-row-10').click()
  await expect(page.getByTestId('mobile-tabbar')).toHaveCount(0)
  await expect(page.getByTestId('mail-back')).toBeVisible()
  await page.getByTestId('mobile-detail-ai').click()
  await expect(page.getByTestId('ai-fullscreen')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('연락처 상세(탭바 숨김)에서도 ✦ 로 AI 풀스크린을 연다', async ({ authenticatedPage: page }) => {
  await page.route((u) => u.pathname === '/api/v1/contacts', (r) => r.fulfill({ json: makeContactPage([member()]) }))
  await page.route((u) => u.pathname === '/api/v1/contacts/members/1', (r) => r.fulfill({ json: memberDetail() }))
  await page.goto('/contacts')
  await page.getByTestId('contact-row-MEMBER-1').click()
  await expect(page.getByTestId('mobile-tabbar')).toHaveCount(0)
  await expect(page.getByTestId('contact-back')).toBeVisible()
  await page.getByTestId('mobile-detail-ai').click()
  await expect(page.getByTestId('ai-fullscreen')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('설정: 앱 → 설정 → ‹ 는 앱 목록으로 돌아간다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps')
  await page.getByTestId('apps-app-settings').click()
  await expect(page).toHaveURL(/\/settings$/)
  // 목록은 그대로 보이고, 탭 루트가 아니므로 큰 제목 대신 뒤로가기 바가 뜬다.
  await expect(page.getByTestId('settings-sidebar')).toBeVisible()
  await expect(page.getByTestId('mobile-list-header')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await page.getByTestId('mobile-back').click()
  await expect(page).toHaveURL(/\/apps$/)
})

test('설정 딥링크: /settings/notifications → ‹ → /settings → ‹ → /apps', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/settings/notifications')
  await page.getByTestId('mobile-back').click()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByTestId('settings-sidebar')).toBeVisible()
  await page.getByTestId('mobile-back').click()
  await expect(page).toHaveURL(/\/apps$/)
})

test('캘린더 헤더: 390px 에서 제목이 읽히고 뷰 전환이 가능하다', async ({ authenticatedPage: page }) => {
  // 가장 긴 제목('yyyy년 MM월' 두 자리 월)으로 고정 — 실행 월에 따라 결과가 달라지지 않게.
  await page.clock.setFixedTime(new Date('2026-12-15T10:00:00'))
  await mockApi(page, 'GET', '/api/v1/calendars', [])
  await mockApi(page, 'GET', '/api/v1/calendar/events', [])
  await page.goto('/calendar')
  const title = page.getByTestId('calendar-title')
  await expect(title).toHaveText('2026년 12월')
  // 헤더가 제목에 내준 폭(h1 은 flex-1 — 텍스트 길이와 무관)이 충분하다.
  const h1 = page.getByTestId('page-header').locator('h1')
  expect((await h1.boundingBox())!.width).toBeGreaterThan(80)
  // 제목이 잘리지 않는다(스크롤 폭 ≤ 표시 폭).
  expect(await h1.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false)
  // 뷰 전환 select 는 제목 폭(22px 탭 루트 제목)을 지키려 헤더 아래 도구 줄에 있다(U2-5).
  const select = page.getByTestId('calendar-view-select')
  await expect(select).toBeVisible()
  await expect(page.getByTestId('calendar-view-month')).toBeVisible()
  // 선택 → 실제 뷰가 바뀐다(상태만이 아니라 화면 반영).
  await select.selectOption('agenda')
  await expect(page.getByTestId('calendar-view-agenda')).toBeVisible()
  await expect(page.getByTestId('calendar-view-month')).toHaveCount(0)
  await select.selectOption('month')
  await expect(page.getByTestId('calendar-view-month')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('같은 탭 재탭 시 실제 스크롤 컨테이너가 맨 위로 돌아간다', async ({ authenticatedPage: page }) => {
  // 긴 채널 목록 — 목록 영역이 스크롤되도록 충분히 많이.
  const channels = Array.from({ length: 40 }, (_, i) => createChannel({ id: i + 1, name: `채널-${i + 1}` }))
  await page.route((u) => u.pathname === '/api/v1/messaging/channels', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: channels }) : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/messaging/dms', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: [createDm({ id: 99 })] }) : r.fallback())
  await page.goto('/chat')
  await expect(page.getByText('채널-40')).toBeAttached()
  const list = page.getByTestId('mobile-module-list')
  await list.evaluate((el) => el.scrollTo({ top: 600 }))
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await page.getByTestId('mobile-tab-chat').click()
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0)
})

test('모바일에서 AI 를 열어도 ai-mode 를 영속하지 않는다(데스크톱 ⌘K 기본값 보존)', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/')
  await page.getByTestId('mobile-tab-ai').click()
  await expect(page.getByTestId('ai-fullscreen')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('ai-mode'))).toBeNull()
})

test('데스크톱 인박스 Popover 를 연 채 좁히면 닫기만 하고 알림 화면으로 이동하지 않는다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await mockApi(page, 'GET', '/api/v1/notifications', [])
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 0 })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/chat')
  await page.getByTestId('inbox-trigger').click()
  await expect(page.getByTestId('inbox-mark-all')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
  await expect(page).toHaveURL(/\/chat$/)
})

test('알림 화면: 제목 "알림" 은 한 번만 보이고 모두 읽음은 남는다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/notifications', [])
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 0 })
  await page.goto('/notifications')
  await expect(page.getByTestId('inbox-mark-all')).toBeVisible()
  await expect(page.getByText('알림', { exact: true })).toHaveCount(1)
  await expectNoHorizontalOverflow(page)
})
