import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures/auth.fixture'
import { mockApi } from '../fixtures/api-mock'
import { createIssue, createIssueSearchResponse } from '../factories/issue.factory'
import type { CalendarEvent } from '../../src/types/calendar'
import type {
  DashboardLayout,
  DashboardWidgetConfig,
  MailSummary,
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

test('대시보드 — 안 읽은 대화 위젯 제목과 빈 상태 문구가 일치한다 (refs #272)', async ({
  authenticatedPage: page,
}) => {
  // 모든 채널/DM 안 읽음 수 0 → 빈 상태.
  await mockApi(page, 'GET', '/api/v1/messaging/channels', [
    {
      id: 10,
      kind: 'CHANNEL',
      name: 'general',
      visibility: 'PUBLIC',
      member: true,
      role: 'MEMBER',
      archived: false,
      memberCount: 5,
      unreadCount: 0,
      createdAt: '2026-06-01T00:00:00Z',
    },
  ])
  await mockApi(page, 'GET', '/api/v1/messaging/dms', [])
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['recent_chats']))
  await page.goto('/')

  // 위젯 헤더 제목이 '안 읽은 대화' 여야 한다 (title vs 빈 상태 불일치 회귀 방지).
  const headerLink = page
    .getByTestId('dashboard-widget')
    .getByRole('link', { name: /안 읽은 대화/ })
  await expect(headerLink).toBeVisible()

  // 빈 상태 메시지가 제목과 동일한 맥락('안 읽은 대화가 없어요').
  await expect(page.getByTestId('dash-chats-empty')).toContainText('안 읽은 대화가 없어요')
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

  // 안 읽은 대화 행(채널) → 채널 상세.
  await expect(
    page.getByTestId('dash-chats').getByRole('link', { name: '대화 열기: # general' }),
  ).toHaveAttribute('href', '/chat/channels/10')

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
  await expect(counts.getByRole('link', { name: '멘션 1건' })).toBeVisible()
  await expect(counts.getByRole('link', { name: '오늘 마감 1건' })).toBeVisible()

  // 카운트 셀은 모듈 딥링크.
  await expect(counts.getByRole('link', { name: '안 읽음 2건' })).toHaveAttribute('href', '/mail')
  await expect(counts.getByRole('link', { name: '오늘 일정 1건' })).toHaveAttribute(
    'href',
    '/calendar',
  )
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
  await expect(page.getByTestId('dashboard-attention-empty')).toContainText('다 확인했어요')
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
function manyIssues(n: number) {
  return createIssueSearchResponse(
    Array.from({ length: n }, (_, i) =>
      createIssue({ id: i + 1, projectKey: 'WP', number: i + 1, title: `이슈 ${i + 1}` }),
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
  await expect(page.getByTestId('dashboard-edit-live')).toHaveText('안 읽은 메일 위젯을 추가했습니다')
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

// ── #282 회귀 가드 ─────────────────────────────────────────────────────────

test('내 작업 — 내 담당·워치 카운터가 모두 ai-accent 색으로 일관된다 (refs #282)', async ({
  authenticatedPage: page,
}) => {
  await mockApi(page, 'GET', '/api/v1/me/issues', issues())
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', issues())
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks']))
  await page.goto('/')

  // 두 카운터 모두 text-ai-accent 클래스 — 시각 일관성 회귀 가드 (refs #282).
  const mytasks = page.getByTestId('dash-mytasks')
  const counters = mytasks.locator('.text-2xl')
  await expect(counters.nth(0)).toHaveClass(/text-ai-accent/) // 내 담당
  await expect(counters.nth(1)).toHaveClass(/text-ai-accent/) // 워치
})
