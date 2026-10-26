// 모바일 홈 대시보드(WP-142) — 페이지 테스트(WP-981).
// 접기 저장의 직렬화·실패 롤백·실패 뒤 마지막 의도 보존, 접기 저장 중 편집 진입 막기, 타일 탭 이동, 저장본 정규화(collapsed 없음·미등록 위젯),
// 위젯 추가 안내·count 3 저장, 배지 건수(전체 안 읽음·다음 페이지 +), 타일 요약 축소 조회는 요청·조건부 렌더라
// e2e/pages/mobile/home-dashboard.spec.ts 에서 옮겼다. 터치 대상 크기·말줄임·격자·드래그·키보드 포커스·lg 경계 리사이즈는 그 E2E 가 지킨다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import type { PriorityItemsResponse } from '@/api/priorityItems'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'
import type { DashboardLayout, DashboardWidgetConfig, MailSummary } from '@/types/dashboard'
import type { NotificationResponse } from '@/types/notification'

import { member, page as contactPage } from '../../../e2e/factories/contacts.factory'
import { createSpace } from '../../../e2e/factories/drive.factory'
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { mailAccount, summary as mailRow } from '../../../e2e/factories/mail.factory'
import { createProject } from '../../../e2e/factories/project.factory'

mockViewport()
// jsdom 에는 요소 scrollTo 가 없다 — 탭 전환 때 목록을 맨 위로 올리는 호출(스크롤 위치는 E2E @layout 이 본다).
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {}

/** 레이아웃 헬퍼 — 문자열은 모바일 기본 모양(count 3·펼침)으로 정규화. */
function layout(widgets: (string | DashboardWidgetConfig)[]): DashboardLayout {
  return {
    widgets: widgets.map((w) => (typeof w === 'string' ? { id: w, type: w, count: 3, hidden: false, collapsed: false } : w)),
  }
}

type Put = { device: string | null; widgets: DashboardWidgetConfig[] }

/**
 * /me/dashboard 를 서버처럼 흉내 낸다 — GET 은 저장본, PUT 은 저장 후 에코. PUT 은 puts 에 모은다.
 * hold 가 있으면 첫 PUT 응답을 그 Promise 가 풀릴 때까지 붙잡는다(직렬화 검증). failFirst 면 첫 PUT 만 500, putStatus 면 늘 그 상태.
 */
function dashboard(initial: DashboardLayout, opts: { hold?: Promise<void>; failFirst?: boolean; putStatus?: number } = {}) {
  const state = { stored: initial, puts: [] as Put[], devices: [] as (string | null)[] }
  const handler = [
    http.get('/api/v1/me/dashboard', ({ request }) => {
      state.devices.push(new URL(request.url).searchParams.get('device'))
      return HttpResponse.json(state.stored)
    }),
    http.put('/api/v1/me/dashboard', async ({ request }) => {
      const body = (await request.json()) as DashboardLayout
      state.puts.push({ device: new URL(request.url).searchParams.get('device'), widgets: body.widgets })
      const n = state.puts.length
      if (n === 1 && opts.hold) await opts.hold
      if (opts.putStatus) return HttpResponse.json({}, { status: opts.putStatus })
      if (opts.failFirst && n === 1) return HttpResponse.json({}, { status: 500 })
      state.stored = body
      return HttpResponse.json(body)
    }),
  ]
  return { state, handler }
}

/** 위젯 본문·요약 최소 데이터 — 내 작업 1건 + 메일 요약(분류 꺼짐). */
function widgetData(items = [createIssue({ id: 7, projectKey: 'WP', number: 7, title: '로그인 버그 재현', status: 'IN_PROGRESS' })], next: string | null = null) {
  const mail: MailSummary = { unreadCount: 2, needsReplyCount: 0, classificationActive: false, recent: [] }
  return [
    http.get('/api/v1/me/issues', () => HttpResponse.json(createIssueSearchResponse(items, next))),
    http.get('/api/v1/me/mail-summary', () => HttpResponse.json(mail)),
  ]
}

