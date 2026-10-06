// 모바일 홈 대시보드(WP-142) — 기기별 레이아웃·본문형 접기·타일·모바일 편집.
// mobile 프로젝트(iPhone 13, 390px)로 돈다. /me/dashboard 는 기기별 상태를 흉내 내는 단일 route 로 모킹한다.
import type { Page, Request } from '@playwright/test'

import type { PriorityItemsResponse } from '../../../src/api/priorityItems'
import type {
  DashboardLayout,
  DashboardWidgetConfig,
  MailSummary,
  MessagingSummary,
} from '../../../src/types/dashboard'
import type { NotificationResponse } from '../../../src/types/notification'
import { createSpace } from '../../factories/drive.factory'
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'
import { bodyOf, trackRequests } from '../../fixtures/requests'
import { expectStays, resizeAndSettle } from '../../fixtures/wait'

type Device = 'mobile' | 'desktop'

/** 레이아웃 헬퍼 — 문자열은 모바일 기본 모양(count 3·펼침)으로 정규화. */
function layout(widgets: (string | DashboardWidgetConfig)[]): DashboardLayout {
  return {
    widgets: widgets.map((w) =>
      typeof w === 'string' ? { id: w, type: w, count: 3, hidden: false, collapsed: false } : w,
    ),
  }
}

interface DashboardStub {
  stored: Record<Device, DashboardLayout>
  /** /me/dashboard 로 온 모든 요청 — device 는 쿼리 원문(null = 생략). */
  requests: () => { method: string; device: string | null }[]
  puts: () => { device: string | null; widgets: DashboardWidgetConfig[] }[]
}

/**
 * /me/dashboard 를 서버처럼 기기별 상태로 흉내 낸다 — GET 은 해당 기기 저장본, PUT 은 저장 후 에코.
 * device 생략은 서버와 같이 desktop. holdFirstPut 이 있으면 첫 PUT 응답을 그 Promise 가 풀릴 때까지 붙잡는다(직렬화 검증용).
 * failFirstPut 이면 첫 PUT 만 500(저장하지 않음), 이후 PUT 은 정상 저장.
 */
async function stubDashboard(
  page: Page,
  initial: Partial<Record<Device, DashboardLayout>>,
  opts: { putStatus?: number; holdFirstPut?: Promise<void>; failFirstPut?: boolean } = {},
): Promise<DashboardStub> {
  const tracked = trackRequests(page, 'ANY', '/api/v1/me/dashboard')
  const deviceOf = (req: Request) => new URL(req.url()).searchParams.get('device')
  const stub: DashboardStub = {
    stored: { mobile: initial.mobile ?? { widgets: [] }, desktop: initial.desktop ?? { widgets: [] } },
    requests: () => tracked.requests().map((req) => ({ method: req.method(), device: deviceOf(req) })),
    puts: () => tracked.requests()
      .filter((req) => req.method() === 'PUT')
      .map((req) => ({ device: deviceOf(req), widgets: (bodyOf(req) as DashboardLayout).widgets })),
  }
  // 첫 PUT 보류·실패 판정용(응답 결정) — 단언은 stub.puts() 로 한다.
  let putCount = 0
  await page.route(
    (url) => url.pathname === '/api/v1/me/dashboard',
    async (route) => {
      const req = route.request()
      const device: Device = deviceOf(req) === 'mobile' ? 'mobile' : 'desktop'
      if (req.method() === 'GET') return route.fulfill({ json: stub.stored[device] })
      if (req.method() !== 'PUT') return route.fallback()
      const body = req.postDataJSON() as DashboardLayout
      putCount += 1
      if (putCount === 1 && opts.holdFirstPut) await opts.holdFirstPut
      if (opts.putStatus && opts.putStatus >= 400) return route.fulfill({ status: opts.putStatus, json: {} })
      if (opts.failFirstPut && putCount === 1) return route.fulfill({ status: 500, json: {} })
      stub.stored[device] = body
      return route.fulfill({ json: body })
    },
  )
  return stub
}

