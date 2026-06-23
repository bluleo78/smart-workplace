import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures/auth.fixture'
import { mockApi } from '../fixtures/api-mock'
import { createIssue, createIssueSearchResponse } from '../factories/issue.factory'
import { detail as mailDetail, mailAccount, summary as mailRow } from '../factories/mail.factory'
import { createChannel, createChannelMember, createMessage } from '../factories/messaging.factory'
import type { CalendarEvent } from '../../src/types/calendar'
import type {
  DashboardLayout,
  DashboardWidgetConfig,
  MailSummary,
  MessagingSummary,
} from '../../src/types/dashboard'
import type { ChannelResponse, DmResponse } from '../../src/types/messaging'
import type { NotificationResponse } from '../../src/types/notification'

// 홈 고정 대시보드 E2E — 저장 레이아웃 순서로 5종 위젯 렌더 + 위젯별 격리(로딩/에러).
// 백엔드 없이 /me/dashboard·위젯별 엔드포인트를 모킹해 검증한다.
// (구 AI 캔버스/세션 스위처/챗 도크 E2E 는 대시보드 전환으로 폐기됨.)

// 레이아웃 응답 헬퍼 — 객체-배열 컨트랙트. 위젯 순서가 곧 렌더 순서.
// bare 문자열은 {type, count:5, hidden:false} 로 정규화(기존 호출부 호환).
function layout(widgets: (string | DashboardWidgetConfig)[]): DashboardLayout {
  return {
    widgets: widgets.map((w) =>
      typeof w === 'string' ? { type: w, count: 5, hidden: false } : w,
    ),
  }
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
      hasUnreadThreads: false,
      createdAt: '2026-06-01T00:00:00Z',
    },
  ]
}

const emptyDms: DmResponse[] = []

// 메일 요약(안 읽음 2 + 최근 1건).
// needsReplyCount/classificationActive 기본값: 기존 "안 읽음" 폴백 테스트 호환.
function mail(): MailSummary {
  return {
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
  }
}

// 대화 요약 기본 mock — 빈 recent, 카운트 0.
function messagingSummary(): MessagingSummary {
  return { unreadConversationCount: 0, needsReplyCount: 0, aiAttentionCount: 0, attentionCount: 0, recent: [] } satisfies MessagingSummary
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
  await mockApi(page, 'GET', '/api/v1/me/messaging-summary', messagingSummary())
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
  // 대화 위젯: messaging-summary 빈 recent → 빈 상태 렌더 확인.
  await expect(page.getByTestId('dash-chat-empty')).toBeVisible()
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

  // 메일 위젯 헤더 링크 → /mail. (제목 "메일" exact — 행의 "메일 열기:" 라벨과 구분)
  const link = page
    .getByTestId('dashboard-widget')
    .getByRole('link', { name: '메일', exact: true })
  await expect(link).toHaveAttribute('href', '/mail')
})

test('대시보드 — 알림 위젯 헤더 클릭 시 라우팅 대신 인박스 패널이 열린다 (refs #274)', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['notifications']))
  await page.goto('/')

  const widget = page.locator('[data-widget="notifications"]')
  // 헤더는 더 이상 딥링크(/me/tasks/assigned)가 아니다 — 링크가 없어야 한다(버그: 알림과 무관한 화면 이동).
  await expect(widget.getByRole('link', { name: '알림' })).toHaveCount(0)
  // 패널은 처음엔 닫혀 있다(Radix Popover — 닫힘 시 미렌더).
  await expect(page.getByTestId('inbox-panel')).toHaveCount(0)

  // 헤더는 링크가 아니라 버튼 — 클릭하면 알림 인박스 패널을 연다.
  await widget.getByRole('button', { name: '알림' }).click()

  // 알림 인박스 패널이 열리고 알림 목록을 보여준다. URL 은 홈에 머문다(전용 알림 라우트 없음).
  await expect(page.getByTestId('inbox-panel')).toBeVisible()
  await expect(page.getByTestId('inbox-item').first()).toContainText('리뷰 요청 이슈')
  await expect(page).toHaveURL(/\/$/)
})

test('대시보드 — 대화 위젯 제목과 빈 상태 문구가 일치한다 (refs #272)', async ({
  authenticatedPage: page,
}) => {
  // messaging-summary 빈 recent → 빈 상태.
  await mockApi(page, 'GET', '/api/v1/me/messaging-summary', {
    unreadConversationCount: 0,
    needsReplyCount: 0,
    aiAttentionCount: 0,
    attentionCount: 0,
    recent: [],
  } satisfies MessagingSummary)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['recent_chats']))
  await page.goto('/')

  // 위젯 헤더 제목이 '대화' 여야 한다 (title vs 빈 상태 불일치 회귀 방지).
  const headerLink = page
    .getByTestId('dashboard-widget')
    .getByRole('link', { name: /^대화$/ })
  await expect(headerLink).toBeVisible()

  // 빈 상태: "조용하네요 — 새 대화가 없어요".
  await expect(page.getByTestId('dash-chat-empty')).toContainText('새 대화가 없어요')
})

test('대시보드 — 각 위젯 행이 해당 항목 상세로 딥링크된다', async ({
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

  // 내 작업 행 → 이슈 상세(projectKey-number).
  await expect(
    page.getByTestId('dash-mytasks').getByRole('link', { name: '이슈 열기: 로그인 버그' }),
  ).toHaveAttribute('href', '/projects/WP/issues/7')

  // 오늘 일정 행 → 캘린더(전용 라우트 없음 → 폴백).
  await expect(
    page.getByTestId('dash-calendar').getByRole('link', { name: '일정 열기: 스탠드업 미팅' }),
  ).toHaveAttribute('href', '/calendar')

  // 알림 행(ASSIGNED) → 이슈 상세.
  await expect(
    page.getByTestId('dash-notif').getByRole('link', { name: '알림 열기: 리뷰 요청 이슈' }),
  ).toHaveAttribute('href', '/projects/WP/issues/7')

  // 대화 행(채널) → 채널 상세 딥링크. ConversationsBody 의 dash-chat-row 사용.
  // mockWidgets 의 messaging-summary 는 빈 recent → 딥링크 행 없음, 빈 상태만 확인.
  await expect(page.getByTestId('dash-chat-empty')).toBeVisible()

  // 안 읽은 메일 행 → 메일함(전용 메시지 라우트 없음 → 폴백).
  await expect(
    page.getByTestId('dash-mail').getByRole('link', { name: '메일 열기: 월간 보고서' }),
  ).toHaveAttribute('href', '/mail')
})

test('대시보드 — 행 클릭 시 실제로 라우팅된다(이슈 상세)', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  // 이슈 상세 페이지가 부르는 엔드포인트 모킹(라우팅 검증용 최소 스텁).
  await mockApi(page, 'GET', '/api/v1/projects/WP/issues/7', {
    summary: createIssue({ id: 1, projectKey: 'WP', number: 7, title: '로그인 버그' }),
    body: null,
    comments: [],
    history: [],
    attachments: [],
  })
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks']))
  await page.goto('/')

  await page.getByTestId('dash-mytasks').getByRole('link', { name: '이슈 열기: 로그인 버그' }).click()
  await expect(page).toHaveURL(/\/projects\/WP\/issues\/7$/)
})

// ── 3-레이어 합성/빠른액션 테스트 ────────────────────────────────────────

// 컴포넌트와 동일하게 로컬 오늘 키(yyyy-MM-dd)를 산출 — 클럭 모킹 없이 결정적.
function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

test('합성 — 카운트 스트립이 모킹된 카운트로 렌더된다', async ({ authenticatedPage: page }) => {
  await mockWidgets(page)
  // /me/issues 를 due 이슈로 덮어쓴다(LIFO → mockWidgets 보다 우선). my_tasks 위젯과 useMyIssueDues 가 공유.
  await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([
      createIssue({ id: 1, projectKey: 'WP', number: 7, title: '오늘 마감 이슈', dueDate: todayKey() }),
    ]),
  )
  // 멘션 프록시 = 안 읽은 COMMENTED 1건.
  await mockApi(page, 'GET', '/api/v1/notifications', [
    {
      id: 5,
      type: 'COMMENTED',
      actorId: 2,
      actorName: '양동희',
      actorKind: 'HUMAN',
      issueId: 1,
      projectKey: 'WP',
      issueNumber: 7,
      issueTitle: '코멘트 달린 이슈',
      commentId: 9,
      eventId: null,
      eventTitle: null,
      eventStartsAt: null,
      read: false,
      createdAt: '2026-06-16T00:00:00Z',
    },
  ])
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks']))
  await page.goto('/')

  const counts = page.getByTestId('dashboard-counts')
  // 안 읽음(메일 unreadCount=2), 오늘 일정(events 1건), 멘션(COMMENTED 1), 오늘 마감(due=today 1).
  await expect(counts.getByRole('link', { name: '안 읽음 2건' })).toBeVisible()
  await expect(counts.getByRole('link', { name: '오늘 일정 1건' })).toBeVisible()
  // 멘션 셀은 라우팅 대신 알림 패널을 여는 버튼이다(#273).
  await expect(counts.getByRole('button', { name: '멘션 1건' })).toBeVisible()
  await expect(counts.getByRole('link', { name: '오늘 마감 1건' })).toBeVisible()

  // 카운트 셀은 모듈 딥링크.
  await expect(counts.getByRole('link', { name: '안 읽음 2건' })).toHaveAttribute('href', '/mail')
  await expect(counts.getByRole('link', { name: '오늘 일정 1건' })).toHaveAttribute(
    'href',
    '/calendar',
  )
  // #275 — 오늘 마감 셀은 dueDate=today 필터 딥링크여야 한다(전체 할당 목록이 아니라 오늘 마감만).
  await expect(counts.getByRole('link', { name: '오늘 마감 1건' })).toHaveAttribute(
    'href',
    '/me/tasks/assigned?dueDate=today',
  )
})