const widget = (type: string) => document.querySelector<HTMLElement>(`[data-testid="dashboard-widget"][data-widget="${type}"]`)
const widgetById = (id: string) => document.querySelector<HTMLElement>(`[data-testid="dashboard-widget"][data-widget-id="${id}"]`)

/** 홈을 띄우고 첫 위젯이 그려질 때까지 기다린다. */
async function openHome(handlers: NonNullable<Parameters<typeof renderPage>[1]>['handlers']) {
  const view = renderPage('/', { handlers })
  await screen.findAllByTestId('dashboard-widget', {}, { timeout: PAGE_LOAD_TIMEOUT })
  return view
}

test('⌃ 연타 — 첫 PUT 응답 전엔 둘째 PUT 이 나가지 않고(직렬), 마지막 상태(펼침)가 화면·서버에 남는다', async () => {
  let release!: () => void
  const hold = new Promise<void>((r) => (release = r))
  const dash = dashboard(layout(['my_tasks']), { hold })
  const { user } = await openHome([...widgetData(), ...dash.handler])
  const toggle = () => within(widget('my_tasks')!).getByTestId('mobile-widget-collapse')
  await user.click(toggle())
  await waitFor(() => expect(toggle()).toHaveAttribute('aria-expanded', 'false'))
  await user.click(toggle())
  // 화면은 즉시(낙관) 펼침, PUT 은 앞 PUT 뒤로 줄 선다.
  expect(toggle()).toHaveAttribute('aria-expanded', 'true')
  await new Promise((r) => setTimeout(r, 200))
  expect(dash.state.puts).toHaveLength(1)
  release()
  await waitFor(() => expect(dash.state.puts).toHaveLength(2))
  expect(dash.state.puts.map((p) => p.widgets[0].collapsed)).toEqual([true, false])
  // 늦게 온 첫 응답이 최종 상태를 덮어쓰지 않는다.
  await waitFor(() => expect(dash.state.stored.widgets[0].collapsed).toBe(false))
  expect(toggle()).toHaveAttribute('aria-expanded', 'true')
  expect(within(widget('my_tasks')!).getByTestId('dash-mytasks')).toBeInTheDocument()
})

test('첫 접기 저장이 실패해도 그 사이 다시 누른 마지막 상태(접힘)가 화면·서버에 남는다', async () => {
  let release!: () => void
  const hold = new Promise<void>((r) => (release = r))
  const dash = dashboard(layout(['my_tasks']), { hold, failFirst: true })
  const { user } = await openHome([...widgetData(), ...dash.handler])
  const toggle = () => within(widget('my_tasks')!).getByTestId('mobile-widget-collapse')
  await user.click(toggle()) // 접기 — 첫 PUT 은 붙잡혔다가 500
  await user.click(toggle()) // 펼치기(대기열)
  await user.click(toggle()) // 다시 접기(대기열) — 마지막 의도
  expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  release()
  expect(await screen.findByText('위젯 접기 상태를 저장하지 못했습니다')).toBeInTheDocument()
  await waitFor(() => expect(dash.state.puts).toHaveLength(3))
  // 앞선 실패의 롤백이 뒤에 누른 상태를 덮어쓰지 않는다 — 뒤 PUT 들은 접힘을 보낸다.
  expect(dash.state.puts.slice(1).map((p) => p.widgets[0].collapsed)).toEqual([true, true])
  await waitFor(() => expect(dash.state.stored.widgets[0].collapsed).toBe(true))
  expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  expect(within(widget('my_tasks')!).getByTestId('mobile-widget-summary-text')).toHaveTextContent('로그인 버그 재현')
})