/** 위젯 본문·요약이 쓰는 최소 데이터 — 내 작업 1건 + 빈 메일·대화 요약. */
async function stubWidgetData(page: Page, opts: { taskTitle?: string } = {}) {
  const issue = createIssue({
    id: 7,
    projectKey: 'WP',
    number: 7,
    title: opts.taskTitle ?? '로그인 버그 재현',
    status: 'IN_PROGRESS',
  })
  await mockApi(page, 'GET', '/api/v1/me/issues', createIssueSearchResponse([issue]))
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
}

test('홈 조회는 device=mobile 로 나가고 데스크톱 레이아웃 요청은 없다', { tag: '@smoke' }, async ({
  authenticatedPage: page,
}) => {
  await stubWidgetData(page)
  const stub = await stubDashboard(page, { mobile: layout(['my_tasks']), desktop: layout(['unread_mail']) })
  await page.goto('/')
  await expect(page.locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')).toBeVisible()
  // 모바일 저장본(my_tasks)만 그려지고 데스크톱 저장본(unread_mail)은 섞이지 않는다.
  await expect(page.locator('[data-testid="dashboard-widget"][data-widget="unread_mail"]')).toHaveCount(0)
  expect(stub.requests().filter((r) => r.method === 'GET').every((r) => r.device === 'mobile')).toBe(true)
})

test('편집 중 lg 경계를 넘으면 미저장 초안은 어느 기기에도 저장되지 않고 편집이 끝난다', async ({
  authenticatedPage: page,
}) => {
  await stubWidgetData(page)
  const stub = await stubDashboard(page, {
    mobile: layout(['my_tasks', 'unread_mail']),
    desktop: layout(['unread_mail']),
  })
  await page.goto('/')
  await page.getByTestId('dashboard-edit-toggle').click()
  await expect(page.getByTestId('dashboard-edit-banner')).toBeVisible()
  // 모바일 초안: my_tasks 숨김(미저장).
  const myTasks = page.locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')
  await myTasks.getByTestId('widget-hide-toggle').click()
  await expect(myTasks).toHaveAttribute('data-hidden', 'true')

  // 데스크톱 폭 — AppLayout 이 셸을 갈아 끼우며 Dashboard 가 다시 마운트된다(편집 상태 초기화).
  // 모바일 초안은 데스크톱 화면·데스크톱 레이아웃 어디에도 섞이지 않고, 데스크톱 레이아웃을 device 없이 새로 조회한다.
  // 1024 경계를 넘는 리사이즈 — 셸 교체가 끝난 뒤에 단언한다(WP-225).
  await resizeAndSettle(page, { width: 1280, height: 800 })
  await expect(page.getByTestId('dashboard-edit-banner')).toHaveCount(0)
  await expect.poll(() => stub.requests().some((r) => r.method === 'GET' && r.device === null)).toBe(true)
  await expect(page.locator('[data-testid="dashboard-widget"][data-widget="unread_mail"]')).toBeVisible()
  await expect(page.locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')).toHaveCount(0)

  // 다시 모바일 폭 — 편집은 끝난 상태(보기 모드)이고 저장된 모바일 레이아웃 그대로다. 그동안 PUT 은 0건.
  await resizeAndSettle(page, { width: 390, height: 664 })
  await expect(page.getByTestId('dashboard-edit-banner')).toHaveCount(0)
  await expect(myTasks).toBeVisible()
  expect(stub.puts()).toHaveLength(0)
})

test('본문형 ⌃ 접기 → device=mobile PUT 에 collapsed:true, 요약 한 줄 표시, 새로고침 후 유지', async ({
  authenticatedPage: page,
}) => {
  await stubWidgetData(page)
  const stub = await stubDashboard(page, { mobile: layout(['my_tasks']) })
  await page.goto('/')
  const card = page.locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')
  await expect(card.getByTestId('dash-mytasks')).toBeVisible()
  const toggle = card.getByTestId('mobile-widget-collapse')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(toggle).toHaveAttribute('aria-label', '내 작업 접기')
  // 44px 터치 대상.
  const box = await toggle.boundingBox()
  expect(box!.width).toBeGreaterThanOrEqual(44)
  expect(box!.height).toBeGreaterThanOrEqual(44)

  await toggle.click()
  await expect.poll(() => stub.puts().length).toBe(1)
  expect(stub.puts()[0].device).toBe('mobile')
  expect(stub.puts()[0].widgets.find((w) => w.id === 'my_tasks')?.collapsed).toBe(true)
  // 접힘: 본문 대신 머리 건수 배지 + 요약 한 줄(가장 급한 1건).
  await expect(card.getByTestId('dash-mytasks')).toHaveCount(0)
  await expect(card.getByTestId('mobile-widget-count')).toHaveText('1')
  await expect(card.getByTestId('mobile-widget-summary-text')).toHaveText('로그인 버그 재현')
  await expect(card.getByTestId('mobile-widget-collapse')).toHaveAttribute('aria-label', '내 작업 펼치기')

  await page.reload()
  await expect(card.getByTestId('mobile-widget-collapse')).toHaveAttribute('aria-expanded', 'false')
  await expect(card.getByTestId('mobile-widget-summary-text')).toHaveText('로그인 버그 재현')
  await expectNoHorizontalOverflow(page)
})

test('⌃ 연타 — PUT 이 직렬로 나가 마지막 상태(펼침)가 저장된다', async ({ authenticatedPage: page }) => {
  await stubWidgetData(page)
  let release!: () => void
  const hold = new Promise<void>((r) => (release = r))
  const stub = await stubDashboard(page, { mobile: layout(['my_tasks']) }, { holdFirstPut: hold })
  await page.goto('/')
  const card = page.locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')
  await card.getByTestId('mobile-widget-collapse').click() // 접기 — 첫 PUT 은 응답이 붙잡힌다
  await expect(card.getByTestId('mobile-widget-collapse')).toHaveAttribute('aria-expanded', 'false')
  await card.getByTestId('mobile-widget-collapse').click() // 펼치기 — 화면은 즉시(낙관), PUT 은 앞 PUT 뒤로 줄 선다
  await expect(card.getByTestId('mobile-widget-collapse')).toHaveAttribute('aria-expanded', 'true')
  // 첫 응답 전 두 번째 PUT 이 나가지 않음 — 직렬화 검증
  await expectStays(page, () => stub.puts().length, 1, { reach: true })
  release()
  await expect.poll(() => stub.puts().length).toBe(2)
  expect(stub.puts()[0].widgets[0].collapsed).toBe(true)
  expect(stub.puts()[1].widgets[0].collapsed).toBe(false)
  // 마지막 토글 완료 후 재조회해도 펼침 — 늦게 온 첫 응답이 최종 상태를 덮어쓰지 않는다.
  await expect(card.getByTestId('mobile-widget-collapse')).toHaveAttribute('aria-expanded', 'true')
  await expect(card.getByTestId('dash-mytasks')).toBeVisible()
  // 서버에 최종 저장된 값도 화면과 같은 펼침이다.
  await expect.poll(() => stub.stored.mobile.widgets[0].collapsed).toBe(false)
})

test('첫 접기 저장이 실패해도 그 사이 다시 누른 마지막 상태가 화면·서버에 남는다', async ({
  authenticatedPage: page,
}) => {
  await stubWidgetData(page)
  let release!: () => void
  const hold = new Promise<void>((r) => (release = r))
  const stub = await stubDashboard(page, { mobile: layout(['my_tasks']) }, { holdFirstPut: hold, failFirstPut: true })
  await page.goto('/')
  const card = page.locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')
  const toggle = card.getByTestId('mobile-widget-collapse')
  await toggle.click() // 접기 — 첫 PUT 은 붙잡혔다가 500
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click() // 펼치기(대기열)
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await toggle.click() // 다시 접기(대기열) — 사용자의 마지막 의도
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  release()
  await expect(page.getByText('위젯 접기 상태를 저장하지 못했습니다')).toBeVisible()
  await expect.poll(() => stub.puts().length).toBe(3)
  // 앞선 실패의 롤백이 뒤에 누른 상태를 덮어쓰지 않는다 — 뒤 PUT 들은 마지막 탭(접힘)을 보낸다.
  expect(stub.puts()[1].widgets[0].collapsed).toBe(true)
  expect(stub.puts()[2].widgets[0].collapsed).toBe(true)
  await expect.poll(() => stub.stored.mobile.widgets[0].collapsed).toBe(true)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(card.getByTestId('mobile-widget-summary-text')).toHaveText('로그인 버그 재현')
})

test('접기 저장 실패 → 펼침으로 롤백 + 오류 토스트', async ({ authenticatedPage: page }) => {
  await stubWidgetData(page)
  await stubDashboard(page, { mobile: layout(['my_tasks']) }, { putStatus: 500 })
  await page.goto('/')
  const card = page.locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')
  await card.getByTestId('mobile-widget-collapse').click()
  await expect(page.getByText('위젯 접기 상태를 저장하지 못했습니다')).toBeVisible()
  await expect(card.getByTestId('mobile-widget-collapse')).toHaveAttribute('aria-expanded', 'true')
  await expect(card.getByTestId('dash-mytasks')).toBeVisible()
})

test('타일 탭 → 앱 경로로 이동(드라이브), AI 우선순위 타일은 최상위 항목으로', async ({
  authenticatedPage: page,
}) => {
  await stubWidgetData(page)
  await mockApi(page, 'GET', '/api/v1/drive/spaces', [createSpace({ id: 1, name: '디자인팀 공유 자료' })])
  const priority: PriorityItemsResponse = {
    items: [
      { sourceType: 'ISSUE_DUE', sourceId: '7', title: '결제 모듈 환불 API 타임아웃', deepLink: '/projects/WP/issues/7', importanceScore: 90, urgencyScore: 80, reason: '마감 임박' },
      { sourceType: 'MENTION', sourceId: '3', title: '시안 리뷰 요청', deepLink: '/me/tasks/assigned', importanceScore: 20, urgencyScore: 10, reason: '' },
    ],
  } as PriorityItemsResponse
  await mockApi(page, 'GET', '/api/v1/me/priority-items', priority)
  await stubDashboard(page, {
    mobile: layout([
      { id: 'drv-1', type: 'drive', count: 0, hidden: false, params: {}, label: null },
      { id: 'priority_quadrant', type: 'priority_quadrant', count: 3, hidden: false },
    ]),
  })
  await page.goto('/')
  const drive = page.locator('[data-testid="dashboard-widget"][data-widget="drive"]')
  await expect(drive).toHaveAttribute('data-mobile-kind', 'tile')
  await expect(drive.getByTestId('mobile-widget-summary-text')).toHaveText('디자인팀 공유 자료')
  // 타일에는 접기 버튼이 없다.
  await expect(drive.getByTestId('mobile-widget-collapse')).toHaveCount(0)
  const prio = page.locator('[data-testid="dashboard-widget"][data-widget="priority_quadrant"]')
  await expect(prio.getByTestId('mobile-widget-count')).toHaveText('2')
  await expect(prio.getByTestId('mobile-widget-summary')).toContainText('긴급·중요')
  await drive.click()
  await expect(page).toHaveURL(/\/drive$/)
  await page.goBack()
  await prio.click()
  await expect(page).toHaveURL(/\/projects\/WP\/issues\/7$/)
})

test('긴 제목 — 접힌 요약 한 줄이 말줄임되고 가로 넘침이 없다', async ({ authenticatedPage: page }) => {
  const longTitle = '결제 모듈 환불 API 타임아웃 재현 및 원인 분석 — '.repeat(6)
  await stubWidgetData(page, { taskTitle: longTitle })
  await stubDashboard(page, {
    mobile: layout([{ id: 'my_tasks', type: 'my_tasks', count: 3, hidden: false, collapsed: true }]),
  })
  await page.goto('/')
  const text = page.locator('[data-widget="my_tasks"]').getByTestId('mobile-widget-summary-text')
  await expect(text).toBeVisible()
  const truncated = await text.evaluate((el) => el.scrollWidth > el.clientWidth)
  expect(truncated).toBe(true)
  await expectNoHorizontalOverflow(page)
})

test('모바일 편집 — 컨트롤은 핸들·숨김·설정·삭제만, 저장은 device=mobile PUT 만', async ({
  authenticatedPage: page,
}) => {
  await stubWidgetData(page)
  const stub = await stubDashboard(page, {
    mobile: layout([
      'my_tasks',
      { id: 'il-1', type: 'issue_list', count: 0, hidden: false, params: { assignee: 'me' }, label: null },
    ]),
  })
  await page.goto('/')
  await page.getByTestId('dashboard-edit-toggle').click()
  const myTasks = page.locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')
  const issueList = page.locator('[data-testid="dashboard-widget"][data-widget-id="il-1"]')
  // ↑↓·테두리 없음은 모바일에서 노출하지 않는다. 편집 중엔 ⌃ 도 숨긴다.
  await expect(page.getByTestId('widget-move-up')).toHaveCount(0)
  await expect(page.getByTestId('widget-move-down')).toHaveCount(0)
  await expect(page.getByTestId('widget-chromeless-toggle')).toHaveCount(0)
  await expect(page.getByTestId('mobile-widget-collapse')).toHaveCount(0)
  await expect(myTasks.getByTestId('widget-drag-handle')).toBeVisible()
  await expect(myTasks.getByTestId('widget-remove')).toBeVisible()
  await expect(myTasks.getByTestId('widget-settings')).toHaveCount(0) // 설정은 필드가 있는 카탈로그 위젯만
  await expect(issueList.getByTestId('widget-settings')).toBeVisible()
  // 편집 중 타일은 링크가 아니다(드래그 중 이동 방지).
  await expect(issueList.locator('a[href]')).toHaveCount(0)
  const hide = myTasks.getByTestId('widget-hide-toggle')
  const box = await hide.boundingBox()
  expect(box!.width).toBeGreaterThanOrEqual(44)
  // 항목 수(3/5/10) 버튼도 모바일 편집에서는 44px 터치 대상.
  for (const n of [3, 5, 10]) {
    const countBox = await myTasks.getByTestId('widget-count-select').getByRole('button', { name: `${n}개` }).boundingBox()
    expect(countBox!.width).toBeGreaterThanOrEqual(44)
    expect(countBox!.height).toBeGreaterThanOrEqual(44)
  }
  await expectNoHorizontalOverflow(page)

  await hide.click()
  await page.getByTestId('dashboard-edit-save').click()
  await expect(page.getByTestId('dashboard-edit-banner')).toHaveCount(0)
  expect(stub.puts()).toHaveLength(1)
  expect(stub.puts()[0].device).toBe('mobile')
  expect(stub.puts()[0].widgets.find((w) => w.id === 'my_tasks')?.hidden).toBe(true)
  // 데스크톱(device 생략) 요청은 한 번도 없다.
  expect(stub.requests().every((r) => r.device === 'mobile')).toBe(true)
})

test('모바일 편집 — 오른쪽 드래그 핸들로 순서를 바꾸면 device=mobile PUT 에 새 순서가 저장된다', async ({
  authenticatedPage: page,
}) => {
  await stubWidgetData(page)
  // 접힌 카드 두 개 — 카드가 낮아 375px 화면 안에서 드래그 대상이 모두 보인다.
  const stub = await stubDashboard(page, {
    mobile: layout([
      { id: 'my_tasks', type: 'my_tasks', count: 3, hidden: false, collapsed: true },
      { id: 'unread_mail', type: 'unread_mail', count: 3, hidden: false, collapsed: true },
    ]),
  })
  await page.goto('/')
  await page.getByTestId('dashboard-edit-toggle').click()
  const myTasks = page.locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')
  const mail = page.locator('[data-testid="dashboard-widget"][data-widget="unread_mail"]')
  const target = await mail.boundingBox()
  if (!target) throw new Error('unread_mail 카드 bounding box 없음')
  // 데스크톱 드래그 테스트와 같은 dnd-kit PointerSensor(distance 8) 활성화 순서.
  await myTasks.getByTestId('widget-drag-handle').hover()
  await page.mouse.down()
  await page.mouse.move(0, 0)
  await page.mouse.move(target.x + target.width / 2, target.y + target.height * 0.75, { steps: 12 })
  await page.mouse.up()
  const cards = page.getByTestId('dashboard-widget')
  await expect(cards.nth(0)).toHaveAttribute('data-widget', 'unread_mail')
  await expect(cards.nth(1)).toHaveAttribute('data-widget', 'my_tasks')

  // dnd-kit 이 드래그 직후 50ms 동안 클릭을 삼킨다 — 데스크톱 테스트와 같이 목표 상태(배너 소멸)까지 클릭 재시도.
  const saveButton = page.getByTestId('dashboard-edit-save')
  const banner = page.getByTestId('dashboard-edit-banner')
  await expect(async () => {
    if ((await saveButton.count()) > 0) await saveButton.click({ timeout: 200 }).catch(() => {})
    await expect(banner).toHaveCount(0, { timeout: 200 })
  }).toPass({ timeout: 3000 })
  expect(stub.puts()).toHaveLength(1)
  expect(stub.puts()[0].device).toBe('mobile')
  expect(stub.puts()[0].widgets.map((w) => w.id)).toEqual(['unread_mail', 'my_tasks'])
  // 접힘 상태는 순서 변경과 함께 보존된다.
  expect(stub.puts()[0].widgets.every((w) => w.collapsed === true)).toBe(true)
})

test('collapsed 필드 없는 저장본은 펼침으로, 미등록 위젯은 건너뛰고 렌더된다', async ({
  authenticatedPage: page,
}) => {
  await stubWidgetData(page)
  await stubDashboard(page, {
    mobile: {
      widgets: [
        { id: 'unknown_x', type: 'unknown_x', count: 3, hidden: false },
        { id: 'my_tasks', type: 'my_tasks', count: 3, hidden: false },
      ],
    },
  })
  await page.goto('/')
  await expect(page.getByTestId('dashboard-widget')).toHaveCount(1)
  const card = page.locator('[data-widget="my_tasks"]')
  await expect(card).toHaveAttribute('data-collapsed', 'false')
  await expect(card.getByTestId('dash-mytasks')).toBeVisible()
})

test('요약 — KPI 3열(3+2)·라벨 한 줄, 안쪽 카드 테두리 없음, 가로 넘침 없음', async ({
  authenticatedPage: page,
}) => {
  await stubWidgetData(page)
  await stubDashboard(page, { mobile: layout(['synthesis']) })
  await page.goto('/')
  const cells = page.getByTestId('dashboard-counts').locator(':scope > *')
  await expect(cells).toHaveCount(5)
  await expect(cells.first()).toBeVisible()
  const boxes = await cells.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect))
  // 첫 줄 3칸·둘째 줄 2칸.
  expect(boxes[1].y).toBe(boxes[0].y)
  expect(boxes[2].y).toBe(boxes[0].y)
  expect(boxes[3].y).toBeGreaterThan(boxes[0].y)
  // 라벨이 두 줄로 꺾이면 셀이 ~80px 로 커진다 — 한 줄이면 64px 안팎.
  for (const b of boxes) expect(b.height).toBeLessThan(70)
  // 이중 카드 해소 — 안쪽 Card 의 테두리가 모바일에선 없다.
  await expect(page.getByTestId('dashboard-synthesis')).toHaveCSS('border-top-width', '0px')
  await expectNoHorizontalOverflow(page)
})