test('합성 — 멘션 셀 클릭 시 라우팅 대신 알림 인박스 패널이 열린다 (refs #273)', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  // 멘션 프록시 = 안 읽은 COMMENTED 1건 → 멘션 카운트 1 + 인박스 목록에도 노출.
  await mockApi(page, 'GET', '/api/v1/notifications', [
    {
      id: 5,
      type: 'COMMENTED',
      actorId: 2,
      actorName: '양동희',
      actorKind: 'HUMAN',
      issueId: 1,
      projectKey: 'WP',
      issueNumber: 7,
      issueTitle: '코멘트 달린 이슈',
      commentId: 9,
      eventId: null,
      eventTitle: null,
      eventStartsAt: null,
      read: false,
      createdAt: '2026-06-16T00:00:00Z',
    },
  ])
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks']))
  await page.goto('/')

  // 패널은 처음엔 닫혀 있다(Radix Popover — 닫힘 시 미렌더).
  await expect(page.getByTestId('inbox-panel')).toHaveCount(0)

  // 멘션 셀은 링크가 아니라 버튼 — 클릭하면 알림 패널을 연다.
  await page.getByTestId('dashboard-counts').getByRole('button', { name: '멘션 1건' }).click()

  // 알림 인박스 패널이 열리고 멘션(COMMENTED) 알림을 보여준다.
  await expect(page.getByTestId('inbox-panel')).toBeVisible()
  await expect(page.getByTestId('inbox-item').first()).toContainText('코멘트 달린 이슈')
  // 라우팅되지 않고 홈에 머문다(전용 멘션 페이지 없음).
  await expect(page).toHaveURL(/\/$/)
})

test('합성 — 주의 필요 리스트가 행을 렌더하고 행 클릭 시 라우팅된다', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  // 마감 지난 이슈(과거일 → 항상 urgency 0 최상단).
  await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([
      createIssue({ id: 1, projectKey: 'WP', number: 7, title: '지연된 이슈', dueDate: '2020-01-01' }),
    ]),
  )
  // 이슈 상세 진입용 최소 스텁.
  await mockApi(page, 'GET', '/api/v1/projects/WP/issues/7', {
    summary: createIssue({ id: 1, projectKey: 'WP', number: 7, title: '지연된 이슈' }),
    body: null,
    comments: [],
    history: [],
    attachments: [],
  })
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks']))
  await page.goto('/')

  const attention = page.getByTestId('dashboard-attention')
  const row = attention.getByRole('link', { name: '이슈 열기: 지연된 이슈' })
  await expect(row).toBeVisible()
  await expect(row).toContainText('마감 지남')
  await expect(row).toHaveAttribute('href', '/projects/WP/issues/7')

  // 실제 라우팅.
  await row.click()
  await expect(page).toHaveURL(/\/projects\/WP\/issues\/7$/)
})

test('합성 — 급한 항목이 없으면 차분한 빈 상태를 보인다', async ({
  authenticatedPage: page,
}) => {
  // mockWidgets 미호출 → 픽스처 기본(전부 빈) 사용. 마감/멘션/중요메일 없음.
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout([]))
  await page.goto('/')

  await expect(page.getByTestId('dashboard-attention-empty')).toBeVisible()
  await expect(page.getByTestId('dashboard-attention-empty')).toContainText('다 확인했습니다')
  // 디자인 시스템 준수: 이모지 대신 Lucide 아이콘만 사용 (#280)
  await expect(page.getByTestId('dashboard-attention-empty')).not.toContainText('✅')
})

test('합성 — 빈 상태에서 주의 필요 헤더 아이콘이 중립 색(text-muted-foreground)이다 (refs #293)', async ({
  authenticatedPage: page,
}) => {
  // 항목 없음 → 빈 상태. mockWidgets 미호출 → 픽스처 기본(전부 빈) 사용.
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout([]))
  await page.goto('/')

  const attention = page.getByTestId('dashboard-attention')
  // 섹션 헤더 AlertTriangle(첫 번째 SVG) — 빈 상태엔 경고 빨간색이 아니어야 한다 (#293 회귀 가드).
  const headerIcon = attention.locator('svg').first()
  await expect(headerIcon).not.toHaveClass(/text-destructive/)
  await expect(headerIcon).toHaveClass(/text-muted-foreground/)
})

test('합성 — 주의 항목이 있을 때 헤더 아이콘은 경고 빨간색(text-destructive)이다 (refs #293)', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  // 마감 지난 이슈 → 주의 필요 항목 1건 → 헤더 아이콘 red.
  await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([
      createIssue({ id: 1, projectKey: 'WP', number: 7, title: '지연된 이슈', dueDate: '2020-01-01' }),
    ]),
  )
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks']))
  await page.goto('/')

  const attention = page.getByTestId('dashboard-attention')
  const headerIcon = attention.locator('svg').first()
  await expect(headerIcon).toHaveClass(/text-destructive/)
  await expect(headerIcon).not.toHaveClass(/text-muted-foreground/)
})

test('빠른 액션 — 각 버튼이 실제 라우트로 연결된다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout([]))
  await page.goto('/')

  const qa = page.getByTestId('dashboard-quickactions')
  await expect(qa.getByRole('link', { name: '새 이슈' })).toHaveAttribute('href', '/projects')
  await expect(qa.getByRole('link', { name: '메일 작성' })).toHaveAttribute('href', '/mail')
  await expect(qa.getByRole('link', { name: '새 대화' })).toHaveAttribute('href', '/chat/new')
})

