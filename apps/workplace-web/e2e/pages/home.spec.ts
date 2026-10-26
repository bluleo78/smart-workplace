import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures/auth.fixture'
import { mockApi } from '../fixtures/api-mock'
import { expectSelectedRow } from '../fixtures/selection'
import { dropDnd, expectStays, measureBox, resizeAndSettle, startKeyboardDrag } from '../fixtures/wait'
import { trackRequests } from '../fixtures/requests'
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
import type { PriorityItemsResponse } from '../../src/api/priorityItems'

// 홈 고정 대시보드 E2E — 브라우저가 있어야 판정되는 것만 남긴다(WP-971): 대표 배선(@wiring), 실제 드래그·키보드·포커스(@input),
// 기하·계산된 스타일·뷰포트 경계(@layout), 다른 화면을 거쳐 홈이 갱신되는 흐름(@flow).
// 백엔드 없이 /me/dashboard·위젯별 엔드포인트를 모킹해 검증한다.
// 옮긴 판정(화면 컴포넌트 테스트, WP-982):
//  - 위젯 헤더·행 딥링크, 카탈로그 params, 합성 카운트·주의 필요, 빠른 액션, 실패 격리 → src/pages/home/dashboardView.test.tsx
//  - 편집 이동·숨김·항목 수·취소·되돌리기·위젯 추가 모달·저장 막힘 → src/pages/home/dashboardEdit.test.tsx
//  - 모바일 빈 상태 → src/pages/mobile/homeDashboard.test.tsx
//  - 오늘 일정·내 작업·알림·메일·대화·AI 우선순위 위젯 본문, 합성 정렬·멘션 묶음, 카탈로그 위젯 추가·삭제·테두리 숨김
//    → src/pages/home/homeWidgetDashboard.test.tsx

// 대시보드 저장(PUT /me/dashboard) 요청 본문.
type DashboardPut = { widgets: DashboardWidgetConfig[] }