test('빠른 액션 — 모바일은 버튼 2열 격자', async ({ authenticatedPage: page }) => {
  await stubWidgetData(page)
  await stubDashboard(page, { mobile: layout(['quick_actions']) })
  await page.goto('/')
  const links = page.getByTestId('dashboard-quickactions').getByRole('link')
  await expect(links).toHaveCount(3)
  const boxes = await links.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect))
  expect(boxes[1].y).toBe(boxes[0].y)
  expect(boxes[2].y).toBeGreaterThan(boxes[0].y)
  expect(Math.abs(boxes[0].width - boxes[1].width)).toBeLessThan(2)
  await expectNoHorizontalOverflow(page)
})

test('모바일 위젯 추가 — 타일형에는 안내가 붙고, 추가는 모바일 레이아웃(count 3)에만 저장된다', async ({
  authenticatedPage: page,
}) => {
  await stubWidgetData(page)
  const stub = await stubDashboard(page, { mobile: layout(['my_tasks']) })
  await page.goto('/')
  await page.getByTestId('dashboard-edit-toggle').click()
  await page.getByTestId('dashboard-add-widget-open').click()
  const modal = page.getByTestId('add-widget-modal')
  const card = (type: string) => modal.locator(`[data-testid="add-widget-card"][data-widget-type="${type}"]`)
  await expect(card('drive').getByTestId('add-widget-mobile-tile-note')).toHaveText('모바일에서는 한 줄 타일로 표시')
  await expect(card('priority_quadrant').getByTestId('add-widget-mobile-tile-note')).toBeVisible()
  await expect(card('calendar_today').getByTestId('add-widget-mobile-tile-note')).toHaveCount(0)
  await card('calendar_today').click()
  await modal.getByTestId('add-widget-confirm').click()
  await page.getByTestId('dashboard-edit-save').click()
  await expect.poll(() => stub.puts().length).toBe(1)
  expect(stub.puts()[0].device).toBe('mobile')
  expect(stub.puts()[0].widgets.find((w) => w.type === 'calendar_today')?.count).toBe(3)
})

