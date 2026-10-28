// 홈 대시보드 위젯 본문·합성·카탈로그 편집 — 화면 컴포넌트 테스트(WP-971, WP-995).
// 오늘 일정·내 작업·알림·메일·대화·AI 우선순위 위젯 본문, 합성(요약 KPI·지금 신경 쓸 일·메일 분류 CTA), 카탈로그 위젯 추가·설정·삭제·
// 테두리 숨김 저장 payload 는 API 응답 → 화면, 클릭 → 요청·이동 주소로 판정되므로 e2e/pages/home.spec.ts 에서 옮겼다.
// 남은 E2E: 홈 배선(@wiring)·다른 화면을 오가는 캐시 갱신(@flow)·그리드 폭·KPI 한 줄(@layout)·터치 태블릿 오터치(@input).
// 앱 셸 없이 대시보드(Dashboard)만 renderScreen 으로 띄운다 — 알림 인박스는 AppRail 이 그리므로 열림 여부는 InboxContext 로 본다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import type { PriorityItemsResponse } from '@/api/priorityItems'
import { Dashboard } from '@/components/home/Dashboard'
import { InboxProvider, useInboxPanel } from '@/components/layout/InboxContext'
import { renderScreen } from '@/test/renderScreen'
import type { CalendarEvent } from '@/types/calendar'
import type { DashboardLayout, DashboardWidgetConfig, MailSummary, MessagingSummary } from '@/types/dashboard'
import type { NotificationResponse } from '@/types/notification'

import { calendarEvent } from '../../../e2e/factories/calendar.factory'
import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'

const API = '/api/v1'

afterEach(() => {
  vi.useRealTimers()
})

/** 레이아웃 — 문자열은 {type, count 5, 보임} 으로 정규화(E2E home.spec 의 layout 과 같음). */
function layout(widgets: (string | DashboardWidgetConfig)[]): DashboardLayout {
  return { widgets: widgets.map((w) => (typeof w === 'string' ? { id: w, type: w, count: 5, hidden: false } : w)) }
}

/** 알림 한 건 — 이슈 알림 기본값에 필요한 칸만 덮어쓴다. */
function notif(over: Partial<NotificationResponse> & { id: number }): NotificationResponse {
  return {
    type: 'ASSIGNED', actorId: 2, actorName: '양동희', actorKind: 'HUMAN', issueId: 1, projectKey: 'WP', issueNumber: 7,
    issueTitle: '리뷰 요청 이슈', commentId: null, eventId: null, eventTitle: null, eventStartsAt: null, read: false,
    createdAt: '2026-06-16T00:00:00Z', ...over,
  }
}

/** 메일 요약 한 줄. */
function mailItem(over: Partial<MailSummary['recent'][number]> & { id: number; subject: string }): MailSummary['recent'][number] {
  return {
    accountId: 1, fromAddress: 'boss@example.com', fromName: '김부장', snippet: null, receivedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    seen: false, hasAttachment: false, aiCategory: null, aiNeedsReply: null, ...over,
  }
}

const baseMail: MailSummary = { unreadCount: 2, needsReplyCount: 0, classificationActive: false, recent: [mailItem({ id: 100, subject: '월간 보고서' })] }
const emptyMessaging: MessagingSummary = { unreadConversationCount: 0, needsReplyCount: 0, aiAttentionCount: 0, attentionCount: 0, recent: [] }

type Data = {
  events?: CalendarEvent[]
  notifications?: NotificationResponse[]
  mail?: MailSummary | (() => MailSummary)
  messaging?: MessagingSummary
  priority?: PriorityItemsResponse
  issues?: ReturnType<typeof createIssue>[]
}

/**
 * 위젯이 부르는 조회 전부(E2E mockWidgets 와 같은 기본값) + /me/dashboard 를 서버처럼 — GET 은 저장본, PUT 은 저장 후 에코(puts 에 모음).
 * 알림 읽음 요청은 reads 에 모은다.
 */
