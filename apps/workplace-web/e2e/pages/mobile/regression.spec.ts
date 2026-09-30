// 모바일 셸 회귀 스펙(WP-127) — 기존에 좁은 뷰포트(chromium 프로젝트 setViewportSize)로 검증하던
// AI 풀스크린·세션 전환·다이얼로그 케이스를 모바일 셸(하단 탭바 AI 탭) 기준으로 옮기고,
// 전역 부품(메일 작성 도크)이 탭바와 겹치지 않는지 확인한다.
// 이관 사유: 모바일(<1024px)엔 AI 칩(chat-launcher)·side 모드가 없고 AI 는 탭바 가운데 탭 = 풀스크린이다.
import { calendar, calendarEvent } from '../../factories/calendar.factory'
import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { createProject } from '../../factories/project.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'

test('AI 탭으로 풀스크린을 열고 닫기 버튼으로 닫는다 (구 WP-111 이관)', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/')
  await page.getByTestId('mobile-tab-ai').click()
  const fs = page.getByTestId('ai-fullscreen')
  await expect(fs).toBeVisible()
  // 모바일엔 side 가 없다 — 사이드 패널·모드 전환 버튼·칩이 렌더되지 않는다.
  await expect(page.getByTestId('ai-side-panel')).toHaveCount(0)
  // 모드 전환 버튼은 DOM 에 있되 모바일에서 CSS 로 숨겨진다(count 0 이 아니라 hidden).
  await expect(page.getByTestId('ai-mode-fullscreen')).toBeHidden()
  await expect(page.getByTestId('chat-launcher')).toHaveCount(0)
  // 풀스크린은 화면 폭 가득(구 "side 가 풀스크린 오버레이로 렌더된다" 이관).
  const box = (await fs.boundingBox())!
  expect(box.width).toBeGreaterThan(380)
  await expectNoHorizontalOverflow(page)
  await page.getByTestId('ai-panel-close').click()
  await expect(fs).toHaveCount(0)
})