test('접기 저장이 진행 중인 동안 편집 진입이 막혀 접기 PUT 이 편집 저장을 덮어쓰지 않는다', async ({
  authenticatedPage: page,
}) => {
  await stubWidgetData(page)
  let release!: () => void
  const hold = new Promise<void>((r) => (release = r))
  const stub = await stubDashboard(page, { mobile: layout(['my_tasks']) }, { holdFirstPut: hold })
  await page.goto('/')
  const editToggle = page.getByTestId('dashboard-edit-toggle')
  await expect(editToggle).toBeEnabled()
  await page.locator('[data-widget="my_tasks"]').getByTestId('mobile-widget-collapse').click()
  // 접기 PUT 이 붙잡혀 있는 동안 편집 진입 불가.
  await expect(editToggle).toBeDisabled()
  release()
  await expect.poll(() => stub.puts().length).toBe(1)
  await expect(editToggle).toBeEnabled()
})

test('키보드로 ⌃/⌄ 를 눌러도 버튼 포커스가 유지되고 aria-expanded 가 바뀐다', async ({
  authenticatedPage: page,
}) => {
  await stubWidgetData(page)
  await stubDashboard(page, { mobile: layout(['my_tasks']) })
  await page.goto('/')
  const card = page.locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')
  const toggle = card.getByTestId('mobile-widget-collapse')
  await expect(card.getByTestId('dash-mytasks')).toBeVisible()
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(toggle).toBeFocused()
  await expect(card.getByTestId('dash-mytasks')).toBeVisible()
})