test('접기 저장 실패 → 펼침으로 롤백 + 오류 토스트', async () => {
  const dash = dashboard(layout(['my_tasks']), { putStatus: 500 })
  const { user } = await openHome([...widgetData(), ...dash.handler])
  await user.click(within(widget('my_tasks')!).getByTestId('mobile-widget-collapse'))
  expect(await screen.findByText('위젯 접기 상태를 저장하지 못했습니다')).toBeInTheDocument()
  await waitFor(() => expect(within(widget('my_tasks')!).getByTestId('mobile-widget-collapse')).toHaveAttribute('aria-expanded', 'true'))
  expect(within(widget('my_tasks')!).getByTestId('dash-mytasks')).toBeInTheDocument()
  expect(dash.state.puts[0].device).toBe('mobile')
})

test('접기 저장이 진행 중인 동안 편집 진입이 막혀 접기 PUT 이 편집 저장을 덮어쓰지 않는다', async () => {
  let release!: () => void
  const hold = new Promise<void>((r) => (release = r))
  const dash = dashboard(layout(['my_tasks']), { hold })
  const { user } = await openHome([...widgetData(), ...dash.handler])
  const editToggle = screen.getByTestId('dashboard-edit-toggle')
  expect(editToggle).toBeEnabled()
  await user.click(within(widget('my_tasks')!).getByTestId('mobile-widget-collapse'))
  await waitFor(() => expect(editToggle).toBeDisabled())
  release()
  await waitFor(() => expect(dash.state.puts).toHaveLength(1))
  await waitFor(() => expect(screen.getByTestId('dashboard-edit-toggle')).toBeEnabled())
})

test('타일 — 드라이브 타일은 요약 한 줄·접기 없음, 누르면 /drive 로 간다', async () => {
  const dash = dashboard(
    layout([{ id: 'drv-1', type: 'drive', count: 0, hidden: false, params: {}, label: null }]),
  )
  const { user, location } = await openHome([
    ...widgetData(),
    ...dash.handler,
    http.get('/api/v1/drive/spaces', () => HttpResponse.json([createSpace({ id: 1, name: '디자인팀 공유 자료' })])),
    // 도착한 드라이브 화면이 부르는 쿼터 — 이동만 본다.
    http.get('/api/v1/drive/quota', () => HttpResponse.json({ usedBytes: 0, quotaBytes: 1024 })),
  ])
  const drive = () => widget('drive')!
  expect(drive()).toHaveAttribute('data-mobile-kind', 'tile')
  await waitFor(() => expect(within(drive()).getByTestId('mobile-widget-summary-text')).toHaveTextContent('디자인팀 공유 자료'))
  expect(within(drive()).queryByTestId('mobile-widget-collapse')).not.toBeInTheDocument()
  await user.click(drive())
  await waitFor(() => expect(location()).toBe('/drive'), { timeout: PAGE_LOAD_TIMEOUT })
})

test('타일 — AI 우선순위 타일은 건수·「긴급·중요」 요약을 보이고, 누르면 최상위 항목으로 간다', async () => {
  const priority = {
    items: [
      { sourceType: 'ISSUE_DUE', sourceId: '7', title: '결제 모듈 환불 API 타임아웃', deepLink: '/projects/WP/issues/7', importanceScore: 90, urgencyScore: 80, reason: '마감 임박' },
      { sourceType: 'MENTION', sourceId: '3', title: '시안 리뷰 요청', deepLink: '/me/tasks/assigned', importanceScore: 20, urgencyScore: 10, reason: '' },
    ],
  } as PriorityItemsResponse
  const dash = dashboard(layout([{ id: 'priority_quadrant', type: 'priority_quadrant', count: 3, hidden: false }]))
  const { user, location } = await openHome([
    ...widgetData(),
    ...dash.handler,
    http.get('/api/v1/me/priority-items', () => HttpResponse.json(priority)),
    // 도착한 이슈 상세가 부르는 조회 — 이동만 보므로 최소 응답.
    http.get('/api/v1/projects/WP', () => HttpResponse.json(createProject({ key: 'WP' }))),
    http.get('/api/v1/projects/WP/issues/7', () => HttpResponse.json(createIssueDetail({ summary: createIssue({ id: 7, number: 7, projectKey: 'WP' }) }))),
    http.get('/api/v1/projects/WP/issues/7/*', () => HttpResponse.json([])),
  ])
  // 카드는 저장본이 바뀌면 다시 그려지므로 매번 새로 찾는다.
  const prio = () => widget('priority_quadrant')!
  await waitFor(() => expect(within(prio()).getByTestId('mobile-widget-count')).toHaveTextContent('2'))
  expect(within(prio()).getByTestId('mobile-widget-summary')).toHaveTextContent('긴급·중요')
  await user.click(prio())
  await waitFor(() => expect(location()).toBe('/projects/WP/issues/7'), { timeout: PAGE_LOAD_TIMEOUT })
})