test('AI 풀스크린: 좌측 세션목록이 숨겨지고 헤더 드롭다운이 세션 전환을 제공한다 (구 #203 이관)', async ({
  authenticatedPage: page,
}) => {
  await stubChat(page)
  await mockApi(page, 'GET', '/api/v1/home/sessions', {
    items: [
      { id: 's-mob1', title: '모바일 대화 1', lastMessageAt: '2026-06-10T00:00:00Z', widgetCount: 0 },
      { id: 's-mob2', title: '모바일 대화 2', lastMessageAt: '2026-06-10T01:00:00Z', widgetCount: 0 },
    ],
    nextCursor: null,
  })
  await mockApi(page, 'GET', '/api/v1/home/sessions/s-mob1/messages', [])
  await page.goto('/')
  await page.getByTestId('mobile-tab-ai').click()
  await expect(page.getByTestId('ai-fullscreen')).toBeVisible()

  // 좌측 세션 목록은 숨김(hidden md:flex → 390px 에서 비표시), 대신 헤더 스위처가 보인다.
  expect(await page.getByTestId('ai-fs-sessions').boundingBox()).toBeNull()
  await expect(page.getByTestId('ai-fs-mobile-session-switcher')).toBeVisible()
  // 채팅 패널이 전체 폭을 차지해 입력창이 정상 너비를 가진다.
  const input = await page.getByTestId('chat-input').boundingBox()
  expect(input!.width).toBeGreaterThan(100)

  // 드롭다운 열기 → 세션 선택 시 메뉴가 닫힌다(#451).
  await page.getByTestId('ai-fs-mobile-session-switcher').click()
  const menu = page.getByRole('menu', { name: '대화 선택' })
  await expect(menu).toBeVisible()
  await menu.getByText('모바일 대화 1').click()
  await expect(menu).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('캘린더 일정 다이얼로그: 칩·사이드 패널 없이 열리고 Esc 로 닫힌다 (구 ai-screen-context 모바일 케이스 대체)', async ({
  authenticatedPage: page,
}) => {
  // 구 케이스는 ⌘K 로 side→풀스크린 패널을 다이얼로그 위에 띄웠으나, 모바일 셸엔 칩·⌘K 가 없고
  // AI 는 탭바(탭 루트에서만 노출) 로만 열린다. 여기선 다이얼로그가 셸 안에서 정상 동작함만 확인한다.
  const ev = calendarEvent({ id: 42, title: '주간회의' })
  await mockApi(page, 'GET', '/api/v1/calendars', [calendar()])
  await mockApi(page, 'GET', '/api/v1/calendar/events', [ev])
  await mockApi(page, 'GET', '/api/v1/calendar/events/42', ev)
  await page.goto('/calendar?eventId=42')
  const dialog = page.getByTestId('calendar-event-dialog')
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('chat-launcher')).toHaveCount(0)
  await expect(page.getByTestId('ai-side-panel')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('메일 작성 도크가 탭바와 겹치지 않는다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary()])
  await page.goto('/mail')
  await page.getByTestId('mobile-sidebar-trigger').click()
  await page.getByTestId('mobile-sidebar-sheet').getByTestId('mail-compose-new').click()
  const dock = page.getByTestId('mail-compose-dock')
  await expect(dock).toBeVisible()
  // 작성을 눌러도 시트는 열린 채이므로 Esc 로 명시적으로 닫아 탭바를 드러낸다.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('mobile-sidebar-sheet')).toBeHidden()
  const bar = page.getByTestId('mobile-tabbar')
  await expect(bar).toBeVisible()
  const d = (await dock.boundingBox())!
  const b = (await bar.boundingBox())!
  // 도크 하단이 탭바 상단 이상으로 내려가지 않아야 한다.
  expect(d.y + d.height).toBeLessThanOrEqual(b.y + 0.5)
  await expectNoHorizontalOverflow(page)
})

test('탭바가 숨은 메일 본문에서는 작성 도크가 화면 하단에 붙는다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary()])
  await mockApi(page, 'GET', '/api/v1/mail/messages/10', detail())
  await page.goto('/mail/1')
  await page.getByTestId('mail-row-10').click()
  await expect(page.getByTestId('mobile-tabbar')).toHaveCount(0)
  await page.getByTestId('mail-reply').click()
  const dock = page.getByTestId('mail-compose-dock')
  await expect(dock).toBeVisible()
  const d = (await dock.boundingBox())!
  const vh = page.viewportSize()!.height
  // 탭바가 없으면 오프셋 0 — 도크 하단이 뷰포트 하단에 닿는다.
  expect(Math.abs(d.y + d.height - vh)).toBeLessThanOrEqual(1)
})

test('탭 루트가 아닌 PageHeader 화면(사이클)에도 뒤로가기 바 ✦ 로 AI 풀스크린을 열 수 있다', async ({ authenticatedPage: page }) => {
  // 탭바가 없는 비루트 화면의 AI 진입점 검증 — 비루트 PageHeader 화면은 모두 ResponsiveModuleLayout 의
  // 뒤로가기 바(mobile-back-ai) 아래에 있어 별도 헤더 ✦ 가 필요 없다(/calendar 등은 탭 루트라 탭바가 보인다).
  await page.route('**/api/v1/projects/WP', (r) => r.fulfill({ json: createProject() }))
  await page.route('**/api/v1/projects/WP/cycles', (r) => r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.fallback())
  await page.route('**/api/v1/projects/WP/cycles/progress', (r) => r.fulfill({ json: [] }))
  await stubChat(page)
  await page.goto('/projects/WP/cycles')
  await expect(page.getByTestId('mobile-tabbar')).toHaveCount(0)
  await expect(page.getByTestId('page-header')).toBeVisible()
  await page.getByTestId('mobile-back-ai').click()
  await expect(page.getByTestId('ai-fullscreen')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('캘린더는 탭 루트라 탭바(AI 탭)가 항상 보인다', async ({ authenticatedPage: page }) => {
  await page.goto('/calendar')
  await expect(page.getByTestId('mobile-tab-ai')).toBeVisible()
})

test('탭 루트 헤더에는 🔔 이 보인다', async ({ authenticatedPage: page }) => {
  await page.goto('/')
  await expect(page.getByTestId('mobile-bell')).toBeVisible()
})