test('알림 배지는 첫 페이지가 아닌 전체 안 읽음 수(unread-count)를 보인다', async ({
  authenticatedPage: page,
}) => {
  await stubWidgetData(page)
  const notif: NotificationResponse = {
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
  }
  await mockApi(page, 'GET', '/api/v1/notifications', [notif])
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 37 })
  await stubDashboard(page, {
    mobile: layout([{ id: 'notifications', type: 'notifications', count: 3, hidden: false, collapsed: true }]),
  })
  await page.goto('/')
  await expect(page.locator('[data-widget="notifications"]').getByTestId('mobile-widget-count')).toHaveText('37')
})

test('이슈 목록 타일 — 다음 페이지가 있으면 건수 배지에 + 를 붙인다', async ({ authenticatedPage: page }) => {
  await stubWidgetData(page)
  const items = [1, 2].map((n) => createIssue({ id: n, projectKey: 'WP', number: n, title: `이슈 ${n}` }))
  await mockApi(page, 'GET', '/api/v1/me/issues', createIssueSearchResponse(items, 'next-cursor'))
  await stubDashboard(page, {
    mobile: layout([
      { id: 'il-1', type: 'issue_list', count: 0, hidden: false, params: { assignee: 'me' }, label: null },
    ]),
  })
  await page.goto('/')
  await expect(page.locator('[data-widget-id="il-1"]').getByTestId('mobile-widget-count')).toHaveText('2+')
})

