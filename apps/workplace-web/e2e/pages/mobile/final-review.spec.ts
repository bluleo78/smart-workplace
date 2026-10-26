// 모바일 셸 최종 리뷰 보정(WP-121) — 탭바가 숨은 탭 루트 상세의 AI 진입점, /settings 막다른 길,
// 캘린더 헤더 과밀, 탭 재탭 스크롤, ai-mode 비영속, 데스크톱 인박스 → 모바일 전환, 알림 제목 중복을 고정한다.
// 브라우저가 있어야 판정되는 것만 남긴다 — 실제 브라우저 기록 -1 로 돌아가는 ‹(@platform), 헤더 폭·재탭 스크롤·리사이즈(@layout).
// 상세 바 ✦ AI 진입점·설정 딥링크 ‹ 대상·ai-mode 비영속·알림 제목 중복은 페이지 테스트
// src/pages/mobile/mobileFinalReview.test.tsx 가 지킨다(WP-981).
import { createChannel, createDm } from '../../factories/messaging.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, expectNoHorizontalOverflow, stubChat, test, toCalendarMonthView } from '../../fixtures/mobile.fixture'
import { resizeAndSettle } from '../../fixtures/wait'

test('설정: 앱 → 설정 → ‹ 는 앱 목록으로 돌아간다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
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

test('캘린더 헤더: 390px 에서 제목이 읽히고 뷰 전환이 가능하다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  // 모바일 제목은 같은 해면 'M월', 다른 해면 'yyyy년 M월'(WP-136 — 「10월 ▾」 버튼, ▾ 는 아이콘).
  // 가장 긴 제목('yyyy년 12월' + ▾)을 만들려고 오늘을 2027-01 로 두고 월 보기에서 지난해 12월로 이동한다 — 실행 월과 무관.
  await page.clock.setFixedTime(new Date('2027-01-15T10:00:00'))
  await mockApi(page, 'GET', '/api/v1/calendars', [])
  await mockApi(page, 'GET', '/api/v1/calendar/events', [])
  await page.goto('/calendar')
  const title = page.getByTestId('calendar-title')
  await expect(title).toHaveText('1월')
  // 뷰 전환 select 는 제목 폭(22px 탭 루트 제목)을 지키려 헤더 아래 도구 줄에 있다(U2-5).
  const select = page.getByTestId('calendar-view-select')
  await expect(select).toBeVisible()
  // 모바일 첫 보기는 일정 목록(WP-136).
  await expect(page.getByTestId('calendar-view-agenda')).toBeVisible()
  await toCalendarMonthView(page)
  await page.getByTestId('calendar-prev').click()
  await expect(title).toHaveText('2026년 12월')
  // 헤더가 제목에 내준 폭(h1 은 flex-1 — 텍스트 길이와 무관)이 충분하다.
  const h1 = page.getByTestId('page-header').locator('h1')
  expect((await h1.boundingBox())!.width).toBeGreaterThan(80)
  // 제목이 잘리지 않는다(스크롤 폭 ≤ 표시 폭) — h1 과 그 안 제목 버튼의 달 글자(truncate) 모두.
  expect(await h1.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false)
  expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false)
  // 선택 → 실제 뷰가 바뀐다(상태만이 아니라 화면 반영) — 위에서 고른 월 보기가 그려져 있고, 목록으로 바꾸면 목록만 남는다.
  await expect(page.getByTestId('calendar-view-month')).toBeVisible()
  await expect(page.getByTestId('calendar-view-agenda')).toHaveCount(0)
  await select.selectOption('agenda')
  await expect(page.getByTestId('calendar-view-agenda')).toBeVisible()
  await expect(page.getByTestId('calendar-view-month')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('같은 탭 재탭 시 실제 스크롤 컨테이너가 맨 위로 돌아간다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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

test('데스크톱 인박스 Popover 를 연 채 좁히면 닫기만 하고 알림 화면으로 이동하지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await mockApi(page, 'GET', '/api/v1/notifications', [])
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 0 })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/chat')
  await page.getByTestId('inbox-trigger').click()
  await expect(page.getByTestId('inbox-mark-all')).toBeVisible()
  // 1024 경계를 넘는 리사이즈 — 셸 교체(MobileShell 마운트)까지 기다린다(WP-225).
  await resizeAndSettle(page, { width: 390, height: 844 })
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
  await expect(page).toHaveURL(/\/chat$/)
})