test('그리드 — 활동/알림 위젯만 tall(row-span)이다', async ({ authenticatedPage: page }) => {
  await mockWidgets(page)
  await mockApi(
    page,
    'GET',
    '/api/v1/me/dashboard',
    layout(['my_tasks', 'calendar_today', 'notifications', 'recent_chats', 'unread_mail']),
  )
  await page.goto('/')

  // 5종 전부 렌더.
  await expect(page.getByTestId('dashboard-widget')).toHaveCount(5)

  // 알림 카드는 tall(lg:row-span-2), 내 작업 카드는 아님.
  const notifCard = page.getByTestId('dashboard-widget').filter({ hasText: '알림' })
  await expect(notifCard).toHaveClass(/lg:row-span-2/)
  const tasksCard = page.getByTestId('dashboard-widget').filter({ hasText: '내 작업' })
  await expect(tasksCard).not.toHaveClass(/lg:row-span-2/)
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

// ── 객체-배열 컨트랙트 + 편집 모드 ───────────────────────────────────────

// 내 작업 위젯에 N건의 이슈를 제공(count:10 렌더 검증용).
// IN_PROGRESS 상태로 생성해야 위젯의 in_progress 버킷에 들어가 행으로 렌더된다(TODO는 버킷 없음).
function manyIssues(n: number) {
  return createIssueSearchResponse(
    Array.from({ length: n }, (_, i) =>
      createIssue({ id: i + 1, projectKey: 'WP', number: i + 1, title: `이슈 ${i + 1}`, status: 'IN_PROGRESS' }),
    ),
  )
}

test('대시보드 — 객체-배열 레이아웃: 숨김 제외 + 순서대로 렌더', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  // 순서: unread_mail → my_tasks(hidden) → calendar_today. my_tasks 는 숨김 → 일반 뷰 제외.
  await mockApi(page, 'GET', '/api/v1/me/dashboard', {
    widgets: [
      { type: 'unread_mail', count: 5, hidden: false },
      { type: 'my_tasks', count: 5, hidden: true },
      { type: 'calendar_today', count: 5, hidden: false },
    ],
  })
  await page.goto('/')

  // 숨김 1개 제외 → 카드 2개.
  await expect(page.getByTestId('dashboard-widget')).toHaveCount(2)
  // 숨김 위젯(my_tasks)은 일반 뷰에 없다.
  await expect(page.locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')).toHaveCount(0)
  // DOM 순서 = 저장 순서(메일 먼저, 캘린더 다음).
  const cards = page.getByTestId('dashboard-widget')
  await expect(cards.nth(0)).toHaveAttribute('data-widget', 'unread_mail')
  await expect(cards.nth(1)).toHaveAttribute('data-widget', 'calendar_today')
})

test('대시보드 — count:10 위젯은 항목 10건을 렌더한다', async ({ authenticatedPage: page }) => {
  await mockWidgets(page)
  // 내 작업에 12건 제공 → count:10 이면 상위 10행만 렌더.
  await mockApi(page, 'GET', '/api/v1/me/issues', manyIssues(12))
  await mockApi(page, 'GET', '/api/v1/me/dashboard', {
    widgets: [{ type: 'my_tasks', count: 10, hidden: false }],
  })
  await page.goto('/')

  // 내 작업 본문의 이슈 행(딥링크)이 정확히 10개.
  const rows = page.getByTestId('dash-mytasks').getByRole('link', { name: /^이슈 열기:/ })
  await expect(rows).toHaveCount(10)
})

test('편집 — 위젯 아래로 이동 → 저장 시 PUT payload 순서 반영 + 재GET 반영', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks', 'unread_mail']))
  // PUT 핸들러 1개로 캡처 + 에코 동시 처리(LIFO 라우트 섀도잉 회피).
  // onSuccess → setQueryData 가 응답 widgets 로 일반 뷰를 다시 그리므로 body 를 그대로 에코한다.
  let putWidgets: DashboardWidgetConfig[] | null = null
  await page.route(
    (url) => url.pathname === '/api/v1/me/dashboard',
    (route) => {
      if (route.request().method() !== 'PUT') return route.fallback()
      const body = route.request().postDataJSON() as { widgets: DashboardWidgetConfig[] }
      putWidgets = body.widgets
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    },
  )
  await page.goto('/')

  // 편집 진입.
  await page.getByTestId('dashboard-edit-toggle').click()
  await expect(page.getByTestId('dashboard-edit-banner')).toBeVisible()

  // my_tasks 카드의 "아래로 이동" 클릭 → 순서: unread_mail, my_tasks.
  const myTasksCard = page.locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')
  await myTasksCard.getByTestId('widget-move-down').click()

  // 저장.
  await page.getByTestId('dashboard-edit-save').click()

  // 배너가 사라지면 PUT 이 resolve 되어 onSuccess 가 끝난 것 → putWidgets 안전 판독.
  await expect(page.getByTestId('dashboard-edit-banner')).toHaveCount(0)
  // PUT payload 순서 검증.
  expect(putWidgets!.map((w) => w.type)).toEqual(['unread_mail', 'my_tasks'])

  // 일반 뷰가 새 순서 반영(에코된 응답으로 캐시 갱신).
  const cards = page.getByTestId('dashboard-widget')
  await expect(cards.nth(0)).toHaveAttribute('data-widget', 'unread_mail')
  await expect(cards.nth(1)).toHaveAttribute('data-widget', 'my_tasks')
})

test('편집 — 위젯 숨김 → 저장 시 hidden:true + 일반 뷰 제외', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks', 'unread_mail']))
  // PUT 핸들러 1개로 캡처 + 에코(LIFO 섀도잉 회피).
  let putWidgets: DashboardWidgetConfig[] | null = null
  await page.route(
    (url) => url.pathname === '/api/v1/me/dashboard',
    (route) => {
      if (route.request().method() !== 'PUT') return route.fallback()
      const body = route.request().postDataJSON() as { widgets: DashboardWidgetConfig[] }
      putWidgets = body.widgets
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    },
  )
  await page.goto('/')

  await page.getByTestId('dashboard-edit-toggle').click()
  // my_tasks 숨김 토글.
  const myTasksCard = page.locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')
  await myTasksCard.getByTestId('widget-hide-toggle').click()
  // 편집 중에는 숨김 카드도 잔류(dimmed) — data-hidden=true.
  await expect(myTasksCard).toHaveAttribute('data-hidden', 'true')

  await page.getByTestId('dashboard-edit-save').click()

  await expect(page.getByTestId('dashboard-edit-banner')).toHaveCount(0)
  const myTasks = putWidgets!.find((w) => w.type === 'my_tasks')
  expect(myTasks?.hidden).toBe(true)

  // 일반 뷰는 숨김 위젯 제외 → unread_mail 만.
  await expect(page.getByTestId('dashboard-widget')).toHaveCount(1)
  await expect(page.getByTestId('dashboard-widget')).toHaveAttribute('data-widget', 'unread_mail')
})

test('편집 — 항목 수 10 선택 → 저장 시 PUT payload count:10', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks']))
  const putCapture = await mockApi(
    page,
    'PUT',
    '/api/v1/me/dashboard',
    { widgets: [{ type: 'my_tasks', count: 10, hidden: false }] },
    { capture: true },
  )
  await page.goto('/')

  await page.getByTestId('dashboard-edit-toggle').click()
  const myTasksCard = page.locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')
  // 항목 수 세그먼트에서 "10개" 선택.
  await myTasksCard.getByTestId('widget-count-select').getByRole('button', { name: '10개' }).click()
  await page.getByTestId('dashboard-edit-save').click()

  const req = await putCapture.waitForRequest()
  const payload = req.payload as { widgets: DashboardWidgetConfig[] }
  expect(payload.widgets.find((w) => w.type === 'my_tasks')?.count).toBe(10)
})

test('편집 — 취소는 드래프트를 되돌리고 PUT 을 보내지 않는다', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks', 'unread_mail']))
  const putCapture = await mockApi(
    page,
    'PUT',
    '/api/v1/me/dashboard',
    { widgets: [] },
    { capture: true },
  )
  await page.goto('/')

  await page.getByTestId('dashboard-edit-toggle').click()
  // my_tasks 를 아래로 이동(드래프트 변경).
  await page
    .locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')
    .getByTestId('widget-move-down')
    .click()
  // 취소 → 편집 종료.
  await page.getByTestId('dashboard-edit-cancel').click()
  await expect(page.getByTestId('dashboard-edit-banner')).toHaveCount(0)

  // PUT 미발생.
  expect(putCapture.requests).toHaveLength(0)
  // 일반 뷰는 원래 순서 유지(my_tasks 먼저).
  const cards = page.getByTestId('dashboard-widget')
  await expect(cards.nth(0)).toHaveAttribute('data-widget', 'my_tasks')
  await expect(cards.nth(1)).toHaveAttribute('data-widget', 'unread_mail')
})

test('편집 — 되돌리기는 마지막 액션을 취소한다(단일 레벨)', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks', 'unread_mail']))
  await page.goto('/')

  await page.getByTestId('dashboard-edit-toggle').click()
  // 진입 직후엔 되돌릴 게 없어 비활성.
  await expect(page.getByTestId('dashboard-edit-undo')).toBeDisabled()

  // my_tasks 아래로 이동 → 순서: unread_mail, my_tasks.
  await page
    .locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')
    .getByTestId('widget-move-down')
    .click()
  let cards = page.getByTestId('dashboard-widget')
  await expect(cards.nth(0)).toHaveAttribute('data-widget', 'unread_mail')

  // 되돌리기 → 원래 순서 복원.
  await expect(page.getByTestId('dashboard-edit-undo')).toBeEnabled()
  await page.getByTestId('dashboard-edit-undo').click()
  cards = page.getByTestId('dashboard-widget')
  await expect(cards.nth(0)).toHaveAttribute('data-widget', 'my_tasks')
  // 단일 레벨 — 복원 후 다시 비활성.
  await expect(page.getByTestId('dashboard-edit-undo')).toBeDisabled()
})

test('편집 — 이동 버튼은 키보드 포커스/조작 가능하고 양 끝에서 비활성', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks', 'unread_mail']))
  await page.goto('/')

  await page.getByTestId('dashboard-edit-toggle').click()
  const myTasksCard = page.locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')
  const upBtn = myTasksCard.getByTestId('widget-move-up')
  const downBtn = myTasksCard.getByTestId('widget-move-down')

  // 접근성 이름 검증(스크린리더 식별).
  await expect(myTasksCard.getByRole('button', { name: '위로 이동: 내 작업' })).toBeVisible()
  await expect(myTasksCard.getByRole('button', { name: '아래로 이동: 내 작업' })).toBeVisible()

  // 첫 위젯이라 위로 이동은 비활성, 아래로 이동은 활성.
  await expect(upBtn).toBeDisabled()
  await expect(downBtn).toBeEnabled()

  // 키보드 포커스 가능 + 활성화로 실제 이동(Enter).
  await downBtn.focus()
  await expect(downBtn).toBeFocused()
  await page.keyboard.press('Enter')
  const cards = page.getByTestId('dashboard-widget')
  await expect(cards.nth(0)).toHaveAttribute('data-widget', 'unread_mail')
})

// ── N4: I1/I2/B1 회귀 가드 ───────────────────────────────────────────────

test('편집(I1) — 숨김/표시 토글 시 aria-live 가 정확한 상태를 안내한다', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks', 'unread_mail']))
  await page.goto('/')

  await page.getByTestId('dashboard-edit-toggle').click()
  const myTasksCard = page.locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')
  const live = page.getByTestId('dashboard-edit-live')

  // 숨김 → "숨김 처리" 안내(표시 아님).
  await myTasksCard.getByTestId('widget-hide-toggle').click()
  await expect(myTasksCard).toHaveAttribute('data-hidden', 'true')
  await expect(live).toHaveText('내 작업 위젯을 숨김 처리했습니다')

  // 다시 토글 → "표시 처리" 안내.
  await myTasksCard.getByTestId('widget-hide-toggle').click()
  await expect(myTasksCard).toHaveAttribute('data-hidden', 'false')
  await expect(live).toHaveText('내 작업 위젯을 표시 처리했습니다')
})