test('collapsed 필드 없는 저장본은 펼침으로, 미등록 위젯은 건너뛰고 렌더된다', async () => {
  const dash = dashboard({
    widgets: [
      { id: 'unknown_x', type: 'unknown_x', count: 3, hidden: false },
      { id: 'my_tasks', type: 'my_tasks', count: 3, hidden: false },
    ],
  })
  await openHome([...widgetData(), ...dash.handler])
  expect(screen.getAllByTestId('dashboard-widget')).toHaveLength(1)
  expect(widget('my_tasks')).toHaveAttribute('data-collapsed', 'false')
  expect(await within(widget('my_tasks')!).findByTestId('dash-mytasks')).toBeInTheDocument()
  // 홈 조회는 모바일 레이아웃(device=mobile)만 — 데스크톱 레이아웃 요청이 섞이지 않는다.
  expect(dash.state.devices.every((d) => d === 'mobile')).toBe(true)
})

test('모바일 위젯 추가 — 타일형에는 한 줄 타일 안내가 붙고, 추가는 모바일 레이아웃(count 3)에만 저장된다', async () => {
  const dash = dashboard(layout(['my_tasks']))
  const { user } = await openHome([...widgetData(), ...dash.handler])
  await user.click(screen.getByTestId('dashboard-edit-toggle'))
  await user.click(await screen.findByTestId('dashboard-add-widget-open'))
  const modal = await screen.findByTestId('add-widget-modal')
  const card = (type: string) => modal.querySelector<HTMLElement>(`[data-testid="add-widget-card"][data-widget-type="${type}"]`)!
  expect(within(card('drive')).getByTestId('add-widget-mobile-tile-note')).toHaveTextContent('모바일에서는 한 줄 타일로 표시')
  expect(within(card('priority_quadrant')).getByTestId('add-widget-mobile-tile-note')).toBeInTheDocument()
  expect(within(card('calendar_today')).queryByTestId('add-widget-mobile-tile-note')).not.toBeInTheDocument()
  await user.click(card('calendar_today'))
  await user.click(within(modal).getByTestId('add-widget-confirm'))
  await user.click(screen.getByTestId('dashboard-edit-save'))
  await waitFor(() => expect(dash.state.puts).toHaveLength(1))
  expect(dash.state.puts[0].device).toBe('mobile')
  expect(dash.state.puts[0].widgets.find((w) => w.type === 'calendar_today')?.count).toBe(3)
})

test('알림 배지는 첫 페이지가 아닌 전체 안 읽음 수(unread-count)를 보인다', async () => {
  const notif: NotificationResponse = {
    id: 1, type: 'ASSIGNED', actorId: 2, actorName: '양동희', actorKind: 'HUMAN', issueId: 1, projectKey: 'WP', issueNumber: 7,
    issueTitle: '리뷰 요청 이슈', commentId: null, eventId: null, eventTitle: null, eventStartsAt: null, read: false, createdAt: '2026-06-16T00:00:00Z',
  }
  const dash = dashboard(layout([{ id: 'notifications', type: 'notifications', count: 3, hidden: false, collapsed: true }]))
  await openHome([
    ...widgetData(),
    ...dash.handler,
    http.get('/api/v1/notifications', () => HttpResponse.json([notif])),
    http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ count: 37 })),
  ])
  await waitFor(() => expect(within(widget('notifications')!).getByTestId('mobile-widget-count')).toHaveTextContent('37'))
})