// 레이아웃 응답 헬퍼 — 객체-배열 컨트랙트. 위젯 순서가 곧 렌더 순서.
// bare 문자열은 {type, count:5, hidden:false} 로 정규화(기존 호출부 호환).
function layout(widgets: (string | DashboardWidgetConfig)[]): DashboardLayout {
  return {
    widgets: widgets.map((w) =>
      typeof w === 'string' ? { id: w, type: w, count: 5, hidden: false } : w,
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
      calendarId: 1,
      calendarName: '내 캘린더',
      effectiveColor: '#3b82f6',
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
      lastReadMessageId: null,
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

/**
 * 끌기 좌표를 재기 전에 위젯 본문이 mockWidgets 데이터로 다 채워질 때까지 기다린다(회귀 안정화, WP-55).
 * 위젯 본문은 지연 로드 + 각자 조회라 스켈레톤 높이로 먼저 그려진다 — 부하에서 카드 좌표를 잰 뒤에 응답이 도착하면
 * 카드 높이가 바뀌어 미리 잰 놓을 자리가 다른 카드 위가 되고, 순서가 한 칸 어긋난 채 놓였다.
 */
async function expectWidgetBodiesLoaded(page: Page, types: string[]) {
  const loaded: Record<string, () => Promise<void>> = {
    priority_quadrant: () => expect(page.getByTestId('priority-quadrant-empty')).toBeVisible(),
    quick_actions: () => expect(page.getByTestId('dashboard-quickactions')).toBeVisible(),
    my_tasks: () => expect(page.getByTestId('dash-mytasks')).toBeVisible(),
    notifications: () => expect(page.getByTestId('dash-notif')).toContainText('리뷰 요청 이슈'),
    recent_chats: () => expect(page.getByTestId('dash-chat-empty')).toBeVisible(),
    unread_mail: () => expect(page.getByTestId('dash-mail')).toContainText('월간 보고서'),
  }
  for (const type of types) await loaded[type]()
}

test('대시보드 — 저장 레이아웃 순서로 5종 위젯이 렌더된다', { tag: ['@wiring', '@smoke'] }, async ({
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

// ── 카탈로그 위젯 헤더 딥링크 (#807) ─────────────────────────────────────────
// 카탈로그 위젯 헤더도 시스템 위젯처럼 링크여야 하며, 위젯 params 가 대상 화면 URL 쿼리로 반영된다.
// 대상 화면에 대응 쿼리가 없는 params(unreadOnly/range/query 등)는 폐기하고 모듈 루트로 폴백한다.

/** 카탈로그 위젯 카드의 헤더 링크(본문 내부 링크와 구분하기 위해 카드 직속 헤더만 조회). */
function catalogHeaderLink(page: Page, id: string) {
  return page.locator(`[data-testid="dashboard-widget"][data-widget-id="${id}"] > [data-slot="card-header"] a`)
}

// 표시 이름 입력 40자 상한은 화면 테스트 src/pages/home/dashboardEdit.test.tsx 가 지킨다 — 여기는 실제 폭에서 아이콘 크기만 잰다.
test('카탈로그 위젯 — 긴 표시 이름에도 헤더 아이콘은 16px 을 유지한다 (WP-519)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  const longLabel = '마케팅본부 디지털전략팀 2026년 하반기 핵심 과제 및 신제품 출시 준비'
  expect(longLabel.length).toBeLessThanOrEqual(40)
  await mockWidgets(page)
  await mockApi(
    page,
    'GET',
    '/api/v1/me/dashboard',
    layout([{ id: 'w-long', type: 'issue_list', count: 0, hidden: false, params: { assignee: 'me' }, label: longLabel }]),
  )
  await page.goto('/')

  // 1/3 폭 카드에서 표시 이름이 두 줄로 감겨도 아이콘은 flex 축소되지 않는다.
  const header = catalogHeaderLink(page, 'w-long')
  await expect(header).toContainText(longLabel)
  const icon = await header.locator('svg').first().boundingBox()
  expect(icon?.width).toBe(16)
  expect(icon?.height).toBe(16)
})

// WP-842 — 키보드로 위젯을 삭제하면 카드가 통째로 빠져 포커스가 body 로 사라졌다. 그 자리에 온 위젯(마지막이었으면 앞 위젯)의
// 삭제 버튼으로, 마지막 위젯을 지우면 빈 상태의 「위젯 추가」로 옮겨 이어서 조작할 수 있어야 한다.
test('대시보드 편집 — 키보드로 위젯을 삭제하면 그 자리에 온 위젯의 버튼으로 포커스가 간다 (WP-842)', { tag: '@input' }, async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  const catalog = (id: string, label: string) => ({ id, type: 'issue_list', count: 0, hidden: false, params: { assignee: 'me' }, label })
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout([catalog('w-a', '첫째 목록'), catalog('w-b', '둘째 목록'), 'my_tasks']))
  await page.goto('/')
  await page.getByTestId('dashboard-edit-toggle').click()

  const widget = (id: string) => page.locator(`[data-testid="dashboard-widget"][data-widget-id="${id}"]`)
  await widget('w-a').getByTestId('widget-remove').focus()
  await page.keyboard.press('Enter')
  await expect(widget('w-a')).toHaveCount(0)
  await expect(widget('w-b').getByTestId('widget-remove')).toBeFocused()
  // 마지막 자리를 지우면 바로 앞 위젯으로.
  await widget('my_tasks').getByTestId('widget-remove').focus()
  await page.keyboard.press('Enter')
  await expect(widget('my_tasks')).toHaveCount(0)
  await expect(widget('w-b').getByTestId('widget-remove')).toBeFocused()
})

test('대시보드 편집 — 마지막 위젯을 키보드로 삭제하면 빈 상태의 「위젯 추가」로 포커스가 간다 (WP-842)', { tag: '@input' }, async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout([{ id: 'w-only', type: 'issue_list', count: 0, hidden: false, params: { assignee: 'me' }, label: '하나뿐' }]))
  await page.goto('/')
  await page.getByTestId('dashboard-edit-toggle').click()
  await page.getByTestId('widget-remove').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('dashboard-empty-action')).toBeFocused()
})

// ── 편집 모드 — 실제 드래그·키보드 조작 ───────────────────────────────────