test('편집(I2) — 경계 이동 후 포커스가 카드/버튼에 유지된다', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks', 'unread_mail']))
  await page.goto('/')

  await page.getByTestId('dashboard-edit-toggle').click()
  const myTasksCard = page.locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')
  const downBtn = myTasksCard.getByTestId('widget-move-down')

  // 첫 위젯(2개 중)을 아래로 → 마지막이 되어 "아래로" 버튼이 disabled.
  // 포커스는 <body> 로 낙하하지 않고 카드 자체로 복원되어야 한다(I2).
  await downBtn.focus()
  await downBtn.click()
  await expect(downBtn).toBeDisabled()
  await expect(myTasksCard).toBeFocused()

  // 다시 위로 → "위로" 버튼이 활성으로 남아 그 버튼에 포커스 복원.
  const upBtn = myTasksCard.getByTestId('widget-move-up')
  await upBtn.focus()
  await upBtn.click()
  await expect(upBtn).toBeDisabled()
  await expect(myTasksCard).toBeFocused()
})

test('편집(B1) — 부재 위젯 갤러리: 추가 → draft 반영 → 저장 PUT payload 포함', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  // 저장본에 my_tasks 만 존재 → 나머지 4종은 draft 부재 → 갤러리에 노출.
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks']))
  // PUT 캡처(에코 불필요 — 저장 후 편집 종료만 확인).
  const putCapture = await mockApi(
    page,
    'PUT',
    '/api/v1/me/dashboard',
    { widgets: [] },
    { capture: true },
  )
  await page.goto('/')

  await page.getByTestId('dashboard-edit-toggle').click()

  // 갤러리가 보이고 부재 4종이 카드로 노출된다.
  const gallery = page.getByTestId('dashboard-add-gallery')
  await expect(gallery).toBeVisible()
  await expect(gallery.getByTestId('dashboard-add-card')).toHaveCount(4)

  // unread_mail 추가 → 그리드에 편집 카드로 들어오고(draft 반영) 갤러리에서 사라진다.
  await gallery
    .locator('[data-testid="dashboard-add-card"][data-widget="unread_mail"]')
    .getByTestId('widget-add')
    .click()
  await expect(page.getByTestId('dashboard-edit-live')).toHaveText('메일 위젯을 추가했습니다')
  await expect(
    page.locator('[data-testid="dashboard-widget"][data-widget="unread_mail"]'),
  ).toBeVisible()
  await expect(gallery.getByTestId('dashboard-add-card')).toHaveCount(3)

  // 저장 → PUT payload 에 추가된 unread_mail 이 {count:5,hidden:false} 로 포함.
  await page.getByTestId('dashboard-edit-save').click()
  const req = await putCapture.waitForRequest()
  const payload = req.payload as { widgets: DashboardWidgetConfig[] }
  expect(payload.widgets.map((w) => w.type)).toEqual(['my_tasks', 'unread_mail'])
  const added = payload.widgets.find((w) => w.type === 'unread_mail')
  expect(added).toEqual({ type: 'unread_mail', count: 5, hidden: false })
})

test('편집(B1) — undo 가 갤러리 추가도 되돌린다(일관성)', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks']))
  await page.goto('/')

  await page.getByTestId('dashboard-edit-toggle').click()
  const gallery = page.getByTestId('dashboard-add-gallery')
  await gallery
    .locator('[data-testid="dashboard-add-card"][data-widget="unread_mail"]')
    .getByTestId('widget-add')
    .click()
  await expect(
    page.locator('[data-testid="dashboard-widget"][data-widget="unread_mail"]'),
  ).toBeVisible()

  // 되돌리기 → 추가 취소(다시 갤러리로).
  await page.getByTestId('dashboard-edit-undo').click()
  await expect(
    page.locator('[data-testid="dashboard-widget"][data-widget="unread_mail"]'),
  ).toHaveCount(0)
  await expect(
    gallery.locator('[data-testid="dashboard-add-card"][data-widget="unread_mail"]'),
  ).toBeVisible()
})

// ── #339 회귀 가드 — startsAt null 시 Invalid Date 렌더 ──────────────────

test('오늘 일정 — startsAt null 이벤트 시간 셀이 Invalid Date 대신 "미정"을 렌더한다 (refs #339)', async ({
  authenticatedPage: page,
}) => {
  // startsAt이 null인 이벤트 — 서버가 null을 내려보내는 엣지 케이스 방어 회귀 가드.
  const nullStartEvent: CalendarEvent[] = [
    {
      id: 99,
      title: 'startsAt null 이벤트',
      description: null,
      // 서버가 null을 내려보낼 수 있음 — TS 타입은 string이나 런타임 방어 필요
      startsAt: null as unknown as string,
      endsAt: null as unknown as string,
      allDay: false,
      location: null,
      color: null,
      reminderMinutes: null,
      recurrenceRule: null,
      createdAt: '2026-06-18T00:00:00Z',
      updatedAt: '2026-06-18T00:00:00Z',
    },
  ]
  await mockApi(page, 'GET', '/api/v1/calendar/events', nullStartEvent)
  await mockApi(page, 'GET', '/api/v1/me/issues', issues())
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', issues())
  await mockApi(page, 'GET', '/api/v1/notifications', notifications())
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 1 })
  await mockApi(page, 'GET', '/api/v1/messaging/channels', channels())
  await mockApi(page, 'GET', '/api/v1/messaging/dms', emptyDms)
  await mockApi(page, 'GET', '/api/v1/me/mail-summary', mail())
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['calendar_today']))
  await page.goto('/')

  // 이벤트 행이 렌더되어야 한다.
  await expect(page.getByTestId('dash-calendar')).toContainText('startsAt null 이벤트')
  // 시간 셀에 "Invalid Date"/'-'(무의미 placeholder)가 아닌 '미정'이 표시되어야 한다.
  const timeCell = page
    .getByTestId('dash-calendar')
    .getByRole('link', { name: '일정 열기: startsAt null 이벤트' })
    .getByTestId('cal-time')
  await expect(timeCell).toHaveText('미정')
  await expect(timeCell).not.toHaveText('Invalid Date')
})

// ── 오늘 일정 — 미정 정렬/헤더 힌트 ─────────────────────────────────────────

test('오늘 일정 — 종일·시각·미정 혼재 시 미정은 맨 뒤로 정렬하고 헤더에 미정 건수를 표시한다', async ({
  authenticatedPage: page,
}) => {
  // 입력 순서를 일부러 섞어 정렬 동작을 검증한다(미정 → 종일 → 시각).
  const mixed: CalendarEvent[] = [
    {
      id: 1,
      title: '미정 일정',
      description: null,
      startsAt: null as unknown as string,
      endsAt: null as unknown as string,
      allDay: false,
      location: null,
      color: null,
      reminderMinutes: null,
      recurrenceRule: null,
      createdAt: '2026-06-18T00:00:00Z',
      updatedAt: '2026-06-18T00:00:00Z',
    },
    {
      id: 2,
      title: '종일 일정',
      description: null,
      startsAt: '2026-06-18T00:00:00Z',
      endsAt: '2026-06-18T23:59:00Z',
      allDay: true,
      location: null,
      color: null,
      reminderMinutes: null,
      recurrenceRule: null,
      createdAt: '2026-06-18T00:00:00Z',
      updatedAt: '2026-06-18T00:00:00Z',
    },
    {
      id: 3,
      title: '오후 회의',
      description: null,
      startsAt: '2026-06-18T05:00:00Z',
      endsAt: '2026-06-18T06:00:00Z',
      allDay: false,
      location: null,
      color: null,
      reminderMinutes: null,
      recurrenceRule: null,
      createdAt: '2026-06-18T00:00:00Z',
      updatedAt: '2026-06-18T00:00:00Z',
    },
  ]
  await mockApi(page, 'GET', '/api/v1/calendar/events', mixed)
  await mockApi(page, 'GET', '/api/v1/me/issues', issues())
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', issues())
  await mockApi(page, 'GET', '/api/v1/notifications', notifications())
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 1 })
  await mockApi(page, 'GET', '/api/v1/messaging/channels', channels())
  await mockApi(page, 'GET', '/api/v1/messaging/dms', emptyDms)
  await mockApi(page, 'GET', '/api/v1/me/mail-summary', mail())
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['calendar_today']))
  await page.goto('/')

  // 헤더: 총 3건 + 미정 1건 힌트.
  await expect(page.getByTestId('dash-calendar')).toContainText('오늘 3건 · 미정 1')

  // 정렬: 종일(startsAt 00:00) → 시각(05:00) → 미정(맨 뒤).
  const titles = page.getByTestId('dash-calendar').getByRole('link')
  await expect(titles.nth(0)).toContainText('종일 일정')
  await expect(titles.nth(1)).toContainText('오후 회의')
  await expect(titles.nth(2)).toContainText('미정 일정')

  // 시각 라벨은 24시간제(예: 14:00)로 렌더된다 — '오후' 등 12시간 표기 금지.
  const timed = titles.filter({ hasText: '오후 회의' }).getByTestId('cal-time')
  await expect(timed).toHaveText(/^\d{2}:\d{2}$/)
})

