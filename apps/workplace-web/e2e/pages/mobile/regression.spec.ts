// 모바일 셸 회귀 스펙(WP-127) — 기존에 좁은 뷰포트(chromium 프로젝트 setViewportSize)로 검증하던
// AI 풀스크린·세션 전환·다이얼로그 케이스를 모바일 셸(하단 탭바 AI 탭) 기준으로 옮기고,
// 전역 부품(메일 작성 도크)이 탭바와 겹치지 않는지 확인한다.
// 이관 사유: 모바일(<1024px)엔 AI 칩(chat-launcher)·side 모드가 없고 AI 는 탭바 가운데 칸 = AI 시트다(WP-191, 구 풀스크린).
// 시트 폭·다이얼로그 위 AI 시트(실제 클릭·딤)·작성 도크 겹침·위치만 남긴다. 세션 스위처·캘린더 다이얼로그 칩 없음·⌘K 토글·
// 비루트 ✦·탭 루트 탭바/🔔 는 페이지 테스트 src/pages/mobile/shellRegression.test.tsx 가 지킨다(WP-981).
import { calendar, calendarEvent } from '../../factories/calendar.factory'
import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, expectNoHorizontalOverflow, expectOnTop, stubChat, test } from '../../fixtures/mobile.fixture'

test('AI 탭으로 시트를 열고 다른 탭으로도 닫는다 — 탭 루트 시트에도 × 가 있다(구 WP-111 이관, U2-3 → WP-191)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/')
  await page.getByTestId('mobile-tab-ai').click()
  const fs = page.getByTestId('ai-sheet')
  await expect(fs).toBeVisible()
  // 모바일엔 side 가 없다 — 사이드 패널·모드 전환 버튼·칩이 렌더되지 않는다.
  await expect(page.getByTestId('ai-side-panel')).toHaveCount(0)
  // 모드 전환 버튼은 DOM 에 있되 모바일에서 CSS 로 숨겨진다(count 0 이 아니라 hidden).
  await expect(page.getByTestId('ai-mode-fullscreen')).toBeHidden()
  await expect(page.getByTestId('chat-launcher')).toHaveCount(0)
  // 시트는 화면 폭 가득(구 "side 가 풀스크린 오버레이로 렌더된다" 이관).
  const box = (await fs.boundingBox())!
  expect(box.width).toBeGreaterThan(380)
  await expectNoHorizontalOverflow(page)
  // WP-191: 탭 루트에서도 시트엔 × 가 있다 — 그래도 탭 전환으로 닫힌다.
  await expect(fs.getByTestId('ai-panel-close')).toBeVisible()
  await page.getByTestId('mobile-tab-home').click()
  await expect(fs).toHaveCount(0)
})

test('모바일(<lg): ⌘K 로 다이얼로그 위 AI 시트를 열어 입력하고, Esc 로 AI 만 닫으면 다이얼로그로 돌아온다 (구 ai-screen-context 모바일 케이스 복원)', { tag: '@input' }, async ({
  authenticatedPage: page,
}) => {
  const ev = calendarEvent({ id: 42, title: '주간회의' })
  await mockApi(page, 'GET', '/api/v1/calendars', [calendar()])
  await mockApi(page, 'GET', '/api/v1/calendar/events', [ev])
  await mockApi(page, 'GET', '/api/v1/calendar/events/42', ev)
  await page.goto('/calendar?eventId=42')
  const dialog = page.getByTestId('calendar-event-dialog')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('ControlOrMeta+k')
  const fs = page.getByTestId('ai-sheet')
  await expect(fs).toBeVisible()
  // 시트(z-[60])가 다이얼로그(z-50) 위에 있고, 입력창은 실제 클릭·타이핑된다(가려지거나 inert 면 클릭이 실패).
  await fs.getByTestId('chat-input').click()
  // WP-54: 시트(AI 표면)를 눌러도 열린 엔티티 다이얼로그는 닫히지 않는다.
  await expect(dialog).toBeVisible()
  await page.getByTestId('chat-input').fill('참석자?')
  await expect(page.getByTestId('chat-input')).toHaveValue('참석자?')
  // AI 에서 Esc → AI 만 닫히고 다이얼로그는 그대로(모달 dim 복귀).
  await page.keyboard.press('Escape')
  await expect(fs).toHaveCount(0)
  await expect(dialog).toBeVisible()
  await expect(page.locator('[data-slot=dialog-overlay]')).toBeVisible()
  // 딤 탭으로 닫아도 마찬가지 — 딤은 AI 표면이라 다이얼로그의 바깥 클릭으로 취급되지 않는다(WP-191·WP-54).
  await page.keyboard.press('ControlOrMeta+k')
  await expect(fs).toBeVisible()
  await page.getByTestId('ai-sheet-backdrop').click({ position: { x: 20, y: 40 } })
  await expect(fs).toHaveCount(0)
  await expect(dialog).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

// WP-583: 모바일 작성은 화면 전체 작성 화면이라 탭바를 덮는다 — 탭바가 작성 화면 위로 비치거나 눌리면 안 된다.
test('메일 작성 화면이 탭바까지 덮는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary()])
  await page.goto('/mail')
  await page.getByTestId('mobile-sidebar-trigger').click()
  await page.getByTestId('mobile-sidebar-sheet').getByTestId('mail-compose-new').click()
  const dock = page.getByTestId('mail-compose-dock')
  await expect(dock).toBeVisible()
  // 편지쓰기를 누르면 시트는 닫힌다(WP-578) — 아직 열려 있으면 Esc 로 닫아 탭바 자리만 본다.
  if (await page.getByTestId('mobile-sidebar-sheet').isVisible()) await page.keyboard.press('Escape')
  await expect(page.getByTestId('mobile-sidebar-sheet')).toBeHidden()
  const bar = page.getByTestId('mobile-tabbar')
  const b = (await bar.boundingBox())!
  const d = (await dock.boundingBox())!
  // 작성 화면이 탭바 영역을 완전히 덮고, 그 자리의 맨 위 요소는 작성 화면이다.
  expect(d.y + d.height).toBeGreaterThanOrEqual(b.y + b.height - 0.5)
  await expectOnTop(page, bar, '[data-testid="mail-compose-dock"]')
  await expectNoHorizontalOverflow(page)
})

test('탭바가 숨은 메일 본문에서는 작성 도크가 화면 하단에 붙는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