test('편집 — 드래그로 위젯 순서 변경 → 저장 시 PUT payload 순서 반영', { tag: '@input' }, async ({
  authenticatedPage: page,
}) => {
  const puts = trackRequests(page, 'PUT', '/api/v1/me/dashboard')
  await page.route(
    (url) => url.pathname === '/api/v1/me/dashboard',
    (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(layout(['my_tasks', 'unread_mail'])),
        })
      }
      if (route.request().method() !== 'PUT') return route.continue()
      const body: unknown = route.request().postDataJSON()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    },
  )
  await mockWidgets(page)
  await page.goto('/')

  await page.getByTestId('dashboard-edit-toggle').click()
  await expect(page.getByTestId('dashboard-edit-banner')).toBeVisible()

  const myTasksCard = page.locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')
  const unreadMailCard = page.locator('[data-testid="dashboard-widget"][data-widget="unread_mail"]')

  // my_tasks 드래그 핸들을 unread_mail 카드 중앙으로 드래그 → 순서 반전.
  // dnd-kit PointerSensor(distance:8) 활성화를 위해 hover → down → move(0,0) → move(target, steps) → up.
  const handle = myTasksCard.getByTestId('widget-drag-handle')
  await expectWidgetBodiesLoaded(page, ['my_tasks', 'unread_mail'])
  const targetBox = await unreadMailCard.boundingBox()
  if (!targetBox) throw new Error('unread_mail 카드 bounding box 없음')
  await handle.hover()
  await page.mouse.down()
  await page.mouse.move(0, 0)
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 12,
  })
  await dropDnd(page)

  // 드래그 직후 DOM 순서에 실시간 재배치가 반영될 때까지 대기.
  const cardsAfterDrag = page.getByTestId('dashboard-widget')
  await expect(cardsAfterDrag.nth(0)).toHaveAttribute('data-widget', 'unread_mail')
  await expect(cardsAfterDrag.nth(1)).toHaveAttribute('data-widget', 'my_tasks')

  // dnd-kit PointerSensor 는 드래그 종료(detach) 후 document 캡처 단계 click 리스너로 다음 클릭들을
  // setTimeout(removeAll, 50) 만큼(내부 고정 50ms, 앱 코드로 관측 불가) 전부 삼킨다. 그 창 안에서
  // 저장 버튼을 클릭하면 이벤트가 도달하지 못해 클릭이 무효화된다. 더미 클릭으로 미리 소비하는 방식은
  // 그 더미 클릭 자체가 창 안에 들지 않으면(부하로 인한 타이밍 변동) 무의미하고 뒤이은 실제 클릭도
  // 여전히 창에 걸릴 수 있어 근본적으로 레이스 — 목표 상태(배너 소멸 = onSuccess 완료)가 나타날
  // 때까지 클릭을 재시도해 결정론적으로 만든다. (저장 버튼 disabled 전환을 신호로 쓰지 않는 이유:
  // 목 응답이 동기적으로 즉시 resolve 돼 편집모드가 disabled 관측 전에 이미 종료·버튼이 사라질 수 있음)
  const saveButton = page.getByTestId('dashboard-edit-save')
  const banner = page.getByTestId('dashboard-edit-banner')
  await expect(async () => {
    if ((await saveButton.count()) > 0) {
      await saveButton.click({ timeout: 200 }).catch(() => {})
    }
    await expect(banner).toHaveCount(0, { timeout: 200 })
  }).toPass({ timeout: 3000 })

  // 배너가 사라지면 PUT 이 resolve 되어 onSuccess 가 끝난 것.
  await expect(banner).toHaveCount(0)
  expect(puts.lastBody<DashboardPut>()!.widgets.map((w) => w.type)).toEqual(['unread_mail', 'my_tasks'])
})

test('편집 — 드래그 핸들에서 Space·→·Space 로 키보드만으로 순서를 바꾼다 (WP-641)', { tag: '@input' }, async ({
  authenticatedPage: page,
}) => {
  const puts = trackRequests(page, 'PUT', '/api/v1/me/dashboard')
  await page.route(
    (url) => url.pathname === '/api/v1/me/dashboard',
    (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: layout(['my_tasks', 'unread_mail']) })
      if (route.request().method() !== 'PUT') return route.continue()
      return route.fulfill({ json: route.request().postDataJSON() as unknown })
    },
  )
  await mockWidgets(page)
  await page.goto('/')
  await page.getByTestId('dashboard-edit-toggle').click()
  await expectWidgetBodiesLoaded(page, ['my_tasks', 'unread_mail'])

  const handle = page.locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]').getByTestId('widget-drag-handle')
  const liveRegion = page.locator('[id^="DndLiveRegion"]')
  // 집은 뒤 센서가 방향키 리스너를 붙일 때까지 기다린다(부하에서 바로 누른 방향키가 버려지지 않게).
  await startKeyboardDrag(handle, () => expect(liveRegion).toContainText('집었습니다'))
  await page.keyboard.press('ArrowRight')
  // 방향키 뒤 놓을 자리(over)는 다음 프레임에 잡힌다 — 그 안내가 나온 뒤 놓는다(사람의 키 입력 간격과 같은 순서).
  await expect(liveRegion).toContainText('2번째 자리 위에')
  await page.keyboard.press('Space')
  await expect(liveRegion).toContainText('2번째 자리에 놓았습니다')
  const cards = page.getByTestId('dashboard-widget')
  await expect(cards.nth(0)).toHaveAttribute('data-widget', 'unread_mail')
  await expect(cards.nth(1)).toHaveAttribute('data-widget', 'my_tasks')

  await page.getByTestId('dashboard-edit-save').click()
  await expect(page.getByTestId('dashboard-edit-banner')).toHaveCount(0)
  expect(puts.lastBody<DashboardPut>()!.widgets.map((w) => w.type)).toEqual(['unread_mail', 'my_tasks'])
})