test('합성 — 메일은 "지금 신경 쓸 일"에 끼지 않고, 최상위는 포커스 카드로 강조된다', async ({
  authenticatedPage: page,
}) => {
  // mockWidgets 는 안 읽은 메일 "월간 보고서"(seen:false)를 포함한 mail-summary 를 모킹한다.
  await mockWidgets(page)
  // 마감 지난 이슈 1건 → 주의 최상위.
  await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([
      createIssue({ id: 1, projectKey: 'WP', number: 7, title: '지연된 이슈', dueDate: '2020-01-01' }),
    ]),
  )
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks']))
  await page.goto('/')

  const attention = page.getByTestId('dashboard-attention')
  // (출력) 안 읽은 메일이 있어도 주의 영역에 메일 행이 없다 — 가짜 "중요" 제거.
  await expect(attention).not.toContainText('월간 보고서')
  await expect(attention).not.toContainText('중요')
  // (출력) 최상위 항목은 포커스 카드로 강조되고, 정직한 이유("마감 지남")와 딥링크를 가진다.
  const focus = page.getByTestId('dashboard-attention-focus')
  await expect(focus).toBeVisible()
  await expect(focus).toContainText('지연된 이슈')
  await expect(focus).toContainText('마감 지남')
  await expect(focus).toHaveAttribute('href', '/projects/WP/issues/7')
  // (출력) 영역 용어 교체: '주의 필요' → '지금 신경 쓸 일'.
  await expect(attention).toContainText('지금 신경 쓸 일')
  await expect(attention).not.toContainText('주의 필요')
})

// ── #282 회귀 가드 ─────────────────────────────────────────────────────────

test('내 작업 — 이슈 행 딥링크와 헤더 부제가 렌더된다 (refs #282)', async ({
  authenticatedPage: page,
}) => {
  await mockApi(page, 'GET', '/api/v1/me/issues', issues())
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', issues())
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks']))
  await page.goto('/')

  // 위급도 리스트 렌더: IN_PROGRESS 이슈 1건이 행으로 표시된다 (refs #282 후속 — 듀얼 카운터 UI 폐기).
  const mytasks = page.getByTestId('dash-mytasks')
  await expect(mytasks.getByRole('link', { name: '이슈 열기: 로그인 버그' })).toBeVisible()
  // 헤더 부제 — "N건이 나를 기다림"
  await expect(mytasks).toContainText('건이 나를 기다림')
})

// ── #444 회귀 가드 ─────────────────────────────────────────────────────────
// 메일함에서 동기화하면 홈의 안 읽은 메일 위젯도 즉시 갱신되어야 한다.
// (useSyncMailbox.onSuccess 가 ['mail-summary'] 캐시를 무효화하지 않으면,
//  staleTime 30초 동안 위젯이 옛 카운트를 유지하던 버그 — #444.)
// 핵심: page.goto 풀 리로드는 QueryClient 캐시를 초기화해 invalidation 효과가
//       관찰되지 않으므로, 메일함↔홈 이동은 반드시 SPA 라우팅(클릭)으로 한다.
test('동기화 후 안 읽은 메일 위젯이 즉시 갱신된다 (#444)', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['unread_mail']))

  // mail-summary 동적 응답: 동기화 전 2건 → 동기화 후 3건(새 메일 '긴급 공지' 추가).
  // mockWidgets 의 정적 mail-summary 라우트보다 나중에 등록 → 우선 적용(Playwright LIFO).
  let synced = false
  await page.route(
    (url) => url.pathname === '/api/v1/me/mail-summary',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      const body: MailSummary = synced
        ? {
            unreadCount: 3,
            needsReplyCount: 0,
            classificationActive: false,
            recent: [
              {
                id: 200,
                accountId: 1,
                subject: '긴급 공지',
                fromAddress: 'ceo@example.com',
                fromName: '대표',
                snippet: null,
                receivedAt: '2026-06-16T02:00:00Z',
                seen: false,
                hasAttachment: false,
                aiCategory: null,
                aiNeedsReply: null,
              },
              ...mail().recent,
            ],
          }
        : mail()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    },
  )

  // 메일함(/mail/1) 진입·동기화에 필요한 스텁.
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [mailRow()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/sync-status', {
    phase: 'IDLE',
    total: 0,
    done: 0,
    running: false,
  })
  // 동기화 호출 시 플래그 전환 → 이후 mail-summary 가 3건을 반환.
  await page.route(
    (url) => url.pathname === '/api/v1/mail/accounts/1/sync',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      synced = true
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ fetched: 1, saved: 1 }),
      })
    },
  )

  // 1) 홈 진입 — 위젯에 동기화 전 상태(안읽음 2).
  await page.goto('/')
  await expect(page.getByTestId('dash-mail')).toContainText('안읽음 2')

  // 2) 위젯의 메일 링크로 메일함 SPA 이동(/mail → /mail/1 replace 리다이렉트). 풀 리로드 금지.
  await page.getByTestId('dash-mail').getByRole('link').first().click()
  await expect(page).toHaveURL(/\/mail\/1$/)

  // 3) 동기화 클릭 → sync 성공(saved:1) → ['mail-summary'] 무효화.
  await page.getByTestId('mail-sync').click()
  await expect(page.getByText('새 메일 1건을 받았습니다')).toBeVisible()

  // 4) 앱 레일 홈 링크로 SPA 복귀 — 위젯 재마운트 시 stale 캐시 재페치 → 갱신된 3건.
  await page.getByTestId('rail-link-/').click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('dash-mail')).toContainText('안읽음 3')
  await expect(page.getByTestId('dash-mail')).toContainText('긴급 공지')
})

// ── #474 KPI 스왑 / 메일 행 / CTA ───────────────────────────────────────────

test('합성 — 분류 활성 시 "안 읽음" KPI 가 "회신 필요 N"으로 스왑된다', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/mail-summary', {
    unreadCount: 9,
    needsReplyCount: 4,
    classificationActive: true,
    recent: [],
  } satisfies MailSummary)
  await page.goto('/')
  const counts = page.getByTestId('dashboard-counts')
  // 회신 필요 N KPI 가 렌더되어야 한다.
  await expect(counts.getByRole('link', { name: /회신 필요 4건/ })).toBeVisible()
  // 안 읽음 KPI 는 노출되지 않는다.
  await expect(counts).not.toContainText('안 읽음 9건')
})

test('합성 — 회신 필요 메일은 "지금 신경 쓸 일" 행으로(이슈·멘션 뒤), pending 은 제외', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/mail-summary', {
    unreadCount: 3,
    needsReplyCount: 1,
    classificationActive: true,
    recent: [
      {
        id: 100,
        accountId: 1,
        subject: '계약서 회신 요청',
        fromAddress: 'a@b.com',
        fromName: '거래처',
        snippet: null,
        receivedAt: '2026-06-16T00:00:00Z',
        seen: false,
        hasAttachment: false,
        aiCategory: 'ACTION',
        aiNeedsReply: true,
      },
      {
        id: 101,
        accountId: 1,
        subject: '뉴스레터',
        fromAddress: 'n@b.com',
        fromName: 'NL',
        snippet: null,
        receivedAt: '2026-06-16T01:00:00Z',
        seen: false,
        hasAttachment: false,
        aiCategory: null,
        aiNeedsReply: null, // pending — 제외 대상
      },
    ],
  } satisfies MailSummary)
  await page.goto('/')
  const attention = page.getByTestId('dashboard-attention')
  // 회신 필요 메일이 행으로 진입해야 한다.
  await expect(attention).toContainText('계약서 회신 요청')
  await expect(attention).toContainText('회신 필요')
  // pending(aiNeedsReply null) 메일은 제외.
  await expect(attention).not.toContainText('뉴스레터')
})

test('합성 — 분류 OFF 면 회신 필요 CTA 가 뜨고, dismiss 하면 사라지고 재방문해도 유지', async ({
  authenticatedPage: page,
}) => {
  // mockWidgets 의 mail() 기본값이 classificationActive=false 이므로 CTA 표시 조건 충족.
  await mockWidgets(page)
  await page.goto('/')
  const cta = page.getByTestId('dashboard-mail-cta')
  await expect(cta).toBeVisible()
  await expect(cta).toContainText('회신이 필요한 메일')
  // 닫기 버튼 클릭 → CTA 사라짐.
  await cta.getByRole('button', { name: '닫기' }).click()
  await expect(cta).toBeHidden()
  // reload 후에도 localStorage 영속 → CTA 미표시.
  await page.reload()
  await expect(page.getByTestId('dashboard-mail-cta')).toBeHidden()
})

// ── #474 신선도 — 메일 읽음 시 홈 요약 즉시 갱신 ──────────────────────────────
// useMailMessage 상세 조회 성공 시 ['mail-summary'] 캐시를 무효화하지 않으면
// 홈 복귀 시 회신 필요/안 읽음 KPI 가 stale 값을 유지한다.