// WP-258 — 같은 이슈 멘션은 모바일 요약 위젯에서도 한 줄 + 건수로 묶이고, 긴 제목이 건수·시각을 밀어내지 않는다.
test('요약 — 같은 이슈 멘션 여러 건은 한 줄(멘션 N · 시각), 긴 제목은 말줄임·가로 넘침 없음', async ({
  authenticatedPage: page,
}) => {
  const LONG = '결제 모듈 리팩터링 후 정산 배치가 이중 집계되는 문제 조사 및 재발 방지 대책 수립'
  const notif = (id: number, issueNumber: number, issueTitle: string, createdAt: string): NotificationResponse => ({
    id, type: 'COMMENTED', actorId: 3, actorName: '홍길동', actorKind: 'HUMAN', issueId: issueNumber, projectKey: 'WP',
    issueNumber, issueTitle, commentId: id, eventId: null, eventTitle: null, eventStartsAt: null, read: false, createdAt,
  })
  await stubWidgetData(page)
  await mockApi(page, 'GET', '/api/v1/notifications', [
    notif(1, 7, LONG, '2026-06-16T01:00:00Z'),
    notif(2, 7, LONG, '2026-06-16T02:00:00Z'),
    notif(3, 8, '배포 체크리스트 정리', '2026-06-16T00:00:00Z'),
  ] satisfies NotificationResponse[])
  await stubDashboard(page, { mobile: layout(['synthesis']) })
  await page.goto('/')

  const attention = page.getByTestId('dashboard-attention')
  await expect(attention.getByRole('link')).toHaveCount(2)
  const focus = page.getByTestId('dashboard-attention-focus')
  await expect(focus).toContainText(/멘션 2 · /)
  // 건수·시각 메타가 화면(포커스 카드) 오른쪽 안에 남는다 — 긴 제목은 말줄임.
  const meta = focus.locator('span', { hasText: /^멘션 2 · / })
  const metaBox = (await meta.boundingBox())!
  const focusBox = (await focus.boundingBox())!
  expect(metaBox.x + metaBox.width).toBeLessThanOrEqual(focusBox.x + focusBox.width)
  await expectNoHorizontalOverflow(page)
})