test('편집 — wide(col-span-3) 위젯을 좁은 위젯 바로 다음으로 드래그하면 건너뛰지 않고 정확히 그 자리로 이동한다 (#645)', { tag: '@input' }, async ({
  authenticatedPage: page,
}) => {
  // 재현 조건: wide 위젯(quick_actions)과 일반 위젯(my_tasks/notifications/recent_chats)이
  // 3열 그리드에 혼재된 상태에서, quick_actions 를 my_tasks 카드 하단(바로 다음 자리)까지 드래그.
  // closestCenter 는 드래그 중인 quick_actions 오버레이가 원래 폭(3컬럼 전체)을 그대로 유지해 중심
  // x 좌표가 그리드 가운데에 고정되므로, 실제 포인터가 my_tasks(1번째 컬럼) 위에 있어도 다른 카드가
  // 더 가깝게 계산되어 엉뚱한 위치로 건너뛴다. pointerWithin 기반 판정으로 교체하면 포인터가 실제로
  // 위치한 카드가 그대로 over 로 잡혀 my_tasks 바로 다음 자리에 정확히 삽입된다.
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/priority-items', { items: [] } satisfies PriorityItemsResponse)
  await mockApi(
    page,
    'GET',
    '/api/v1/me/dashboard',
    layout(['priority_quadrant', 'quick_actions', 'my_tasks', 'notifications', 'recent_chats', 'unread_mail']),
  )
  const puts = trackRequests(page, 'PUT', '/api/v1/me/dashboard')
  await page.route(
    (url) => url.pathname === '/api/v1/me/dashboard',
    (route) => {
      if (route.request().method() !== 'PUT') return route.fallback()
      const body: unknown = route.request().postDataJSON()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    },
  )
  await page.goto('/')

  await page.getByTestId('dashboard-edit-toggle').click()
  await expect(page.getByTestId('dashboard-edit-banner')).toBeVisible()

  const quickActionsCard = page.locator('[data-testid="dashboard-widget"][data-widget="quick_actions"]')
  const myTasksCard = page.locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')

  const handle = quickActionsCard.getByTestId('widget-drag-handle')
  await expectWidgetBodiesLoaded(page, ['priority_quadrant', 'quick_actions', 'my_tasks', 'notifications', 'recent_chats', 'unread_mail'])
  const targetBox = await myTasksCard.boundingBox()
  if (!targetBox) throw new Error('my_tasks 카드 bounding box 없음')
  // my_tasks 카드 중앙으로 드래그 — 포인터가 my_tasks 컬럼(1번째 컬럼) 위에 있음.
  const targetX = targetBox.x + targetBox.width / 2
  const targetY = targetBox.y + targetBox.height / 2
  await handle.hover()
  await page.mouse.down()
  await page.mouse.move(0, 0)
  await page.mouse.move(targetX, targetY, { steps: 12 })
  await dropDnd(page)

  // 드래그 직후 DOM 순서 — quick_actions 가 my_tasks 바로 다음 자리로 이동(다른 카드를 건너뛰지 않음).
  const cardsAfterDrag = page.getByTestId('dashboard-widget')
  await expect(cardsAfterDrag.nth(0)).toHaveAttribute('data-widget', 'priority_quadrant')
  await expect(cardsAfterDrag.nth(1)).toHaveAttribute('data-widget', 'my_tasks')
  await expect(cardsAfterDrag.nth(2)).toHaveAttribute('data-widget', 'quick_actions')
  await expect(cardsAfterDrag.nth(3)).toHaveAttribute('data-widget', 'notifications')
  await expect(cardsAfterDrag.nth(4)).toHaveAttribute('data-widget', 'recent_chats')
  await expect(cardsAfterDrag.nth(5)).toHaveAttribute('data-widget', 'unread_mail')

  // dnd-kit PointerSensor 드래그 종료 후 문서 캡처 단계 click 삼킴 창 회피 — 기존 드래그 테스트와 동일 패턴.
  const saveButton = page.getByTestId('dashboard-edit-save')
  const banner = page.getByTestId('dashboard-edit-banner')
  await expect(async () => {
    if ((await saveButton.count()) > 0) {
      await saveButton.click({ timeout: 200 }).catch(() => {})
    }
    await expect(banner).toHaveCount(0, { timeout: 200 })
  }).toPass({ timeout: 3000 })

  await expect(banner).toHaveCount(0)
  expect(puts.lastBody<DashboardPut>()!.widgets.map((w) => w.type)).toEqual([
    'priority_quadrant',
    'my_tasks',
    'quick_actions',
    'notifications',
    'recent_chats',
    'unread_mail',
  ])
})