test('메일 읽음 후 홈 회신 필요 KPI 가 즉시 갱신된다 (#474)', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  // SynthesisLayer 는 항상 렌더(layout 불문). dashboard-counts 사용을 위해 synthesis 전용 deps 스텁 추가.
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout([]))

  // mail-summary 동적 응답: 읽기 전 needsReplyCount=2 → 메시지 상세 GET 후 1.
  // mockWidgets 의 정적 mail-summary 라우트보다 나중에 등록 → 우선 적용(Playwright LIFO).
  let messageRead = false
  await page.route(
    (url) => url.pathname === '/api/v1/me/mail-summary',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          unreadCount: messageRead ? 2 : 3,
          needsReplyCount: messageRead ? 1 : 2,
          classificationActive: true,
          recent: [],
        } satisfies MailSummary),
      })
    },
  )

  // 메일함 진입·메시지 상세 스텁.
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [mailRow()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/sync-status', {
    phase: 'IDLE',
    total: 0,
    done: 0,
    running: false,
  })
  // 메시지 상세 GET 시 플래그 전환 → 이후 mail-summary 가 낮은 카운트를 반환.
  await page.route(
    (url) => url.pathname === '/api/v1/mail/messages/10',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      messageRead = true
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mailDetail()),
      })
    },
  )

  // 1) 홈 진입 — 분류 활성 → "회신 필요 2건" KPI(SynthesisLayer dashboard-counts).
  await page.goto('/')
  const counts = page.getByTestId('dashboard-counts')
  await expect(counts.getByRole('link', { name: /회신 필요 2건/ })).toBeVisible()

  // 2) "회신 필요" 카운트 링크 클릭 → /mail SPA 이동(풀 리로드 금지 — QueryClient 캐시 보존 필수).
  await counts.getByRole('link', { name: /회신 필요 2건/ }).click()
  await expect(page).toHaveURL(/\/mail\/1$/)

  // 3) 메시지 행 클릭 → 상세 GET → messageRead=true → useMailMessage invalidate 발동.
  await page.getByTestId('mail-row-10').click()
  await expect(page.getByTestId('mail-detail')).toBeVisible()

  // 4) 앱 레일 홈 링크로 SPA 복귀 — ['mail-summary'] 캐시 무효화 → 재페치 → 갱신된 1건.
  await page.getByTestId('rail-link-/').click()
  await expect(page).toHaveURL(/\/$/)
  await expect(counts.getByRole('link', { name: /회신 필요 1건/ })).toBeVisible()
})

// ── 알림 위젯 캐치업 재설계 ───────────────────────────────────────────────

// 같은 이슈에 코멘트 2 + 상태변경 1 (모두 안 읽음) → 한 그룹.
function groupedNotifs(): NotificationResponse[] {
  const base = {
    actorId: 2,
    actorName: '양동희',
    actorKind: 'HUMAN' as const,
    issueId: 1,
    projectKey: 'WP',
    issueNumber: 9,
    issueTitle: '배포 점검',
    commentId: null,
    eventId: null,
    eventTitle: null,
    eventStartsAt: null,
    read: false,
  }
  return [
    { ...base, id: 11, type: 'COMMENTED', createdAt: '2026-06-16T01:00:00Z' },
    { ...base, id: 12, type: 'COMMENTED', createdAt: '2026-06-16T02:00:00Z' },
    { ...base, id: 13, type: 'STATUS_CHANGED', createdAt: '2026-06-16T03:00:00Z' },
  ]
}

test('알림 위젯 — 같은 이슈 알림을 한 그룹으로 묶고 델타를 집계한다', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/notifications', groupedNotifs())
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['notifications']))
  await page.goto('/')

  // 업데이트 섹션은 접힘 없이 바로 보인다(다른 위젯과 동일한 평면 리스트).
  const rows = page.getByTestId('dash-notif-updates').getByTestId('dash-notif-row')
  // 3건이 1개 그룹 행으로 묶인다.
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('WP-9 · 배포 점검')
  await expect(rows.first()).toContainText('코멘트 2건 · 상태 변경')
})

test('알림 위젯 — ASSIGNED 는 내 차례, 그 외는 업데이트로 분류된다', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/notifications', [
    {
      id: 21, type: 'ASSIGNED', actorId: 2, actorName: '양동희', actorKind: 'HUMAN',
      issueId: 1, projectKey: 'WP', issueNumber: 7, issueTitle: '리뷰 요청 이슈',
      commentId: null, eventId: null, eventTitle: null, eventStartsAt: null,
      read: false, createdAt: '2026-06-16T05:00:00Z',
    },
    {
      id: 22, type: 'COMMENTED', actorId: 3, actorName: '김개발', actorKind: 'HUMAN',
      issueId: 2, projectKey: 'WP', issueNumber: 8, issueTitle: '문서 정리',
      commentId: null, eventId: null, eventTitle: null, eventStartsAt: null,
      read: false, createdAt: '2026-06-16T06:00:00Z',
    },
  ])
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['notifications']))
  await page.goto('/')

  // 내 차례 섹션엔 ASSIGNED(리뷰 요청 이슈).
  await expect(page.getByTestId('dash-notif-mine')).toContainText('리뷰 요청 이슈')
  // 업데이트 섹션엔 COMMENTED(문서 정리) — 접힘 없이 바로 노출.
  await expect(page.getByTestId('dash-notif-updates')).toContainText('문서 정리')
})

test('알림 위젯 — 행 ✓ 클릭 시 그룹의 미읽음을 read 처리한다', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/notifications', notifications()) // 단건 ASSIGNED(id:1)
  const readCapture = await mockApi(page, 'POST', '/api/v1/notifications/1/read', {}, { status: 204, capture: true })
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['notifications']))
  await page.goto('/')

  await page.getByTestId('dash-notif-ack').first().click()
  // waitForRequest 는 POST 가 도착하면 resolve, 10초 내 미도착이면 reject.
  await expect(readCapture.waitForRequest()).resolves.toBeTruthy()
})

test('알림 위젯 — "전부 확인" 클릭 시 read-all 을 호출한다', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/notifications', notifications())
  const allCapture = await mockApi(page, 'POST', '/api/v1/notifications/read-all', {}, { status: 204, capture: true })
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['notifications']))
  await page.goto('/')

  await page.getByTestId('dash-notif-ack-all').click()
  await expect(allCapture.waitForRequest()).resolves.toBeTruthy()
})

test('알림 위젯 — 미읽음이 없으면 "다 따라잡았어요" 빈 상태를 보인다', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  // 모두 읽음 → 미읽음 그룹 0.
  await mockApi(page, 'GET', '/api/v1/notifications', [
    {
      id: 31, type: 'COMMENTED', actorId: 2, actorName: '양동희', actorKind: 'HUMAN',
      issueId: 1, projectKey: 'WP', issueNumber: 7, issueTitle: '리뷰 요청 이슈',
      commentId: null, eventId: null, eventTitle: null, eventStartsAt: null,
      read: true, createdAt: '2026-06-16T00:00:00Z',
    },
  ])
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['notifications']))
  await page.goto('/')

  await expect(page.getByTestId('dash-notif-empty')).toContainText('다 따라잡았어요')
})

test('알림 위젯 — AI(AGENT) 행위자 그룹에 AI 배지를 표시한다', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/notifications', [
    {
      id: 41, type: 'ASSIGNED', actorId: 9, actorName: 'AI 비서', actorKind: 'AGENT',
      issueId: 1, projectKey: 'WP', issueNumber: 7, issueTitle: '리뷰 요청 이슈',
      commentId: null, eventId: null, eventTitle: null, eventStartsAt: null,
      read: false, createdAt: '2026-06-16T07:00:00Z',
    },
  ])
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['notifications']))
  await page.goto('/')

  await expect(page.getByTestId('dash-notif-mine').getByText('AI', { exact: true })).toBeVisible()
})

test('알림 위젯 — 업데이트가 표시 개수를 넘으면 헤더는 전체 수, 초과분은 "+N건 더"로 정직 표시', async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  // 서로 다른 이슈 6건(모두 COMMENTED·미읽음) → 6개 업데이트 그룹. 기본 표시 개수 5 초과.
  const many = Array.from({ length: 6 }, (_, i) => ({
    id: 50 + i,
    type: 'COMMENTED' as const,
    actorId: 2,
    actorName: '양동희',
    actorKind: 'HUMAN' as const,
    issueId: 100 + i,
    projectKey: 'WP',
    issueNumber: 100 + i,
    issueTitle: `이슈 ${100 + i}`,
    commentId: null,
    eventId: null,
    eventTitle: null,
    eventStartsAt: null,
    read: false,
    createdAt: `2026-06-16T0${i}:00:00Z`,
  }))
  await mockApi(page, 'GET', '/api/v1/notifications', many)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['notifications']))
  await page.goto('/')

  // 헤더는 잘린 수가 아니라 전체 6을 보여준다.
  await expect(page.getByTestId('dash-notif-updates-header')).toContainText('업데이트 6')
  // 5개만 렌더 + 초과 1건 안내.
  await expect(page.getByTestId('dash-notif-updates').getByTestId('dash-notif-row')).toHaveCount(5)
  await expect(page.getByTestId('dash-notif-overflow')).toContainText('+1건 더')
})