function home(initial: DashboardLayout, data: Data = {}) {
  const state = { stored: initial, puts: [] as DashboardLayout[], reads: [] as string[] }
  const issues = createIssueSearchResponse(data.issues ?? [createIssue({ id: 1, projectKey: 'WP', number: 7, title: '로그인 버그', status: 'IN_PROGRESS' })])
  const handlers = [
    http.get(`${API}/me/dashboard`, () => HttpResponse.json(state.stored)),
    http.put(`${API}/me/dashboard`, async ({ request }) => {
      const body = (await request.json()) as DashboardLayout
      state.puts.push(body)
      state.stored = body
      return HttpResponse.json(body)
    }),
    http.get(`${API}/me/issues`, () => HttpResponse.json(issues)),
    http.get(`${API}/me/watched-issues`, () => HttpResponse.json(issues)),
    http.get(`${API}/calendar/events`, () => HttpResponse.json(data.events ?? [calendarEvent({ id: 1, title: '스탠드업 미팅' })])),
    http.get(`${API}/notifications`, () => HttpResponse.json(data.notifications ?? [notif({ id: 1 })])),
    http.get(`${API}/notifications/unread-count`, () => HttpResponse.json({ count: 1 })),
    http.post(`${API}/notifications/:id/read`, ({ params }) => {
      state.reads.push(String(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${API}/notifications/read-all`, () => {
      state.reads.push('all')
      return new HttpResponse(null, { status: 204 })
    }),
    http.get(`${API}/me/mail-summary`, () => HttpResponse.json(typeof data.mail === 'function' ? data.mail() : (data.mail ?? baseMail))),
    http.get(`${API}/me/messaging-summary`, () => HttpResponse.json(data.messaging ?? emptyMessaging)),
    http.get(`${API}/me/priority-items`, () => HttpResponse.json(data.priority ?? { items: [] })),
  ]
  return { state, handlers }
}

/** 인박스 패널 열림 상태를 드러내는 탐침 — 실제 패널(AppRail)은 이 화면 밖이다. */
function InboxProbe() {
  const { open } = useInboxPanel()
  return <span data-testid="inbox-probe" data-open={String(open)} />
}

/** 대시보드를 띄운다. */
function renderHome(initial: DashboardLayout, data: Data = {}) {
  const h = home(initial, data)
  const view = renderScreen(
    <InboxProvider>
      <Dashboard />
      <InboxProbe />
    </InboxProvider>,
    { handlers: h.handlers },
  )
  return { ...view, state: h.state }
}

// ── 오늘 일정 ─────────────────────────────────────────────────────────────

test('오늘 일정 — 종일·시각·미정 혼재 시 미정은 맨 뒤로, 헤더에 「오늘 3건 · 미정 1」, 미정 시간 칸은 「미정」', async () => {
  // 입력 순서를 일부러 섞는다(미정 → 종일 → 시각). 정렬 규칙 자체는 bodyRules 단위 테스트(WP-412).
  const mixed = [
    calendarEvent({ id: 1, title: '미정 일정', startsAt: null as unknown as string, endsAt: null as unknown as string }),
    calendarEvent({ id: 2, title: '종일 일정', startsAt: '2026-06-18T00:00:00Z', endsAt: '2026-06-18T23:59:00Z', allDay: true }),
    calendarEvent({ id: 3, title: '오후 회의', startsAt: '2026-06-18T05:00:00Z', endsAt: '2026-06-18T06:00:00Z' }),
  ]
  renderHome(layout(['calendar_today']), { events: mixed })
  const widget = await screen.findByTestId('dash-calendar')
  await waitFor(() => expect(widget).toHaveTextContent('오늘 3건 · 미정 1'))
  const links = within(widget).getAllByRole('link')
  expect(links.map((l) => l.textContent)).toEqual([
    expect.stringContaining('종일 일정'),
    expect.stringContaining('오후 회의'),
    expect.stringContaining('미정 일정'),
  ])
  expect(within(links[2]).getByTestId('cal-time')).toHaveTextContent('미정')
})

test('오늘 일정 — 빈 상태는 제목·설명·「새 일정」 CTA(/calendar?new=true)를 보인다 (#653)', async () => {
  renderHome(layout(['calendar_today']), { events: [] })
  const empty = await screen.findByTestId('dash-calendar-empty')
  expect(empty).toHaveTextContent('오늘 일정이 없어요')
  expect(empty).toHaveTextContent('예정된 회의·마감이 없는 여유로운 하루예요')
  expect(within(empty).getByRole('link', { name: /새 일정/ })).toHaveAttribute('href', '/calendar?new=true')
})

// ── 내 작업 ───────────────────────────────────────────────────────────────

test('내 작업 — 진행 중 이슈 행이 상세 링크로 그려지고 헤더 부제 「N건이 나를 기다림」이 붙는다 (#282)', async () => {
  renderHome(layout(['my_tasks']))
  const widget = await screen.findByTestId('dash-mytasks')
  const row = await within(widget).findByRole('link', { name: '이슈 열기: 로그인 버그' })
  expect(row).toHaveAttribute('href', expect.stringContaining('/projects/WP/issues/7'))
  expect(widget).toHaveTextContent('건이 나를 기다림')
})

// ── 알림 위젯 ─────────────────────────────────────────────────────────────

test('알림 위젯 — 같은 이슈 알림 3건을 한 그룹 행으로 묶고 「코멘트 2건 · 상태 변경」으로 집계한다', async () => {
  const base = { issueNumber: 9, issueTitle: '배포 점검' }
  renderHome(layout(['notifications']), {
    notifications: [
      notif({ ...base, id: 11, type: 'COMMENTED', createdAt: '2026-06-16T01:00:00Z' }),
      notif({ ...base, id: 12, type: 'COMMENTED', createdAt: '2026-06-16T02:00:00Z' }),
      notif({ ...base, id: 13, type: 'STATUS_CHANGED', createdAt: '2026-06-16T03:00:00Z' }),
    ],
  })
  const updates = await screen.findByTestId('dash-notif-updates')
  const rows = await within(updates).findAllByTestId('dash-notif-row')
  expect(rows).toHaveLength(1)
  expect(rows[0]).toHaveTextContent('WP-9 · 배포 점검')
  expect(rows[0]).toHaveTextContent('코멘트 2건 · 상태 변경')
})

test('알림 위젯 — 일정 초대·응답 알림(#585)도 크래시 없이 그리고 누르면 /calendar?eventId= 로 간다', async () => {
  const cal = { issueId: 0, projectKey: '', issueNumber: 0, issueTitle: '' }
  const { user, location } = renderHome(layout(['notifications']), {
    notifications: [
      notif({ ...cal, id: 31, type: 'CALENDAR_INVITED', eventId: 100, eventTitle: '분기 킥오프', eventStartsAt: '2026-07-10T01:00:00Z', createdAt: '2026-06-16T07:00:00Z' }),
      notif({ ...cal, id: 32, type: 'CALENDAR_RSVP_CHANGED', actorId: 3, actorName: '김개발', eventId: 101, eventTitle: '주간 회의', eventStartsAt: '2026-07-11T01:00:00Z', createdAt: '2026-06-16T08:00:00Z' }),
    ],
  })
  const updates = await screen.findByTestId('dash-notif-updates')
  await waitFor(() => expect(updates).toHaveTextContent('분기 킥오프'))
  expect(updates).toHaveTextContent('주간 회의')
  await user.click(within(updates).getByRole('link', { name: '알림 열기: 분기 킥오프' }))
  await waitFor(() => expect(location()).toMatch(/^\/calendar\?eventId=\d+$/))
})

test('알림 위젯 — 행 ✓ 는 그 알림을, 「모두 읽음」은 read-all 을 요청한다', async () => {
  const { user, state } = renderHome(layout(['notifications']))
  await user.click((await screen.findAllByTestId('dash-notif-ack'))[0])
  await waitFor(() => expect(state.reads).toEqual(['1']))
  // InboxPanel 헤더와 같은 카피(#665).
  const all = screen.getByTestId('dash-notif-ack-all')
  expect(all).toHaveTextContent('모두 읽음')
  await user.click(all)
  await waitFor(() => expect(state.reads).toContain('all'))
})

test('알림 위젯 — 안 읽은 알림이 없으면 「다 따라잡았어요」 빈 상태를 보인다', async () => {
  renderHome(layout(['notifications']), { notifications: [notif({ id: 31, type: 'COMMENTED', read: true })] })
  expect(await screen.findByTestId('dash-notif-empty')).toHaveTextContent('다 따라잡았어요')
})

test('알림 위젯 — AI(AGENT) 행위자에는 이름에 「AI」가 있어도 에이전트 배지(ai-accent)를 달고 「AI」 칩은 없다 (#637, WP-935)', async () => {
  renderHome(layout(['notifications']), {
    notifications: [notif({ id: 42, actorId: 9, actorName: 'My AI', actorKind: 'AGENT', createdAt: '2026-06-16T07:00:00Z' })],
  })
  const mine = await screen.findByTestId('dash-notif-mine')
  const row = await within(mine).findByTestId('dash-notif-row')
  expect(row).toHaveTextContent('My AI')
  const badge = within(row).getByTestId('agent-badge')
  expect(badge).toHaveTextContent('에이전트')
  expect(badge.className).toMatch(/bg-ai-accent-subtle/)
  expect(within(row).queryByText('AI', { exact: true })).toBeNull()
})

test('알림 위젯 — 업데이트가 5건을 넘으면 헤더는 전체 6, 5행 + 「+1건 더」, 누르면 인박스 패널을 연다 (#680)', async () => {
  const many = Array.from({ length: 6 }, (_, i) =>
    notif({ id: 50 + i, type: 'COMMENTED', issueId: 100 + i, issueNumber: 100 + i, issueTitle: `이슈 ${100 + i}`, createdAt: `2026-06-16T0${i}:00:00Z` }),
  )
  const { user } = renderHome(layout(['notifications']), { notifications: many })
  const header = await screen.findByTestId('dash-notif-updates-header')
  await waitFor(() => expect(header).toHaveTextContent('업데이트 6'))
  expect(within(screen.getByTestId('dash-notif-updates')).getAllByTestId('dash-notif-row')).toHaveLength(5)
  const overflow = screen.getByTestId('dash-notif-overflow')
  expect(overflow).toHaveTextContent('+1건 더')
  expect(screen.getByTestId('inbox-probe')).toHaveAttribute('data-open', 'false')
  await user.click(overflow)
  expect(screen.getByTestId('inbox-probe')).toHaveAttribute('data-open', 'true')
})

// ── 안 읽은 메일 위젯 ─────────────────────────────────────────────────────

test('메일 위젯 — 발신자·제목·미리보기·회신필요 배지(AI action 스타일, 빨강 아님)·「회신 필요 1」 힌트, 행은 메일 상세로 딥링크', async () => {
  renderHome(layout(['unread_mail']), {
    mail: {
      unreadCount: 3, needsReplyCount: 1, classificationActive: true,
      recent: [mailItem({ id: 1, subject: 'Q3 예산안', fromName: '김팀장', snippet: '내일까지 의견', hasAttachment: true, aiCategory: 'ACTION', aiNeedsReply: true })],
    },
  })
  const row = (await screen.findAllByTestId('dash-mail-row'))[0]
  for (const text of ['김팀장', 'Q3 예산안', '내일까지 의견']) expect(row).toHaveTextContent(text)
  expect(row).toHaveAttribute('href', '/mail/1?messageId=1')
  const badge = within(row).getByTestId('dash-mail-badge-reply')
  expect(badge).toHaveTextContent('회신필요')
  expect(badge.className).not.toContain('bg-red')
  // action = 솔리드 ai-accent(옅은 ai-accent-subtle 이 아님).
  expect(badge.classList.contains('bg-ai-accent')).toBe(true)
  expect(screen.getByTestId('dash-mail-hint')).toHaveTextContent('회신 필요 1')
})

test('메일 위젯 — 「회신 필요」 칩을 켜면 회신필요 메일만, 끄면 전체로 돌아온다', async () => {
  const { user } = renderHome(layout(['unread_mail']), {
    mail: {
      unreadCount: 3, needsReplyCount: 2, classificationActive: true,
      recent: [
        mailItem({ id: 1, subject: 'Q3 예산안', aiCategory: 'ACTION', aiNeedsReply: true }),
        mailItem({ id: 2, subject: '시안 컨펌', aiCategory: 'ACTION', aiNeedsReply: true }),
        mailItem({ id: 3, subject: '주간 회의록', aiCategory: 'FYI', aiNeedsReply: false }),
      ],
    },
  })
  expect(await screen.findAllByTestId('dash-mail-row')).toHaveLength(3)
  const filter = screen.getByTestId('dash-mail-filter')
  expect(filter).toHaveAttribute('aria-pressed', 'false')
  await user.click(filter)
  expect(filter).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getAllByTestId('dash-mail-row')).toHaveLength(2)
  expect(screen.queryByText('주간 회의록')).toBeNull()
  await user.click(filter)
  expect(filter).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getAllByTestId('dash-mail-row')).toHaveLength(3)
})

test('메일 위젯 — 수동 동기화 없이 60초 폴링으로 새 메일이 반영된다 (#445)', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  let arrived = false
  renderHome(layout(['unread_mail']), {
    mail: () =>
      arrived
        ? { ...baseMail, unreadCount: 3, recent: [mailItem({ id: 200, subject: '긴급 공지', fromName: '대표' }), ...baseMail.recent] }
        : baseMail,
  })
  const widget = await screen.findByTestId('dash-mail')
  await waitFor(() => expect(widget).toHaveTextContent('안읽음 2'))
  // 백그라운드 자동 동기화로 서버에 새 메일이 쌓였다 — 사용자는 아무것도 하지 않는다.
  arrived = true
  await act(async () => {
    await vi.advanceTimersByTimeAsync(61_000)
  })
  await waitFor(() => expect(widget).toHaveTextContent('안읽음 3'))
  expect(widget).toHaveTextContent('긴급 공지')
})

// ── 대화 위젯 ─────────────────────────────────────────────────────────────

test('대화 위젯 — DM 회신대기·채널 멘션 배지·미리보기·딥링크와 「회신 대기 3 · 안읽음 3」 힌트', async () => {
  const now = Date.now()
  renderHome(layout(['recent_chats']), {
    messaging: {
      unreadConversationCount: 3, needsReplyCount: 3, aiAttentionCount: 0, attentionCount: 3,
      recent: [
        { kind: 'DM', conversationId: 7, label: '홍길동', lastAuthorName: '홍길동', lastMessagePreview: '네 그렇게 진행할게요', lastMessageAt: new Date(now - 2 * 60_000).toISOString(), unreadCount: 1, mentioned: false, needsReply: true, newThreadReplyCount: 0, aiReason: null },
        { kind: 'CHANNEL', conversationId: 3, label: '프로덕트', lastAuthorName: '박서연', lastMessagePreview: '@나 확인 부탁', lastMessageAt: new Date(now - 10 * 60_000).toISOString(), unreadCount: 2, mentioned: true, needsReply: false, newThreadReplyCount: 0, aiReason: null },
      ],
    },
  })
  const [dm, ch] = await screen.findAllByTestId('dash-chat-row')
  expect(dm).toHaveTextContent('홍길동')
  expect(dm).toHaveTextContent('네 그렇게 진행할게요')
  expect(within(dm).getByTestId('dash-chat-badge-reply')).toBeInTheDocument()
  expect(dm).toHaveAttribute('href', '/chat/dms/7')
  expect(within(ch).getByTestId('dash-chat-badge-mention')).toBeInTheDocument()
  expect(ch).toHaveAttribute('href', '/chat/channels/3')
  expect(screen.getByTestId('dash-chat-hint')).toHaveTextContent('회신 대기 3 · 안읽음 3')
})

// ── 합성(요약 KPI·지금 신경 쓸 일) ─────────────────────────────────────────

test('합성 — 메시징 「확인 필요」 KPI 는 합산(3)이 아니라 dedup 된 attentionCount(2)다', async () => {
  renderHome(layout(['synthesis']), { messaging: { ...emptyMessaging, needsReplyCount: 2, aiAttentionCount: 1, attentionCount: 2 } })
  const kpi = await screen.findByTestId('kpi-messaging')
  await waitFor(() => expect(kpi).toHaveTextContent('2'))
  expect(kpi).toHaveTextContent('확인 필요')
  expect(kpi).not.toHaveTextContent('3')
})

test('합성 — AI 발굴 채널·DM 회신 대화가 「지금 신경 쓸 일」에 들어오고 누르면 각 대화로 간다', async () => {
  const now = Date.now()
  const { user, location } = renderHome(layout(['synthesis']), {
    messaging: {
      unreadConversationCount: 2, needsReplyCount: 1, aiAttentionCount: 1, attentionCount: 2,
      recent: [
        { kind: 'CHANNEL', conversationId: 12, label: '#dev', lastAuthorName: '박서연', lastMessagePreview: '배포 여부 확인', lastMessageAt: new Date(now - 5 * 60_000).toISOString(), unreadCount: 1, mentioned: false, needsReply: false, newThreadReplyCount: 0, aiReason: '배포 여부 질문' },
        { kind: 'DM', conversationId: 7, label: '이대리', lastAuthorName: '이대리', lastMessagePreview: '확인해주세요', lastMessageAt: new Date(now - 3 * 60_000).toISOString(), unreadCount: 1, mentioned: false, needsReply: true, newThreadReplyCount: 0, aiReason: null },
      ],
    },
    notifications: [],
  })
  const attention = await screen.findByTestId('dashboard-attention')
  const channel = await within(attention).findByRole('link', { name: /대화 열기: #dev/ })
  expect(attention).toHaveTextContent('확인 필요')
  const dm = within(attention).getByRole('link', { name: /대화 열기: 이대리/ })
  await user.click(channel)
  await waitFor(() => expect(location()).toBe('/chat/channels/12'))
  await user.click(dm)
  await waitFor(() => expect(location()).toBe('/chat/dms/7'))
})

test('합성 — 이슈·메시지·메일 행이 AI 우선순위 점수 순서로 그려지고 최상위(메일)는 포커스 카드가 된다', async () => {
  renderHome(layout(['synthesis']), {
    notifications: [],
    issues: [createIssue({ id: 1, projectKey: 'WP', number: 7, title: '마감 지난 이슈', dueDate: '2020-01-01' })],
    mail: { unreadCount: 1, needsReplyCount: 1, classificationActive: true, recent: [mailItem({ id: 200, subject: '계약 검토 요청', fromName: '거래처', aiCategory: 'ACTION', aiNeedsReply: true })] },
    messaging: {
      unreadConversationCount: 1, needsReplyCount: 0, aiAttentionCount: 1, attentionCount: 1,
      recent: [{ kind: 'CHANNEL', conversationId: 5, label: '#dev', lastAuthorName: '박서연', lastMessagePreview: '배포 확인 부탁', lastMessageAt: new Date(Date.now() - 5 * 60_000).toISOString(), unreadCount: 1, mentioned: false, needsReply: false, newThreadReplyCount: 0, aiReason: '배포 여부 질문' }],
    },
    // 소스 고정 순위(이슈→메시지→메일)를 뒤집는 점수 — 정렬에 점수가 쓰이는지 본다.
    priority: {
      items: [
        { sourceType: 'MAIL_NEEDS_REPLY', sourceId: '200', title: '계약 검토 요청', deepLink: '/x', importanceScore: 90, urgencyScore: 90, reason: '높음' },
        { sourceType: 'ISSUE_DUE', sourceId: '1', title: '마감 지난 이슈', deepLink: '/y', importanceScore: 50, urgencyScore: 50, reason: '중간' },
        { sourceType: 'MESSAGE_ATTENTION', sourceId: '5', title: '#dev', deepLink: '/z', importanceScore: 10, urgencyScore: 10, reason: '낮음' },
      ],
    },
  })
  const attention = await screen.findByTestId('dashboard-attention')
  await waitFor(() => expect(within(attention).getAllByRole('link')).toHaveLength(3))
  const focus = screen.getByTestId('dashboard-attention-focus')
  expect(focus).toHaveTextContent('계약 검토 요청')
  expect(focus).toHaveTextContent('회신 필요')
  expect(focus).toHaveAttribute('href', '/mail/1?messageId=200')
  const links = within(attention).getAllByRole('link')
  expect(links[1]).toHaveTextContent('마감 지난 이슈')
  expect(links[2]).toHaveTextContent('#dev')
})

test('합성 — 같은 이슈 멘션 3건은 한 줄(멘션 3)로 묶이고 단건은 「멘션」, 카운트 셀은 전체 4건 그대로다 (WP-258)', async () => {
  const A = '결제 모듈 리팩터링 후 정산 배치가 이중 집계되는 문제 조사 및 재발 방지 대책 수립'
  const c = (id: number, issueNumber: number, issueTitle: string, createdAt: string) =>
    notif({ id, type: 'ISSUE_COMMENT_MENTION', actorId: 3, actorName: '홍길동', issueId: issueNumber, issueNumber, issueTitle, commentId: id, createdAt })
  renderHome(layout(['synthesis']), {
    notifications: [c(1, 7, A, '2026-06-16T01:00:00Z'), c(2, 7, A, '2026-06-16T03:00:00Z'), c(3, 7, A, '2026-06-16T02:00:00Z'), c(4, 8, '이슈 B', '2026-06-16T00:00:00Z')],
    issues: [],
    mail: { ...baseMail, recent: [] },
  })
  const attention = await screen.findByTestId('dashboard-attention')
  await waitFor(() => expect(attention).toHaveTextContent('지금 신경 쓸 일 (2)'))
  expect(within(attention).getAllByRole('link')).toHaveLength(2)
  const focus = screen.getByTestId('dashboard-attention-focus')
  expect(focus).toHaveTextContent(A)
  expect(focus).toHaveTextContent(/멘션 3 · /)
  expect(focus).toHaveAttribute('href', '/projects/WP/issues/7')
  expect(focus).toHaveAccessibleName(`알림 열기: ${A} (멘션 3건)`)
  const rest = attention.querySelectorAll('ul a')
  expect(rest).toHaveLength(1)
  expect(rest[0]).toHaveTextContent('이슈 B')
  expect(rest[0].textContent).not.toMatch(/멘션 \d/)
  expect(rest[0].textContent).not.toContain(' · ')
  expect(rest[0]).toHaveAttribute('href', '/projects/WP/issues/8')
  expect(screen.getByRole('button', { name: '멘션 4건' })).toBeInTheDocument()
})

test('합성 — 메일 분류가 꺼져 있으면 회신 필요 CTA 가 뜨고, 닫으면 사라지며 다시 열어도(재마운트) 보이지 않는다', async () => {
  localStorage.removeItem('home.mailCta.dismissed')
  const first = renderHome(layout(['synthesis']))
  const cta = await screen.findByTestId('dashboard-mail-cta')
  expect(cta).toHaveTextContent('회신이 필요한 메일')
  await first.user.click(within(cta).getByRole('button', { name: '닫기' }))
  expect(screen.queryByTestId('dashboard-mail-cta')).toBeNull()
  // 새로고침 대신 새 화면으로 다시 띄운다 — dismiss 는 localStorage 로 남아야 한다.
  first.unmount()
  renderHome(layout(['synthesis']))
  await screen.findByTestId('dashboard-attention')
  expect(screen.queryByTestId('dashboard-mail-cta')).toBeNull()
})

// ── AI 우선순위 위젯 ──────────────────────────────────────────────────────

test('AI 우선순위 — 4분면에 항목을 그리고 누르면 원본으로 간다, 0건 분면은 아이콘 + 「항목 없음」 (#650)', async () => {
  const { user, location } = renderHome(layout(['priority_quadrant']), {
    priority: { items: [{ sourceType: 'ISSUE_DUE', sourceId: '1', title: '이슈 A', deepLink: '/projects/X/issues/1', importanceScore: 90, urgencyScore: 90, reason: '고객 마감' }] },
  })
  const link = await screen.findByRole('link', { name: '이슈 A' })
  expect(screen.getByTestId('priority-quadrant')).toBeInTheDocument()
  // '이슈 A' 는 긴급 + 중요 분면만 채운다 — 「긴급」 분면은 0건.
  const urgentEmpty = screen.getByTestId('priority-quadrant-urgent-empty')
  expect(urgentEmpty).toHaveTextContent('항목 없음')
  expect(urgentEmpty.querySelector('svg')).not.toBeNull()
  await user.click(link)
  await waitFor(() => expect(location()).toBe('/projects/X/issues/1'))
})

// ── 데스크톱 저장본 정규화 ────────────────────────────────────────────────

test('데스크톱 — 저장본에 collapsed 가 있어도 무시하고 본문을 그린다, 모바일 접기·타일은 없다 (WP-142)', async () => {
  renderHome(layout([{ id: 'my_tasks', type: 'my_tasks', count: 5, hidden: false, collapsed: true }]))
  expect(await screen.findByTestId('dash-mytasks')).toBeInTheDocument()
  expect(screen.queryByTestId('mobile-widget-collapse')).toBeNull()
  expect(document.querySelector('[data-testid="dashboard-widget"][data-mobile-kind]')).toBeNull()
})

// ── 편집 — 카탈로그·시스템 위젯 ────────────────────────────────────────────

/** 편집 모드로 들어간다. */
async function startEdit(user: ReturnType<typeof renderHome>['user']) {
  await user.click(await screen.findByTestId('dashboard-edit-toggle'))
}

/** 텍스트를 가진 위젯 카드. */
const card = (text: string) => screen.queryAllByTestId('dashboard-widget').find((el) => el.textContent?.includes(text))

test('편집 — 저장본에 없는 신규 시스템 위젯(AI 우선순위·요약·빠른 액션)이 위젯 추가 모달에 보인다', async () => {
  const { user } = renderHome(layout(['my_tasks']))
  await startEdit(user)
  await user.click(screen.getByTestId('dashboard-add-widget-open'))
  const modal = await screen.findByTestId('add-widget-modal')
  for (const name of ['AI 우선순위', '요약', '빠른 액션']) expect(within(modal).getAllByText(name).length).toBeGreaterThan(0)
})

test('편집 — 카탈로그 「이슈 목록」을 추가하고 이름·담당자(전체)를 설정해 저장하면 PUT 에 label·params 가 실린다', async () => {
  const { user, state } = renderHome(layout(['my_tasks']))
  await startEdit(user)
  await user.click(screen.getByTestId('dashboard-add-widget-open'))
  const modal = await screen.findByTestId('add-widget-modal')
  await user.click(within(modal).getAllByTestId('add-widget-category').find((el) => el.textContent?.includes('이슈'))!)
  await user.click(within(modal).getAllByTestId('add-widget-card').find((el) => el.textContent?.includes('이슈 목록'))!)
  await user.click(within(modal).getByTestId('add-widget-confirm'))
  await waitFor(() => expect(screen.queryByTestId('add-widget-modal')).toBeNull())
  await user.click(within(card('이슈 목록')!).getByTestId('widget-settings'))
  const label = await screen.findByTestId('widget-settings-label')
  await user.clear(label)
  await user.paste('보안팀 이슈')
  await user.click(screen.getByTestId('widget-settings-field-assignee'))
  await user.click(await screen.findByRole('option', { name: '전체' }))
  await user.click(screen.getByTestId('widget-settings-apply'))
  await waitFor(() => expect(card('보안팀 이슈')).toBeDefined())
  await user.click(screen.getByTestId('dashboard-edit-save'))
  await waitFor(() => expect(state.puts).toHaveLength(1))
  const issueWidget = state.puts[0].widgets.find((w) => w.type === 'issue_list')
  expect(issueWidget?.label).toBe('보안팀 이슈')
  expect(issueWidget?.params?.assignee).toBe('all')
})

test('편집 — 카탈로그·시스템 위젯 모두 삭제 버튼으로 그리드와 저장 payload 에서 완전히 빠진다(숨김 아님)', async () => {
  const { user, state } = renderHome(
    layout(['my_tasks', 'calendar_today', { id: 'sec-1', type: 'issue_list', count: 0, hidden: false, params: { assignee: 'me' }, label: '보안팀 이슈' }]),
  )
  await startEdit(user)
  await user.click(within(card('보안팀 이슈')!).getByTestId('widget-remove'))
  await user.click(within(card('내 작업')!).getByTestId('widget-remove'))
  expect(card('보안팀 이슈')).toBeUndefined()
  expect(card('내 작업')).toBeUndefined()
  await user.click(screen.getByTestId('dashboard-edit-save'))
  await waitFor(() => expect(state.puts).toHaveLength(1))
  expect(state.puts[0].widgets.map((w) => w.type)).toEqual(['calendar_today'])
})

test('편집 — 테두리·제목 숨김 토글이 저장 payload(chromeless) 에 실리고, 다시 열면 카드 프레임 없이 그린다', async () => {
  const first = renderHome(layout(['quick_actions']))
  await startEdit(first.user)
  const toggle = within(card('빠른 액션')!).getByTestId('widget-chromeless-toggle')
  expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await first.user.click(toggle)
  expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await first.user.click(screen.getByTestId('dashboard-edit-save'))
  await waitFor(() => expect(first.state.puts).toHaveLength(1))
  expect(first.state.puts[0].widgets.find((w) => w.type === 'quick_actions')?.chromeless).toBe(true)
  // 저장본으로 다시 띄운다(새로고침과 같은 재조회).
  first.unmount()
  renderHome(first.state.puts[0])
  await waitFor(() => expect(card('새 이슈')).toHaveAttribute('data-chromeless', 'true'))
})