test('편집 — 편집 중 lg 경계를 넘었다 돌아오면 미저장 초안과 편집 모드가 복원되고 저장은 데스크톱 레이아웃으로 간다 (WP-162)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks', 'unread_mail']))
  const puts = trackRequests(page, 'PUT', '/api/v1/me/dashboard')
  await page.route(
    (url) => url.pathname === '/api/v1/me/dashboard',
    (route) => {
      if (route.request().method() !== 'PUT') return route.fallback()
      return route.fulfill({ json: route.request().postDataJSON() })
    },
  )
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByTestId('dashboard-edit-toggle').click()
  const myTasksCard = page.locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')
  await myTasksCard.getByTestId('widget-hide-toggle').click()
  await expect(myTasksCard).toHaveAttribute('data-hidden', 'true')

  // 1023px — 모바일 셸로 바뀌며 Dashboard 가 다시 마운트된다. 데스크톱 초안은 모바일 화면에 보이지 않고(편집 아님) 저장도 없다.
  await resizeAndSettle(page, { width: 1023, height: 800 })
  await expect(page.getByTestId('dashboard-edit-banner')).toHaveCount(0)
  await expect(page.getByTestId('dashboard-edit-toggle')).toBeVisible()
  expect(puts.requests()).toHaveLength(0)

  // 1280px 복귀 — 셸이 다시 바뀌어도 초안(my_tasks 숨김)·편집 모드·되돌리기가 그대로 살아 있다.
  await resizeAndSettle(page, { width: 1280, height: 800 })
  await expect(page.getByTestId('dashboard-edit-banner')).toBeVisible()
  await expect(myTasksCard).toHaveAttribute('data-hidden', 'true')
  await expect(page.getByTestId('dashboard-edit-undo')).toBeEnabled()
  expect(puts.requests()).toHaveLength(0)

  // 저장 — 데스크톱 레이아웃(device=mobile 아님)에 숨김이 반영된다.
  await page.getByTestId('dashboard-edit-save').click()
  await expect(page.getByTestId('dashboard-edit-banner')).toHaveCount(0)
  expect(puts.requests()).toHaveLength(1)
  expect(new URL(puts.requests()[0].url()).searchParams.get('device')).not.toBe('mobile')
  expect(puts.lastBody<DashboardPut>()!.widgets.find((w) => w.type === 'my_tasks')?.hidden).toBe(true)
  await expect(page.getByTestId('dashboard-widget')).toHaveCount(1)
})

test('편집 — 저장 중 lg 경계를 넘어 모바일에서 새로 편집을 시작하면 늦게 끝난 데스크톱 저장이 그 편집을 닫지 않는다 (WP-162)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks', 'unread_mail']))
  // 데스크톱 저장 PUT 을 붙잡아 두었다가 모바일 편집 시작 뒤에 응답한다.
  let releasePut!: () => void
  const putHeld = new Promise<void>((resolve) => (releasePut = resolve))
  const puts = trackRequests(page, 'PUT', '/api/v1/me/dashboard')
  await page.route(
    (url) => url.pathname === '/api/v1/me/dashboard',
    async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback()
      await putHeld
      return route.fulfill({ json: route.request().postDataJSON() })
    },
  )
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByTestId('dashboard-edit-toggle').click()
  await page.getByTestId('dashboard-edit-save').click()
  await expect.poll(() => puts.requests().length).toBe(1)

  // 1023px — 모바일 셸에서 새 편집 시작(데스크톱 저장은 아직 진행 중이라 모바일 저장 버튼은 비활성).
  await resizeAndSettle(page, { width: 1023, height: 800 })
  await page.getByTestId('dashboard-edit-toggle').click()
  await expect(page.getByTestId('dashboard-edit-banner')).toBeVisible()
  await expect(page.getByTestId('dashboard-edit-save')).toBeDisabled()

  // 데스크톱 저장 완료 — 모바일 편집은 그대로 남고, 저장 버튼이 다시 살아난다.
  releasePut()
  await expect(page.getByTestId('dashboard-edit-save')).toBeEnabled()
  await expectStays(page, () => page.getByTestId('dashboard-edit-banner').isVisible(), true)
  expect(new URL(puts.requests()[0].url()).searchParams.get('device')).not.toBe('mobile')
})

// ── N4: I1/I2/B1 회귀 가드 ───────────────────────────────────────────────

