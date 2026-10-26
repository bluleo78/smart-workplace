// 휴대폰에서 작은 버튼·링크의 터치 영역(WP-734) — 보이는 크기는 그대로 두고, 터치(pointer: coarse)에서 실제로 눌리는 영역이 24×24px
// (WCAG 2.2 「대상 크기(최소)」) 이상인지 화면마다 잰다. 홈 메일 안내 「닫기」 14px·드라이브 「팀 공간 만들기」 16px 처럼 아이콘만 있는 버튼이
// 손가락으로 누르기 어려웠다.
import type { MailSummary, MessagingSummary } from '../../../src/types/dashboard'
import type { AgentResponse } from '../../../src/types/agent'
import { calendar } from '../../factories/calendar.factory'
import { createSpace, personalSpace } from '../../factories/drive.factory'
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'
import { setupAdminAuth, setupRoleDetailMocks } from '../../fixtures/admin.fixture'
import { mockApi } from '../../fixtures/api-mock'
import { stubChannelMessages } from '../../fixtures/mobile-chat'
import { expect, expectTouchTarget, test } from '../../fixtures/mobile.fixture'

test('홈 — 메일 분류 안내의 「닫기」·「켜기」와 위젯 머리말 링크', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
  await mockApi(page, 'GET', '/api/v1/me/issues', createIssueSearchResponse([createIssue({ id: 7, number: 7 })]))
  const mail: MailSummary = { unreadCount: 2, needsReplyCount: 0, classificationActive: false, recent: [] }
  await mockApi(page, 'GET', '/api/v1/me/mail-summary', mail)
  const messaging: MessagingSummary = {
    unreadConversationCount: 0,
    needsReplyCount: 0,
    aiAttentionCount: 0,
    attentionCount: 0,
    recent: [],
  }
  await mockApi(page, 'GET', '/api/v1/me/messaging-summary', messaging)
  await page.route((u) => u.pathname === '/api/v1/me/dashboard', (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({
        json: {
          widgets: ['synthesis', 'my_tasks'].map((id) => ({ id, type: id, count: 3, hidden: false, collapsed: false })),
        },
      })
      : r.fallback())
  await page.goto('/')

  const cta = page.getByTestId('dashboard-mail-cta')
  await expectTouchTarget(cta.getByRole('button', { name: '닫기' }))
  await expectTouchTarget(cta.getByRole('link', { name: '켜기' }))
  // 보이는 아이콘 크기는 그대로(14px) — 눌림 영역만 넓힌다.
  expect(Math.round((await cta.getByRole('button', { name: '닫기' }).boundingBox())!.height)).toBeLessThan(20)
  await expectTouchTarget(page.getByRole('link', { name: /내 작업/ }).first())
})

test('드라이브 — 「공간」 머리말의 「팀 공간 만들기」', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: [personalSpace(), createSpace()] }) : r.fallback())
  await page.goto('/drive')
  await expectTouchTarget(page.getByRole('button', { name: '팀 공간 만들기' }))
})

test('캘린더 시트 — 「캘린더 추가」와 캘린더 표시 체크박스', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-10-13T10:00:00'))
  await page.route((u) => u.pathname === '/api/v1/calendars', (r) =>
    r.fulfill({ json: [calendar({ id: 1, name: '기본' })] }))
  await page.route((u) => u.pathname.startsWith('/api/v1/calendar/events'), (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.fallback())
  await page.goto('/calendar')
  await page.getByTestId('mobile-sidebar-trigger').click()
  const sheet = page.getByTestId('mobile-sidebar-sheet')
  await expect(sheet).toBeVisible()
  await expectTouchTarget(sheet.getByTestId('calendar-add'))
  await expectTouchTarget(sheet.getByTestId('calendar-toggle-1'))
  await expectTouchTarget(sheet.getByTestId('calendar-layer-issue-dues'))
  await expectTouchTarget(sheet.getByTestId('calendar-layer-invited'))
})

test('설정 > 에이전트 — 「개인 비서 표시」 스위치', { tag: '@layout' }, async ({ adminPage: page }) => {
  const agents: AgentResponse[] = []
  await page.route(/\/api\/v1\/admin\/agents(\?.*)?$/, (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: agents }) : r.fallback())
  await page.route('**/api/v1/admin/workspace-assistant', (r) =>
    r.fulfill({ json: { agentUserId: null, agentName: null, hasActiveToken: false, model: null, thinkingDepth: null } }))
  await page.goto('/settings/agents')
  await expectTouchTarget(page.getByTestId('include-personal-toggle'))
})

test('설정 > 역할 상세 — 권한 체크박스(테두리 있는 16px)', { tag: '@layout' }, async ({ adminPage: page }) => {
  await setupAdminAuth(page)
  await setupRoleDetailMocks(page, 3, false)
  await page.goto('/settings/roles/3')
  await expectTouchTarget(page.locator('[id^="perm-"]').first())
})

test('채널 — 메시지 밑 「답글 N개」 스레드 링크', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubChannelMessages(page)
  await page.goto('/chat/channels/1')
  // 위 본문의 멘션 칩 탭이 이 링크로 옮겨지지 않게(uiux-u4 H1) 숨은 영역 대신 버튼 자체가 24px 다.
  await expectTouchTarget(page.getByTestId('message-thread-link-10'))
})
