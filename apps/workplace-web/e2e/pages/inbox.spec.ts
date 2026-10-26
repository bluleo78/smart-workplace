// 알림 인박스(앱 레일 종) E2E — 화면 배선(@wiring)과 알림에서 다른 화면으로 넘어가 그 화면이 열리는 흐름(@flow)만 남긴다.
// 목록 문구·에이전트 배지·빈 상태·「모두 읽음」 활성/요청·행 클릭의 읽음 요청과 이동 주소·다음 페이지 이어 붙이기는
// 화면 컴포넌트 테스트 src/components/layout/appRail.test.tsx 가, 없는 일정 딥링크 안내는
// src/pages/calendar/calendarEventDeepLink.test.tsx 가 지킨다(WP-971).
import { mockApi } from '../fixtures/api-mock'
import { mockAgentWorkDetail } from '../fixtures/issue-detail-mock'
import { expect, test } from '../fixtures/auth.fixture'
import type { NotificationResponse } from '../../src/types/notification'

// 알림 1건 팩토리.
function notif(over: Partial<NotificationResponse> = {}): NotificationResponse {
  return {
    id: 1,
    type: 'COMMENTED',
    actorId: 9,
    actorName: 'AI 동료',
    actorKind: 'AGENT',
    issueId: 7,
    projectKey: 'WP',
    issueNumber: 3,
    issueTitle: '리팩터링',
    commentId: 55,
    eventId: null,
    eventTitle: null,
    eventStartsAt: null,
    read: false,
    createdAt: new Date().toISOString(),
    ...over,
  }
}

test('안읽음 배지가 카운트를 렌더한다', { tag: ['@wiring', '@smoke'] }, async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 3 })
  await page.goto('/')
  await expect(page.getByTestId('inbox-badge')).toHaveText('3')
})

// #659 — 캘린더 알림 클릭 시 고정 '/calendar' 대신 eventId 딥링크로 이동 + 해당 일정 상세 모달 자동 오픈.
test('REMINDER 알림은 일정 정보를 렌더하고 클릭 시 해당 일정 상세로 딥링크된다 (#659)', { tag: '@flow' }, async ({
  authenticatedPage: page,
}) => {
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 1 })
  await mockApi(page, 'GET', '/api/v1/notifications', [
    notif({
      id: 2,
      type: 'REMINDER',
      actorId: null,
      actorName: null,
      actorKind: null,
      commentId: null,
      eventId: 5,
      eventTitle: '팀 회의',
      eventStartsAt: '2026-06-10T01:00:00Z',
    }),
  ])
  await mockApi(page, 'POST', '/api/v1/notifications/2/read', {}, { status: 204 })
  // 딥링크가 여는 단건 일정 조회 — CalendarPage 가 이 응답으로 anchor 이동 + 모달 오픈.
  await mockApi(page, 'GET', '/api/v1/calendar/events/5', {
    id: 5,
    title: '팀 회의',
    description: null,
    startsAt: '2026-06-10T01:00:00Z',
    endsAt: '2026-06-10T02:00:00Z',
    allDay: false,
    location: null,
    color: null,
    calendarId: 1,
    calendarName: '기본',
    effectiveColor: 'blue',
    reminderMinutes: null,
    recurrenceRule: null,
    createdAt: '2026-06-10T01:00:00Z',
    updatedAt: '2026-06-10T01:00:00Z',
  })
  await page.goto('/')
  await page.getByTestId('inbox-trigger').click()
  const item = page.getByTestId('inbox-item').first()
  await expect(item).toContainText('일정 알림')
  await expect(item).toContainText('팀 회의')
  await item.click()

  // 상세 모달이 자동으로 열리고 해당 일정 제목이 채워진다.
  await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()
  await expect(page.getByTestId('calendar-form-title')).toHaveValue('팀 회의')
  // 일정 상세는 URL ?eventId 로 열린 상태를 유지한다(뒤로가기로 닫힘, WP-208).
  await expect(page).toHaveURL(/\/calendar\?eventId=\d+$/)
})

// WP-452 — 이슈 챗 AI 질문·멘션 알림은 기존 행 레이아웃 그대로 문구만 다르고, 클릭하면 이슈 챗 드로워가 열린 이슈 상세로 간다.
test('이슈 챗 AI 질문·멘션 알림을 렌더하고, 클릭하면 이슈 챗 드로워가 열린 이슈로 이동한다 (WP-452)', { tag: '@flow' }, async ({
  authenticatedPage: page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 2 })
  await mockApi(page, 'GET', '/api/v1/notifications', [
    notif({ id: 21, type: 'AI_QUESTION', actorName: '개발 에이전트', commentId: null, issueNumber: 12, issueTitle: '알림 연결' }),
    notif({
      id: 22,
      type: 'ISSUE_CHAT_MENTION',
      actorName: '박민수',
      actorKind: 'HUMAN',
      commentId: null,
      issueNumber: 12,
      issueTitle: '알림 연결',
    }),
  ])
  const readCapture = await mockApi(page, 'POST', '/api/v1/notifications/21/read', {}, {
    status: 204,
    capture: true,
  })
  // 이동한 이슈 상세(WP-12)와 그 이슈 챗 스레드 모킹.
  await mockAgentWorkDetail(page, undefined)
  await page.goto('/')
  await page.getByTestId('inbox-trigger').click()

  const items = page.getByTestId('inbox-item')
  // AGENT 행위자는 이름 뒤에 에이전트 배지가 붙는다 — 이름·문구를 따로 확인.
  await expect(items.nth(0)).toContainText('개발 에이전트')
  await expect(items.nth(0)).toContainText('님이 이슈 챗에서 질문했습니다')
  await expect(items.nth(0)).toContainText('WP-12 알림 연결')
  await expect(items.nth(1)).toContainText('박민수님이 이슈 챗에서 회원님을 멘션했습니다')

  await items.nth(0).click()
  await readCapture.waitForRequest()
  await expect(page).toHaveURL(/\/projects\/WP\/issues\/12\?chat=1$/)
  await expect(page.getByTestId('issue-chat-drawer')).toBeVisible()
})