test('편집(I2) — 경계 이동 후 포커스가 카드/버튼에 유지된다', { tag: '@input' }, async ({
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

// ── 위젯 추가 모달 — 선택→프리뷰→확인 플로우 ──────────────────────────────

// 모달을 열기까지의 공통 준비(편집 모드 진입 + 모달 오픈).
async function openAddWidgetModal(page: Page) {
  await page.getByTestId('dashboard-edit-toggle').click()
  await page.getByTestId('dashboard-add-widget-open').click()
}

// WP-368 — 현재 고른 카테고리 탭만 선택 표시(막대 + bg-selected), 다른 탭엔 없다. 바꾸면 따라 옮겨 간다.
test('위젯 추가 모달 — 현재 카테고리 탭만 bg-selected·selection-bar 를 갖는다 (WP-368)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks']))
  await page.goto('/')
  await openAddWidgetModal(page)

  const modal = page.getByTestId('add-widget-modal')
  const cal = modal.locator('[data-testid="add-widget-category"][data-category="캘린더"]')
  const currentTab = modal.locator('[data-testid="add-widget-category"][aria-pressed="true"]')
  await expect(currentTab).toHaveCount(1)
  // 고정 로커 — aria-pressed 로 찾은 로커는 선택이 옮겨 가면 다른 탭을 가리킨다.
  const current = modal.locator(`[data-testid="add-widget-category"][data-category="${await currentTab.getAttribute('data-category')}"]`)
  await expectSelectedRow(current, cal)
  await cal.click()
  await expect(cal).toHaveAttribute('aria-pressed', 'true')
  await expectSelectedRow(cal, current)
  await expect(modal.locator('[data-testid="add-widget-category"].bg-selected')).toHaveCount(1)
})

test('위젯 추가 모달은 좁은 뷰포트에서 프리뷰 패널이 카드 목록 아래로 스택된다', { tag: ['@layout', '@smoke'] }, async ({
  authenticatedPage: page,
}) => {
  await page.setViewportSize({ width: 640, height: 900 })
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks']))
  await page.goto('/')
  await openAddWidgetModal(page)

  const modal = page.getByTestId('add-widget-modal')
  const grid = modal.getByTestId('add-widget-grid')
  const preview = modal.getByTestId('add-widget-preview')
  // 모달이 열리며 자리 잡는 중 옛 배치를 잴 수 있어 측정+단언을 한 단위로 재시도한다 (WP-225).
  await expect(async () => {
    const gridBox = await measureBox(grid, 'add-widget-grid')
    const previewBox = await measureBox(preview, 'add-widget-preview')
    // lg 미만에서는 flex-col 이라 프리뷰의 y좌표가 카드 목록의 y좌표+높이보다 아래(세로 스택)여야 한다.
    expect(previewBox.y).toBeGreaterThanOrEqual(gridBox.y + gridBox.height - 1)
  }).toPass()
})

// ── #653: 오늘 일정 빈 상태 — 내 작업 위젯과 동일한 4단 구성 + "새 일정" CTA ──────────

test('오늘 일정 — 빈 상태 "새 일정" CTA 클릭 시 캘린더로 이동해 새 일정 다이얼로그가 자동으로 열린다', { tag: '@flow' }, async ({
  authenticatedPage: page,
}) => {
  await mockApi(page, 'GET', '/api/v1/calendar/events', [])
  await mockApi(page, 'GET', '/api/v1/me/issues', issues())
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', issues())
  await mockApi(page, 'GET', '/api/v1/notifications', notifications())
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 1 })
  await mockApi(page, 'GET', '/api/v1/messaging/channels', channels())
  await mockApi(page, 'GET', '/api/v1/messaging/dms', emptyDms)
  await mockApi(page, 'GET', '/api/v1/me/mail-summary', mail())
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['calendar_today']))
  // /calendar 진입 시 필요한 최소 API 모킹(캘린더 목록 — 이슈 마감일은 /me/issues 재사용).
  await mockApi(page, 'GET', '/api/v1/calendars', [])
  await page.goto('/')

  await page.getByTestId('dash-calendar-empty').getByRole('link', { name: /새 일정/ }).click()
  await expect(page).toHaveURL('/calendar')
  // 새 일정 다이얼로그(EventDialog)가 자동으로 열려야 한다.
  await expect(page.getByRole('dialog').getByRole('heading', { name: '새 일정' })).toBeVisible()
})