// ── 메일 위젯 리치 렌더 ──────────────────────────────────────────────────────

test('홈 메일 위젯 — 회신필요 배지·미리보기·시각 렌더', async ({
  authenticatedPage: page,
}) => {
  // 분류 활성 + 회신필요 1건 + snippet·hasAttachment 포함 mock.
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/mail-summary', {
    unreadCount: 3,
    needsReplyCount: 1,
    classificationActive: true,
    recent: [
      {
        id: 1,
        accountId: 1,
        subject: 'Q3 예산안',
        fromAddress: 'manager@example.com',
        fromName: '김팀장',
        snippet: '내일까지 의견',
        receivedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5분 전
        seen: false,
        hasAttachment: true,
        aiCategory: 'ACTION',
        aiNeedsReply: true,
      },
    ],
  } satisfies MailSummary)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['unread_mail']))

  await page.goto('/')
  const row = page.getByTestId('dash-mail-row').first()
  await expect(row).toContainText('김팀장')
  await expect(row).toContainText('Q3 예산안')
  await expect(row).toContainText('내일까지 의견')   // snippet
  await expect(row.getByTestId('dash-mail-badge-reply')).toBeVisible()  // 회신필요 배지
  await expect(page.getByTestId('dash-mail-hint')).toContainText('회신 필요 1')
})

test('홈 메일 위젯 — "회신 필요" 칩 토글로 회신필요 메일만 필터된다', async ({
  authenticatedPage: page,
}) => {
  // 회신필요 2건 + 그 외 1건 = 총 3행. 칩 토글 시 2행으로 필터.
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/mail-summary', {
    unreadCount: 3,
    needsReplyCount: 2,
    classificationActive: true,
    recent: [
      { id: 1, accountId: 1, subject: 'Q3 예산안', fromAddress: 'a@x.com', fromName: '김팀장', snippet: '내일까지', receivedAt: new Date(Date.now() - 2 * 60000).toISOString(), seen: false, hasAttachment: false, aiCategory: 'ACTION', aiNeedsReply: true },
      { id: 2, accountId: 1, subject: '시안 컨펌', fromAddress: 'b@x.com', fromName: '박서연', snippet: 'v3 확인', receivedAt: new Date(Date.now() - 40 * 60000).toISOString(), seen: false, hasAttachment: false, aiCategory: 'ACTION', aiNeedsReply: true },
      { id: 3, accountId: 1, subject: '주간 회의록', fromAddress: 'c@x.com', fromName: '이준호', snippet: '공유합니다', receivedAt: new Date(Date.now() - 3 * 3600000).toISOString(), seen: false, hasAttachment: false, aiCategory: 'FYI', aiNeedsReply: false },
    ],
  } satisfies MailSummary)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['unread_mail']))

  await page.goto('/')
  // 초기: 전체 3행.
  await expect(page.getByTestId('dash-mail-row')).toHaveCount(3)

  // 칩 클릭 → 회신필요 2행만, aria-pressed=true.
  const filter = page.getByTestId('dash-mail-filter')
  await expect(filter).toHaveAttribute('aria-pressed', 'false')
  await filter.click()
  await expect(filter).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('dash-mail-row')).toHaveCount(2)
  await expect(page.getByText('주간 회의록')).toHaveCount(0) // 회신필요 아닌 행 제외

  // 다시 클릭 → 전체 복귀.
  await filter.click()
  await expect(filter).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('dash-mail-row')).toHaveCount(3)
})

// ── 대화 위젯 ──────────────────────────────────────────────────────────────

test('홈 대화 위젯 — 멘션·회신대기 배지·미리보기·딥링크', async ({
  authenticatedPage: page,
}) => {
  // messagingSummary: needsReplyCount=3, recent=[DM 회신대기, CHANNEL 멘션]
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/messaging-summary', {
    unreadConversationCount: 3,
    needsReplyCount: 3,
    aiAttentionCount: 0,
    attentionCount: 3,
    recent: [
      {
        kind: 'DM',
        conversationId: 7,
        label: '홍길동',
        lastAuthorName: '홍길동',
        lastMessagePreview: '네 그렇게 진행할게요',
        lastMessageAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2분 전
        unreadCount: 1,
        mentioned: false,
        needsReply: true,
        newThreadReplyCount: 0,
        aiReason: null,
      },
      {
        kind: 'CHANNEL',
        conversationId: 3,
        label: '프로덕트',
        lastAuthorName: '박서연',
        lastMessagePreview: '@나 확인 부탁',
        lastMessageAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10분 전
        unreadCount: 2,
        mentioned: true,
        needsReply: false,
        newThreadReplyCount: 0,
        aiReason: null,
      },
    ],
  } satisfies MessagingSummary)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['recent_chats']))

  await page.goto('/')

  // DM 행 — 회신대기 배지 + 미리보기 + 딥링크
  const dm = page.getByTestId('dash-chat-row').first()
  await expect(dm).toContainText('홍길동')
  await expect(dm).toContainText('네 그렇게 진행할게요')
  await expect(dm.getByTestId('dash-chat-badge-reply')).toBeVisible()
  // DM 딥링크: conversationId=7 → /chat/dms/7
  await expect(dm).toHaveAttribute('href', '/chat/dms/7')

  // 회신 대기 힌트 — 메일과 대칭인 "회신 대기 N · 안읽음 M" 이중 집계
  await expect(page.getByTestId('dash-chat-hint')).toContainText('회신 대기 3 · 안읽음 3')

  // 채널 행 — 멘션 배지 + 딥링크
  const ch = page.getByTestId('dash-chat-row').nth(1)
  await expect(ch.getByTestId('dash-chat-badge-mention')).toBeVisible()
  await expect(ch).toHaveAttribute('href', '/chat/channels/3')
})

// ── SynthesisLayer 메시징 어텐션 ──────────────────────────────────────────────

// 합성 레이어 메시징 모킹 헬퍼 — SynthesisLayer 가 필요한 모든 엔드포인트 세팅.
// mockWidgets 위에 messaging-summary 와 dashboard(synthesis 위젯만)를 덮어씌운다.
// Playwright page.route 는 LIFO — 나중 등록이 우선 매칭되어 이전 mock 을 덮는다.
async function mockSynthesis(
  page: Page,
  overrides: Partial<MessagingSummary> = {},
) {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/messaging-summary', {
    unreadConversationCount: 0,
    needsReplyCount: 2,
    aiAttentionCount: 1,
    attentionCount: 2,
    recent: [],
    ...overrides,
  } satisfies MessagingSummary)
  // SynthesisLayer 는 dashboard 외부에 항상 렌더됨 — layout mock 은 빈 위젯 그리드(로딩 차단 방지).
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout([]))
}

test('메시징 — 확인 필요 KPI 셀이 attentionCount 단일값(dedup)을 표시한다', async ({
  authenticatedPage: page,
}) => {
  // needsReplyCount=2, aiAttentionCount=1 이지만 한 채널이 두 신호를 모두 가져 합집합 dedup=2.
  // KPI 는 단순 합산(3)이 아니라 백엔드 attentionCount(2) 단일값을 표시해야 한다(이중 집계 제거).
  await mockSynthesis(page, {
    needsReplyCount: 2,
    aiAttentionCount: 1,
    attentionCount: 2,
    recent: [],
  })
  await page.goto('/')

  // KPI 셀 "확인 필요" 가 보이고 dedup 카운트 2 를 표시해야 한다(3 이 아님).
  const kpiCell = page.getByTestId('kpi-messaging')
  await expect(kpiCell).toBeVisible()
  await expect(kpiCell).toContainText('확인 필요')
  await expect(kpiCell).toContainText('2')
  await expect(kpiCell).not.toContainText('3')
})

