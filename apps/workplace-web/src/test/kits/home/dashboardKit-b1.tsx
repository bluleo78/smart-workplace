// 홈 대시보드 화면 테스트 공용 도구(WP-982) — dashboardView·dashboardEdit 테스트가 같이 쓴다.
// e2e/pages/home.spec.ts 의 layout·mockWidgets 와 같은 데이터를 MSW 핸들러로 준다. 대시보드는 앱 셸 밖에서
// 인박스 컨텍스트(InboxProvider)를 쓰므로 그 provider 와 인박스 패널(InboxPanel)을 함께 띄운다 — App 전체(renderPage) 없이
// 헤더·멘션 셀이 패널을 여는 것까지 본다.
import { screen } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'

import { Dashboard } from '@/components/home/Dashboard'
import { InboxProvider } from '@/components/layout/InboxContext'
import { InboxPanel } from '@/components/layout/InboxPanel'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'
import type { CalendarEvent } from '@/types/calendar'
import type { DashboardLayout, DashboardWidgetConfig, MailSummary, MessagingSummary } from '@/types/dashboard'
import type { ChannelResponse } from '@/types/messaging'
import type { NotificationResponse } from '@/types/notification'

import { createIssue, createIssueSearchResponse } from '../../../../e2e/factories/issue.factory'

/** 저장 레이아웃 — 문자열은 {id=type, count 5, 보임} 으로 정규화. 순서가 곧 렌더 순서. */
export function layout(widgets: (string | DashboardWidgetConfig)[]): DashboardLayout {
  return { widgets: widgets.map((w) => (typeof w === 'string' ? { id: w, type: w, count: 5, hidden: false } : w)) }
}

/** 카탈로그 위젯 설정 한 줄. */
export const catalog = (id: string, type: string, params: Record<string, unknown> = {}, label: string | null = null): DashboardWidgetConfig => ({
  id,
  type,
  count: 0,
  hidden: false,
  params,
  label,
})

/** 내 작업 위젯용 이슈 1건(진행 중). */
export const issues = () => createIssueSearchResponse([createIssue({ id: 1, projectKey: 'WP', number: 7, title: '로그인 버그', status: 'IN_PROGRESS' })])

/** 알림 한 건 — 기본은 안 읽은 ASSIGNED. */
export function notification(over: Partial<NotificationResponse> = {}): NotificationResponse {
  return {
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
    ...over,
  }
}

const event: CalendarEvent = {
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
  calendarId: 1,
  calendarName: '내 캘린더',
  effectiveColor: '#3b82f6',
  createdAt: '2026-06-15T00:00:00Z',
  updatedAt: '2026-06-15T00:00:00Z',
}

const channel: ChannelResponse = {
  id: 10,
  kind: 'CHANNEL',
  name: 'general',
  visibility: 'PUBLIC',
  member: true,
  role: 'MEMBER',
  archived: false,
  memberCount: 5,
  unreadCount: 3,
  hasUnreadThreads: false,
  lastReadMessageId: null,
  createdAt: '2026-06-01T00:00:00Z',
}

/** 메일 요약 — 안 읽음 2 + 최근 1건(분류 꺼짐). */
export const mail = (): MailSummary => ({
  unreadCount: 2,
  needsReplyCount: 0,
  classificationActive: false,
  recent: [
    {
      id: 100,
      accountId: 1,
      subject: '월간 보고서',
      fromAddress: 'boss@example.com',
      fromName: '김부장',
      snippet: null,
      receivedAt: '2026-06-16T00:00:00Z',
      seen: false,
      hasAttachment: false,
      aiCategory: null,
      aiNeedsReply: null,
    },
  ],
})

const emptyMessaging: MessagingSummary = { unreadConversationCount: 0, needsReplyCount: 0, aiAttentionCount: 0, attentionCount: 0, recent: [] }

/** 5종 위젯 데이터 전부 정상(E2E mockWidgets 와 같음). */
export const widgetHandlers = (): RequestHandler[] => [
  http.get('/api/v1/me/issues', () => HttpResponse.json(issues())),
  http.get('/api/v1/me/watched-issues', () => HttpResponse.json(issues())),
  http.get('/api/v1/calendar/events', () => HttpResponse.json([event])),
  http.get('/api/v1/notifications', () => HttpResponse.json([notification()])),
  http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ count: 1 })),
  http.get('/api/v1/messaging/channels', () => HttpResponse.json([channel])),
  http.get('/api/v1/messaging/dms', () => HttpResponse.json([])),
  http.get('/api/v1/me/mail-summary', () => HttpResponse.json(mail())),
  http.get('/api/v1/me/messaging-summary', () => HttpResponse.json(emptyMessaging)),
]

/**
 * /me/dashboard 를 서버처럼 흉내 낸다 — GET 은 저장본, PUT 은 저장 후 그대로 돌려준다. PUT 본문·주소는 puts 에 모은다.
 */
export function dashboardServer(initial: DashboardLayout) {
  const state = { stored: initial, puts: [] as { url: URL; body: DashboardLayout }[] }
  const handlers = [
    http.get('/api/v1/me/dashboard', () => HttpResponse.json(state.stored)),
    http.put('/api/v1/me/dashboard', async ({ request }) => {
      const body = (await request.json()) as DashboardLayout
      state.puts.push({ url: new URL(request.url), body })
      state.stored = body
      return HttpResponse.json(body)
    }),
  ]
  return { state, handlers }
}

type Options = { handlers?: RequestHandler[]; widgets?: boolean }

/**
 * 대시보드(+인박스 패널)를 띄우고 첫 위젯 또는 빈 상태가 그려질 때까지 기다린다.
 * widgets=false 면 위젯 데이터를 주지 않는다(앱 셸 기본 빈 응답만 — E2E 에서 mockWidgets 를 부르지 않은 경우).
 */
export async function renderDashboard(saved: DashboardLayout, { handlers = [], widgets = true }: Options = {}) {
  const dash = dashboardServer(saved)
  const view = renderScreen(
    <InboxProvider>
      <Dashboard />
      <InboxPanel />
    </InboxProvider>,
    {
      path: '/',
      handlers: [
        ...handlers,
        ...dash.handlers,
        ...(widgets ? widgetHandlers() : []),
        // 인박스 패널(InboxList)이 열릴 때 웹 푸시 안내 여부를 묻는다 — 꺼진 서버로 둔다.
        http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: false, vapidPublicKey: null })),
        ...shellHandlers,
      ],
    },
  )
  await screen.findByTestId('dashboard')
  return { ...view, dash }
}

/** data-widget(type) 으로 카드 하나. */
export const card = (type: string) => document.querySelector<HTMLElement>(`[data-testid="dashboard-widget"][data-widget="${type}"]`)!
/** data-widget-id 로 카드 하나. */
export const cardById = (id: string) => document.querySelector<HTMLElement>(`[data-testid="dashboard-widget"][data-widget-id="${id}"]`)!
/** 카탈로그 카드 직속 헤더 링크(본문 안 링크와 구분). */
export const headerLink = (id: string) => cardById(id).querySelector<HTMLAnchorElement>(':scope > [data-slot="card-header"] a')
/** 지금 그려진 카드들의 data-widget 순서. */
export const order = () => screen.queryAllByTestId('dashboard-widget').map((el) => el.getAttribute('data-widget'))