// ── #444 회귀 가드 ─────────────────────────────────────────────────────────
// 메일함에서 동기화하면 홈의 안 읽은 메일 위젯도 즉시 갱신되어야 한다.
// (useSyncMailbox.onSuccess 가 ['mail-summary'] 캐시를 무효화하지 않으면,
//  staleTime 30초 동안 위젯이 옛 카운트를 유지하던 버그 — #444.)
// 핵심: page.goto 풀 리로드는 QueryClient 캐시를 초기화해 invalidation 효과가
//       관찰되지 않으므로, 메일함↔홈 이동은 반드시 SPA 라우팅(클릭)으로 한다.
test('동기화 후 안 읽은 메일 위젯이 즉시 갱신된다 (#444)', { tag: '@flow' }, async ({
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
  // 딥링크(?messageId=100, #447) 진입 시 상세 패널이 여는 메시지 상세 스텁.
  await mockApi(page, 'GET', '/api/v1/mail/messages/100', mailDetail({ id: 100, subject: '월간 보고서' }))
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

  // 2) 위젯의 메일 행 클릭 → 해당 메일 딥링크(/mail/1?messageId=100, #447) SPA 이동. 풀 리로드 금지.
  await page.getByTestId('dash-mail').getByTestId('dash-mail-row').first().click()
  await expect(page).toHaveURL(/\/mail\/1\?messageId=100$/)

  // 3) 동기화 클릭 → sync 성공(saved:1) → ['mail-summary'] 무효화.
  await page.getByTestId('mail-sync').click()
  await expect(page.getByText('새 메일 1건을 받았습니다')).toBeVisible()

  // 4) 앱 레일 홈 링크로 SPA 복귀 — 위젯 재마운트 시 stale 캐시 재페치 → 갱신된 3건.
  await page.getByTestId('rail-link-/').click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('dash-mail')).toContainText('안읽음 3')
  await expect(page.getByTestId('dash-mail')).toContainText('긴급 공지')
})

// #447 — 위젯 메일 행 클릭 시 메일함(/mail)이 아니라 "해당 메일 상세"가 열려야 한다.
// 핵심: href 만 검증하면 라우트가 맞아도 상세가 안 열리는 경우를 놓친다 → 상세 패널 렌더까지 본다.
test('안 읽은 메일 위젯 행 클릭 → 해당 메일 상세가 열린다 (#447)', { tag: '@flow' }, async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['unread_mail']))
  // 메일함 진입 + 상세 조회 스텁.
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [mailRow()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/sync-status', {
    phase: 'IDLE',
    total: 0,
    done: 0,
    running: false,
  })
  // 위젯 행(id=100, accountId=1)이 딥링크하는 메시지의 상세.
  await mockApi(
    page,
    'GET',
    '/api/v1/mail/messages/100',
    mailDetail({ id: 100, subject: '월간 보고서', fromAddress: 'boss@example.com', fromName: '김부장' }),
  )

  await page.goto('/')

  // 1) 행 링크가 딥링크 href(/mail/{accountId}?messageId={id})를 갖는다.
  const row = page.getByTestId('dash-mail').getByTestId('dash-mail-row').first()
  await expect(row).toHaveAttribute('href', '/mail/1?messageId=100')

  // 2) 행 클릭 → 메일함 딥링크로 SPA 이동.
  await row.click()
  await expect(page).toHaveURL(/\/mail\/1\?messageId=100$/)

  // 3) 핵심 — 메일함만 뜨는 게 아니라 클릭한 메일 상세 패널이 실제로 렌더된다.
  const detail = page.getByTestId('mail-detail')
  await expect(detail).toBeVisible()
  await expect(detail).toContainText('월간 보고서') // 상세 제목(detail scope)
  await expect(detail).toContainText('boss@example.com') // 상세에만 노출되는 발신자 주소
})

// ── #474 신선도 — 메일 읽음 시 홈 요약 즉시 갱신 ──────────────────────────────
// useMailMessage 상세 조회 성공 시 ['mail-summary'] 캐시를 무효화하지 않으면
// 홈 복귀 시 회신 필요/안 읽음 KPI 가 stale 값을 유지한다.

test('메일 읽음 후 홈 회신 필요 KPI 가 즉시 갱신된다 (#474)', { tag: '@flow' }, async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  // dashboard-counts 사용을 위해 synthesis 위젯을 레이아웃에 포함해야 렌더된다(고정 레이어 제거 이후).
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['synthesis']))

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

// ── 메시징 신선도 — 읽음 후 messaging-summary 재조회 (#476) ─────────────────