test('메시징 — AI 발굴 어텐션 행이 "지금 신경 쓸 일"에 진입하고 채널 딥링크로 이동한다', async ({
  authenticatedPage: page,
}) => {
  await mockSynthesis(page, {
    needsReplyCount: 0,
    aiAttentionCount: 1,
    attentionCount: 1,
    recent: [
      {
        kind: 'CHANNEL',
        conversationId: 12,
        label: '#dev',
        lastAuthorName: '박서연',
        lastMessagePreview: '배포 여부 확인',
        lastMessageAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        unreadCount: 1,
        mentioned: false,
        needsReply: false,
        newThreadReplyCount: 0,
        aiReason: '배포 여부 질문',
      },
    ],
  })
  await page.goto('/')

  // AI 발굴 행이 어텐션 영역에 나타나야 하며 meta 가 "확인 필요" 여야 한다.
  const attentionArea = page.getByTestId('dashboard-attention')
  await expect(attentionArea).toContainText('#dev')
  await expect(attentionArea).toContainText('확인 필요')

  // 클릭 시 /chat/channels/12 로 이동.
  const link = attentionArea.getByRole('link', { name: /대화 열기: #dev/ })
  await link.click()
  await expect(page).toHaveURL('/chat/channels/12')
})

test('메시징 — DM 회신 행이 어텐션 영역에 진입하고 DM 딥링크로 이동한다', async ({
  authenticatedPage: page,
}) => {
  await mockSynthesis(page, {
    needsReplyCount: 1,
    aiAttentionCount: 0,
    attentionCount: 1,
    recent: [
      {
        kind: 'DM',
        conversationId: 7,
        label: '이대리',
        lastAuthorName: '이대리',
        lastMessagePreview: '확인해주세요',
        lastMessageAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
        unreadCount: 1,
        mentioned: false,
        needsReply: true,
        newThreadReplyCount: 0,
        aiReason: null,
      },
    ],
  })
  await page.goto('/')

  // DM 회신 행이 어텐션 영역에 나타나야 한다.
  const attentionArea = page.getByTestId('dashboard-attention')
  await expect(attentionArea).toContainText('이대리')

  // 클릭 시 /chat/dms/7 로 이동.
  const link = attentionArea.getByRole('link', { name: /대화 열기: 이대리/ })
  await link.click()
  await expect(page).toHaveURL('/chat/dms/7')
})

test('메시징 — 어텐션 신호 없는 대화는 "지금 신경 쓸 일"에 나타나지 않는다', async ({
  authenticatedPage: page,
}) => {
  await mockSynthesis(page, {
    needsReplyCount: 0,
    aiAttentionCount: 0,
    attentionCount: 0,
    recent: [
      {
        kind: 'CHANNEL',
        conversationId: 99,
        label: '#잡담',
        lastAuthorName: '동료A',
        lastMessagePreview: '점심 뭐먹지',
        lastMessageAt: new Date(Date.now() - 1 * 60 * 1000).toISOString(),
        unreadCount: 0,
        mentioned: false,
        needsReply: false,
        newThreadReplyCount: 0,
        aiReason: null,
      },
    ],
  })
  await page.goto('/')

  // 어텐션 영역에 #잡담 행이 없어야 한다.
  await expect(page.getByTestId('dashboard-attention')).not.toContainText('#잡담')
})

test('합성 — 크로스앱 정렬: 이슈(urgency 0)→메시지(urgency 1)→메일(urgency 2) 순서로 렌더된다', async ({
  authenticatedPage: page,
}) => {
  // 이슈(urgency 0), 메시지(urgency 1), 회신 필요 메일(urgency 2) 동시 존재 시
  // "지금 신경 쓸 일" 리스트에서 urgency asc 정렬이 보장되어야 한다.
  await mockWidgets(page)

  // 마감 지난 이슈 — urgency 0.
  await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([
      createIssue({ id: 1, projectKey: 'WP', number: 7, title: '마감 지난 이슈', dueDate: '2020-01-01' }),
    ]),
  )

  // 회신 필요 메일 — urgency 2.
  await mockApi(page, 'GET', '/api/v1/me/mail-summary', {
    unreadCount: 1,
    needsReplyCount: 1,
    classificationActive: true,
    recent: [
      {
        id: 200,
        accountId: 1,
        subject: '계약 검토 요청',
        fromAddress: 'a@b.com',
        fromName: '거래처',
        snippet: null,
        receivedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        seen: false,
        hasAttachment: false,
        aiCategory: 'ACTION',
        aiNeedsReply: true,
      },
    ],
  } satisfies MailSummary)

  // 메시지 AI 발굴 대화 — urgency 1.
  await mockApi(page, 'GET', '/api/v1/me/messaging-summary', {
    unreadConversationCount: 1,
    needsReplyCount: 0,
    aiAttentionCount: 1,
    attentionCount: 1,
    recent: [
      {
        kind: 'CHANNEL',
        conversationId: 5,
        label: '#dev',
        lastAuthorName: '박서연',
        lastMessagePreview: '배포 확인 부탁',
        lastMessageAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        unreadCount: 1,
        mentioned: false,
        needsReply: false,
        newThreadReplyCount: 0,
        aiReason: '배포 여부 질문',
      },
    ],
  } satisfies MessagingSummary)

  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout([]))
  await page.goto('/')

  // "지금 신경 쓸 일" 영역에 세 행이 모두 있어야 한다.
  const attention = page.getByTestId('dashboard-attention')
  await expect(attention).toContainText('마감 지난 이슈')
  await expect(attention).toContainText('#dev')
  await expect(attention).toContainText('계약 검토 요청')

  // 포커스 카드(최상위 = urgency 0 이슈)가 이슈여야 한다.
  await expect(page.getByTestId('dashboard-attention-focus')).toContainText('마감 지난 이슈')

  // 나머지 행의 DOM 순서: 메시지(urgency 1) → 메일(urgency 2).
  // dashboard-attention 내 링크 목록에서 포커스 카드(첫 번째)를 제외한 순서 검증.
  const links = attention.getByRole('link')
  // links.nth(0) = 포커스 카드(이슈), nth(1) = 첫 번째 리스트 행(메시지), nth(2) = 두 번째 리스트 행(메일).
  await expect(links.nth(1)).toContainText('#dev')
  await expect(links.nth(2)).toContainText('계약 검토 요청')
})

// ── 메시징 신선도 — 읽음 후 messaging-summary 재조회 (#476) ─────────────────

test('메시징 — 채널 읽음(markRead) 후 messaging-summary 가 재조회된다 (#476)', async ({
  authenticatedPage: page,
}) => {
  // messaging-summary 호출 횟수 추적.
  // 읽음 onSuccess invalidate 발동 → 홈 복귀 시 stale 재조회 포함 2회 이상이어야 한다.
  let summaryCallCount = 0
  await page.route(
    (url) => url.pathname === '/api/v1/me/messaging-summary',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      summaryCallCount++
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          unreadConversationCount: summaryCallCount > 1 ? 0 : 1,
          needsReplyCount: 0,
          aiAttentionCount: 0,
          attentionCount: 0,
          recent: [],
        } satisfies MessagingSummary),
      })
    },
  )

  // 채널 목록·SSE·메시지 스텁.
  const CHANNEL_ID = 500
  const channel = createChannel({ id: CHANNEL_ID, name: '#general', unreadCount: 1 })
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([channel]) })
        : route.fallback(),
  )
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/dms',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
        : route.fallback(),
  )
  // SSE 스텁 — 미스텁 flake 방지(빈 keep-alive 스트림).
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/stream',
    (route) =>
      route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'cache-control': 'no-cache' }, body: `:\n\n` }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(channel) })
        : route.fallback(),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/members`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([createChannelMember({ userId: 1 })]),
          })
        : route.fallback(),
  )
  // 메시지 목록 — id:100 이 viewport 에 진입 시 IntersectionObserver → markRead(100) 발화.
  const msg = createMessage({ id: 100, channelId: CHANNEL_ID, authorId: 2, body: '안녕하세요' })
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: [msg], nextCursor: null, hasMore: false }),
          })
        : route.fallback(),
  )
  // mark-read POST stub — 204 응답 후 onSuccess invalidate 발동.
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/read`,
    (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 204, body: '' })
        : route.fallback(),
  )
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout([]))
  // SynthesisLayer 가 필요한 공통 스텁 (auth.fixture 기본 스텁 미포함 항목).
  await mockApi(page, 'GET', '/api/v1/notifications', [])
  await mockApi(page, 'GET', '/api/v1/calendar/events', [])
  await mockApi(page, 'GET', '/api/v1/me/issues', { items: [], nextCursor: null, hasMore: false })
  await mockApi(page, 'GET', '/api/v1/me/mail-summary', { unreadCount: 0, recent: [] })

  // 1) 홈 진입 → SynthesisLayer 마운트 → messaging-summary 첫 조회.
  //    waitForResponse 는 route.fulfill 완료 후 발화 → 카운터 increment 보장.
  const firstSummaryPromise = page.waitForResponse(
    (res) => res.url().includes('/me/messaging-summary') && res.request().method() === 'GET',
    { timeout: 5000 },
  )
  await page.goto('/')
  await firstSummaryPromise
  expect(summaryCallCount).toBeGreaterThanOrEqual(1)

  // 2) 채널 진입 + markRead POST 대기를 동시에 설정.
  //    waitForResponse 는 goto 이전에 Promise 로 미리 걸어야 한다.
  const markReadPromise = page.waitForResponse(
    (res) => res.url().includes(`/channels/${CHANNEL_ID}/read`) && res.request().method() === 'POST',
    { timeout: 8000 },
  )
  await page.goto(`/chat/channels/${CHANNEL_ID}`)
  await expect(page.getByText('안녕하세요')).toBeVisible()
  // IntersectionObserver 가 메시지를 감지하고 markRead 를 호출할 때까지 대기.
  await markReadPromise

  // 3) 홈으로 복귀 → invalidate 로 stale 된 ['messaging-summary'] 가 재조회된다.
  const summaryRefetchPromise = page.waitForResponse(
    (res) => res.url().includes('/me/messaging-summary') && res.request().method() === 'GET',
    { timeout: 5000 },
  )
  await page.goto('/')
  await summaryRefetchPromise

  // invalidate + 재조회로 총 2회 이상 호출됐어야 한다.
  expect(summaryCallCount).toBeGreaterThanOrEqual(2)
})