test('이슈 목록 타일 — 다음 페이지가 있으면 건수 배지에 + 를 붙인다', async () => {
  const items = [1, 2].map((n) => createIssue({ id: n, projectKey: 'WP', number: n, title: `이슈 ${n}` }))
  const dash = dashboard(layout([{ id: 'il-1', type: 'issue_list', count: 0, hidden: false, params: { assignee: 'me' }, label: null }]))
  await openHome([...widgetData(items, 'next-cursor'), ...dash.handler])
  await waitFor(() => expect(within(widgetById('il-1')!).getByTestId('mobile-widget-count')).toHaveTextContent('2+'))
})

test('타일 요약은 필요한 만큼만 조회한다 — 프로젝트 size·연락처 limit 5, 메일 limit 1, 요약 문구는 그대로 (WP-160)', async () => {
  const projectNames = ['플랫폼 인프라 현대화', '고객 콘솔 리디자인', '모바일 앱 v2']
  const seen = { projects: [] as URLSearchParams[], contacts: [] as URLSearchParams[], mail: [] as URLSearchParams[] }
  const dash = dashboard(
    layout([
      { id: 'pj-1', type: 'projects', count: 0, hidden: false, params: {}, label: null },
      { id: 'ct-1', type: 'contacts', count: 0, hidden: false, params: {}, label: null },
      { id: 'ml-1', type: 'mail_list', count: 0, hidden: false, params: {}, label: null },
    ]),
  )
  await openHome([
    ...widgetData(),
    ...dash.handler,
    http.get('/api/v1/projects', ({ request }) => {
      seen.projects.push(new URL(request.url).searchParams)
      return HttpResponse.json({
        content: projectNames.map((name, i) => createProject({ id: i + 1, key: `P${i + 1}`, name })),
        page: 0, size: 5, totalElements: projectNames.length, totalPages: 1,
      })
    }),
    http.get('/api/v1/contacts', ({ request }) => {
      seen.contacts.push(new URL(request.url).searchParams)
      return HttpResponse.json(contactPage([member({ name: '김철수' }), member({ id: 2, name: '이영희' })]))
    }),
    http.get('/api/v1/mail/accounts', () => HttpResponse.json([mailAccount({ id: 1 })])),
    http.get('/api/v1/mail/accounts/1/messages', ({ request }) => {
      seen.mail.push(new URL(request.url).searchParams)
      return HttpResponse.json([mailRow({ id: 11, fromName: '홍길동', subject: '분기 보고서 검토 요청' })])
    }),
  ])
  const summaryOf = (id: string) => within(widgetById(id)!).getByTestId('mobile-widget-summary-text')
  await waitFor(() => expect(summaryOf('pj-1')).toHaveTextContent(projectNames.join(' · ')))
  await waitFor(() => expect(summaryOf('ct-1')).toHaveTextContent('김철수 · 이영희'))
  await waitFor(() => expect(summaryOf('ml-1')).toHaveTextContent('홍길동 · 분기 보고서 검토 요청'))
  expect(seen.projects.length).toBeGreaterThan(0)
  expect(seen.projects.every((q) => q.get('size') === '5')).toBe(true)
  expect(seen.contacts.length).toBeGreaterThan(0)
  expect(seen.contacts.every((q) => q.get('limit') === '5')).toBe(true)
  expect(seen.mail.length).toBeGreaterThan(0)
  expect(seen.mail.every((q) => q.get('limit') === '1' && q.get('folder') === 'INBOX')).toBe(true)
})
