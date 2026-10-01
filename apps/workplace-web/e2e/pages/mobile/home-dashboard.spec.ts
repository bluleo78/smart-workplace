// 모바일 홈 대시보드(WP-142) — 기기별 레이아웃·본문형 접기·타일·모바일 편집.
// mobile 프로젝트(iPhone 13, 390px)로 돈다. /me/dashboard 는 기기별 상태를 흉내 내는 단일 route 로 모킹한다.
import type { Page } from '@playwright/test'

import type {
  DashboardLayout,
  DashboardWidgetConfig,
  MailSummary,
  MessagingSummary,
} from '../../../src/types/dashboard'
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/mobile.fixture'

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
  requests: { method: string; device: string | null }[]
  puts: { device: string | null; widgets: DashboardWidgetConfig[] }[]
}

/**
 * /me/dashboard 를 서버처럼 기기별 상태로 흉내 낸다 — GET 은 해당 기기 저장본, PUT 은 저장 후 에코.
 * device 생략은 서버와 같이 desktop. holdFirstPut 이 있으면 첫 PUT 응답을 그 Promise 가 풀릴 때까지 붙잡는다(직렬화 검증용).
 */
async function stubDashboard(
  page: Page,
  initial: Partial<Record<Device, DashboardLayout>>,
  opts: { putStatus?: number; holdFirstPut?: Promise<void> } = {},
): Promise<DashboardStub> {
  const stub: DashboardStub = {
    stored: { mobile: initial.mobile ?? { widgets: [] }, desktop: initial.desktop ?? { widgets: [] } },
    requests: [],
    puts: [],
  }
  await page.route(
    (url) => url.pathname === '/api/v1/me/dashboard',
    async (route) => {
      const req = route.request()
      const deviceParam = new URL(req.url()).searchParams.get('device')
      const device: Device = deviceParam === 'mobile' ? 'mobile' : 'desktop'
      stub.requests.push({ method: req.method(), device: deviceParam })
      if (req.method() === 'GET') return route.fulfill({ json: stub.stored[device] })
      if (req.method() !== 'PUT') return route.fallback()
      const body = req.postDataJSON() as DashboardLayout
      stub.puts.push({ device: deviceParam, widgets: body.widgets })
      if (stub.puts.length === 1 && opts.holdFirstPut) await opts.holdFirstPut
      if (opts.putStatus && opts.putStatus >= 400) return route.fulfill({ status: opts.putStatus, json: {} })
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
  expect(stub.requests.filter((r) => r.method === 'GET').every((r) => r.device === 'mobile')).toBe(true)
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
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.getByTestId('dashboard-edit-banner')).toHaveCount(0)
  await expect.poll(() => stub.requests.some((r) => r.method === 'GET' && r.device === null)).toBe(true)
  await expect(page.locator('[data-testid="dashboard-widget"][data-widget="unread_mail"]')).toBeVisible()
  await expect(page.locator('[data-testid="dashboard-widget"][data-widget="my_tasks"]')).toHaveCount(0)

  // 다시 모바일 폭 — 편집은 끝난 상태(보기 모드)이고 저장된 모바일 레이아웃 그대로다. 그동안 PUT 은 0건.
  await page.setViewportSize({ width: 390, height: 664 })
  await expect(page.getByTestId('dashboard-edit-banner')).toHaveCount(0)
  await expect(myTasks).toBeVisible()
  expect(stub.puts).toHaveLength(0)
})