test('메시징 — 채널 읽음(markRead) 후 messaging-summary 가 재조회된다 (#476)', { tag: '@flow' }, async ({
  authenticatedPage: page,
}) => {
  // messaging-summary 호출 횟수 추적.
  // 읽음 onSuccess invalidate 발동 → 홈 복귀 시 stale 재조회 포함 2회 이상이어야 한다.
  let summaryCallCount = 0
  const summaries = trackRequests(page, 'GET', '/api/v1/me/messaging-summary')
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
    (url) => url.pathname === '/api/v1/events',
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
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['synthesis']))
  // SynthesisLayer 가 필요한 공통 스텁 (auth.fixture 기본 스텁 미포함 항목).
  await mockApi(page, 'GET', '/api/v1/notifications', [])
  await mockApi(page, 'GET', '/api/v1/calendar/events', [])
  await mockApi(page, 'GET', '/api/v1/me/issues', { items: [], nextCursor: null, hasMore: false })
  await mockApi(page, 'GET', '/api/v1/me/mail-summary', { unreadCount: 0, recent: [] })

  // 1) 홈 진입 → SynthesisLayer 마운트 → messaging-summary 첫 조회.
  const firstSummaryPromise = page.waitForResponse(
    (res) => res.url().includes('/me/messaging-summary') && res.request().method() === 'GET',
    { timeout: 5000 },
  )
  await page.goto('/')
  await firstSummaryPromise
  expect(summaries.count()).toBeGreaterThanOrEqual(1)

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
  expect(summaries.count()).toBeGreaterThanOrEqual(2)
})

// ── 그리드 기하 회귀 ──────────────────────────────────────────────────────

// wide 판정 규칙은 resolvedEntry 단위 테스트(isWideEntry)가 맡고, 여기선 실제 그리드에서 전체 폭으로 그려지는지(기하) 본다.
// 클래스만 보면 그리드 열 정의가 바뀌어 col-span-3 이 전체 폭이 아니게 돼도 못 잡는다.
test('wide 위젯(synthesis)은 3열 그리드 전체 폭을 차지한다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['synthesis', 'my_tasks']))
  await page.goto('/')

  const widgets = page.getByTestId('dashboard-widget')
  const wide = widgets.filter({ has: page.getByTestId('dashboard-synthesis') })
  const narrow = widgets.filter({ has: page.getByTestId('dash-mytasks') })
  await expect(wide).toBeVisible()
  await expect(narrow).toBeVisible()
  // 위젯 카드의 부모 = 대시보드 그리드. wide 카드 폭 = 그리드 내용 폭, 일반 카드는 1열(1/3 남짓)이다.
  const gridW = await wide.evaluate((el) => {
    const grid = el.parentElement!
    const cs = getComputedStyle(grid)
    return grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
  })
  const wideW = (await wide.boundingBox())!.width
  const narrowW = (await narrow.boundingBox())!.width
  expect(Math.abs(wideW - gridW)).toBeLessThanOrEqual(1)
  expect(narrowW).toBeLessThan(gridW / 2)
})

test('데스크톱 — 요약 KPI 5칸 한 줄·안쪽 카드 테두리 유지(WP-142 반응형 회귀 가드)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  await mockWidgets(page)
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['synthesis']))
  await page.goto('/')
  const cells = page.getByTestId('dashboard-counts').locator(':scope > *')
  await expect(cells).toHaveCount(5)
  const ys = await cells.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().y))
  expect(new Set(ys).size).toBe(1)
  await expect(page.getByTestId('dashboard-synthesis')).toHaveCSS('border-top-width', '1px')
})

// WP-237: ≥1024 터치 태블릿 — 숨은(opacity 0) 「읽음」 버튼은 탭이 닿지 않는다. 행 열기(=읽음)·「모두 읽음」이 대체 경로.
test.describe('알림 위젯 — 터치 태블릿(≥1024px) 오터치 방지', { tag: '@input' }, () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true })

  test('숨은 「읽음」 자리를 탭해도 read 요청이 없고, 행을 탭하면 열리며 읽음 처리된다', async ({
    authenticatedPage: page,
  }) => {
    await mockWidgets(page)
    await mockApi(page, 'GET', '/api/v1/notifications', notifications())
    const readCapture = await mockApi(page, 'POST', '/api/v1/notifications/1/read', {}, { status: 204, capture: true })
    await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['notifications']))
    await page.goto('/')
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)

    const ack = page.getByTestId('dash-notif-ack').first()
    await expect(ack).toHaveCSS('opacity', '0')
    await expect(ack).toHaveCSS('pointer-events', 'none')
    // pointer-events:none 이라 actionability 가 막히므로 같은 좌표를 터치스크린으로 직접 탭한다.
    const ab = (await ack.boundingBox())!
    await page.touchscreen.tap(ab.x + ab.width / 2, ab.y + ab.height / 2)
    await expectStays(page, () => readCapture.requests.length, 0)

    // 행 탭(열기) — 기본 동작 그대로: 이동하면서 읽음 처리.
    const before = page.url()
    await page.getByRole('link', { name: /^알림 열기:/ }).first().tap()
    await expect(readCapture.waitForRequest()).resolves.toBeTruthy()
    await expect.poll(() => page.url()).not.toBe(before)
  })
})
