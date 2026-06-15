import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures/auth.fixture'
import { mockApi } from '../fixtures/api-mock'
import { createIssue, createIssueSearchResponse } from '../factories/issue.factory'
import type { CalendarEvent } from '../../src/types/calendar'
import type { DashboardLayout, MailSummary } from '../../src/types/dashboard'
import type { ChannelResponse, DmResponse } from '../../src/types/messaging'
import type { NotificationResponse } from '../../src/types/notification'

// 홈 고정 대시보드 E2E — 저장 레이아웃 순서로 5종 위젯 렌더 + 위젯별 격리(로딩/에러).
// 백엔드 없이 /me/dashboard·위젯별 엔드포인트를 모킹해 검증한다.
// (구 AI 캔버스/세션 스위처/챗 도크 E2E 는 대시보드 전환으로 폐기됨.)

// 레이아웃 응답 헬퍼 — 위젯 키 순서가 곧 렌더 순서.
function layout(widgets: string[]): DashboardLayout {
  return { widgets }
}

// 내 작업 위젯용 이슈 1건.
function issues() {
  return createIssueSearchResponse([
    createIssue({ id: 1, projectKey: 'WP', number: 7, title: '로그인 버그', status: 'IN_PROGRESS' }),
  ])
}

// 오늘 일정 1건.
function events(): CalendarEvent[] {
  return [
    {
      id: 1,
      title: '스탠드업 미팅',
      description: null,
      startsAt: '2026-06-16T01:00:00Z',
      endsAt: '2026-06-16T01:30:00Z',
      allDay: false,
      location: null,
      color: null,
      reminderMinutes: null,
      recurrenceRule: null,
      createdAt: '2026-06-15T00:00:00Z',
      updatedAt: '2026-06-15T00:00:00Z',
    },
  ]
}

// 알림 1건(안 읽음).
function notifications(): NotificationResponse[] {
  return [
    {
      id: 1,
      type: 'ASSIGNED',
      actorId: 2,
      actorName: '양동희',
      actorKind: 'HUMAN',
      issueId: 1,
      projectKey: 'WP',
      issueNumber: 7,
      issueTitle: '리뷰 요청 이슈',
      commentId: null,
      eventId: null,
      eventTitle: null,
      eventStartsAt: null,
      read: false,
      createdAt: '2026-06-16T00:00:00Z',
    },
  ]
}

// 안 읽은 메시지가 있는 채널 1건.
function channels(): ChannelResponse[] {
  return [
    {
      id: 10,
      kind: 'CHANNEL',
      name: 'general',
      visibility: 'PUBLIC',
      member: true,
      role: 'MEMBER',
      archived: false,
      memberCount: 5,
      unreadCount: 3,
      createdAt: '2026-06-01T00:00:00Z',
    },
  ]
}

const emptyDms: DmResponse[] = []

// 메일 요약(안 읽음 2 + 최근 1건).
function mail(): MailSummary {
  return {
    unreadCount: 2,
    recent: [
      {
        id: 100,
        subject: '월간 보고서',
        fromAddress: 'boss@example.com',
        fromName: '김부장',
        receivedAt: '2026-06-16T00:00:00Z',
        seen: false,
      },
    ],
  }
}

// 5종 위젯 데이터 전부 정상 모킹.
async function mockWidgets(page: Page) {
  await mockApi(page, 'GET', '/api/v1/me/issues', issues())
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', issues())
  await mockApi(page, 'GET', '/api/v1/calendar/events', events())
  await mockApi(page, 'GET', '/api/v1/notifications', notifications())
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 1 })
  await mockApi(page, 'GET', '/api/v1/messaging/channels', channels())
  await mockApi(page, 'GET', '/api/v1/messaging/dms', emptyDms)
  await mockApi(page, 'GET', '/api/v1/me/mail-summary', mail())
}

test('대시보드 — 저장 레이아웃 순서로 5종 위젯이 렌더된다', { tag: '@smoke' }, async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(
    page,
    'GET',
    '/api/v1/me/dashboard',
    layout(['my_tasks', 'calendar_today', 'notifications', 'recent_chats', 'unread_mail']),
  )
  await page.goto('/')

  // 위젯 카드 5개 렌더.
  await expect(page.getByTestId('dashboard-widget')).toHaveCount(5)

  // 각 위젯 본문이 데이터로 채워졌는지(요소 존재가 아니라 내용 검증).
  await expect(page.getByTestId('dash-calendar')).toContainText('스탠드업 미팅')
  await expect(page.getByTestId('dash-notif')).toContainText('리뷰 요청 이슈')
  await expect(page.getByTestId('dash-chats')).toContainText('general')
  await expect(page.getByTestId('dash-mail')).toContainText('월간 보고서')

  // 홈에 하단 AI 챗 입력이 없어야 한다(대시보드 전환 핵심 요건).
  await expect(page.getByTestId('chat-input')).toHaveCount(0)
})

test('대시보드 — 알 수 없는 위젯 키는 조용히 스킵된다', async ({ authenticatedPage: page }) => {
  await mockWidgets(page)
  // 유효 2종 + 미등록 키 1종.
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks', 'unknown_widget', 'unread_mail']))
  await page.goto('/')

  // 미등록 키는 무시 → 카드 2개만.
  await expect(page.getByTestId('dashboard-widget')).toHaveCount(2)
  await expect(page.getByTestId('dash-mail')).toContainText('월간 보고서')
})

test('대시보드 — 위젯 헤더 클릭 시 딥링크로 이동한다', async ({ authenticatedPage: page }) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['unread_mail']))
  await page.goto('/')

  // 메일 위젯 헤더 링크 → /mail.
  const link = page.getByTestId('dashboard-widget').getByRole('link', { name: /안 읽은 메일/ })
  await expect(link).toHaveAttribute('href', '/mail')
})

test('대시보드 — 한 위젯 데이터 실패는 격리되어 다른 위젯에 영향이 없다', async ({
  authenticatedPage: page,
}) => {
  // 메일만 500, 나머지는 정상.
  await mockApi(page, 'GET', '/api/v1/me/issues', issues())
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', issues())
  await mockApi(page, 'GET', '/api/v1/me/mail-summary', { message: 'server error' }, { status: 500 })
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks', 'unread_mail']))
  await page.goto('/')

  // 메일 위젯은 에러+재시도, 내 작업 위젯은 정상 카운트.
  await expect(page.getByTestId('dash-mail-error')).toBeVisible()
  await expect(page.getByTestId('dash-mail-error').getByRole('button', { name: '다시 시도' })).toBeVisible()
  await expect(page.getByTestId('dash-mytasks')).toBeVisible()
  // 메일 위젯의 거짓 빈/정상 상태는 노출되지 않아야 한다(회귀 가드).
  await expect(page.getByTestId('dash-mail')).toHaveCount(0)
  await expect(page.getByTestId('dash-mail-empty')).toHaveCount(0)
})
