// 홈 대시보드 보기 모드 — 화면 컴포넌트 테스트(WP-971, WP-982).
// 위젯 헤더·행 딥링크, 카탈로그 위젯 params → 헤더 URL 쿼리, 이슈 목록 위젯 쿼리 파라미터, 빈 상태, 알림 헤더·멘션 셀의 인박스 열기,
// 합성(카운트 스트립·주의 필요) 집계·빈 상태·아이콘 색, 빠른 액션 링크, tall 클래스, 위젯 실패 격리, 항목 수 렌더는
// 브라우저 없이 판정되므로 e2e/pages/home.spec.ts 에서 옮겼다. 홈 화면 배선(라우트 → 대시보드 → 위젯 API)은 그 spec 의 @wiring 이 지킨다.
// 대시보드 + 인박스 패널만 renderScreen 으로 띄운다(dashboardKit-b1).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { dashboardKeys } from '@/hooks/queries/dashboardKeys'
import { card, cardById, catalog, headerLink, issues, layout, notification, order, renderDashboard } from '@/test/kits/home/dashboardKit-b1'
import { clickRetryAndExpectErrorKept, gate } from '@/test/loadErrorRetry'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'

/** 컴포넌트와 같은 로컬 오늘 키(yyyy-MM-dd). */
function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 내 작업·합성이 같이 쓰는 /me/issues 를 주어진 이슈로. */
const myIssues = (list: ReturnType<typeof createIssue>[]) => http.get('/api/v1/me/issues', () => HttpResponse.json(createIssueSearchResponse(list)))

/** 멘션 — 안 읽은 코멘트 멘션 1건(일반 댓글 COMMENTED 는 멘션이 아니다, WP-1092). */
const commented = http.get('/api/v1/notifications', () =>
  HttpResponse.json([notification({ id: 5, type: 'ISSUE_COMMENT_MENTION', issueTitle: '코멘트 달린 이슈', commentId: 9 })]),
)

// 5종 위젯 각 행이 상세로 딥링크되고, 헤더는 모듈 루트로 간다. 홈에는 하단 AI 챗 입력이 없다(대시보드 전환 요건).
test('위젯 행·헤더가 각 항목 상세와 모듈로 딥링크되고, 대화 위젯은 제목 「대화」에 빈 상태 문구를 보인다', async () => {
  await renderDashboard(layout(['my_tasks', 'calendar_today', 'notifications', 'recent_chats', 'unread_mail']))
  expect(await screen.findByRole('link', { name: '이슈 열기: 로그인 버그' })).toHaveAttribute('href', '/projects/WP/issues/7')
  expect(await screen.findByRole('link', { name: '일정 열기: 스탠드업 미팅' })).toHaveAttribute('href', '/calendar')
  expect(await screen.findByRole('link', { name: '읽지 않음, 알림 열기: 리뷰 요청 이슈' })).toHaveAttribute('href', '/projects/WP/issues/7')
  expect(await screen.findByRole('link', { name: '메일 열기: 월간 보고서' })).toHaveAttribute('href', '/mail/1?messageId=100')
  expect(await screen.findByTestId('dash-chat-empty')).toHaveTextContent('새 대화가 없어요')
  // 헤더 — 메일은 /mail, 대화 제목은 「대화」(#272).
  expect(within(card('unread_mail')).getByRole('link', { name: /^메일$/ })).toHaveAttribute('href', '/mail')
  expect(within(card('recent_chats')).getByRole('link', { name: /^대화$/ })).toBeInTheDocument()
  expect(screen.queryByTestId('chat-input')).not.toBeInTheDocument()
})

test('행을 누르면 그 이슈 상세 주소로 이동한다', async () => {
  const { user, location } = await renderDashboard(layout(['my_tasks']))
  await user.click(await screen.findByRole('link', { name: '이슈 열기: 로그인 버그' }))
  expect(location()).toBe('/projects/WP/issues/7')
})

// #807 — 카탈로그 위젯 헤더도 링크이고, params 중 대상 화면이 받는 것만 URL 쿼리로 옮긴다(나머지는 모듈 루트로 폴백).
test('카탈로그 위젯 헤더 — 필터 없으면 모듈 루트, 필터는 대상 화면 쿼리로 반영되고 누르면 그 주소로 간다 (#807)', async () => {
  const { user, location } = await renderDashboard(
    layout([
      catalog('w-projects', 'projects'),
      catalog('w-drive', 'drive'),
      catalog('w-channels', 'channels'),
      catalog('w-activity', 'activity', { actorKind: 'AGENT' }),
      catalog('w-issues-me', 'issue_list', { assignee: 'me', status: 'TODO,IN_PROGRESS', priority: 'HIGH' }),
      catalog('w-issues-all', 'issue_list', { assignee: 'all', priority: 'HIGH' }),
      catalog('w-contacts', 'contacts', { search: '김', type: 'MEMBER' }),
      catalog('w-contacts-all', 'contacts', { search: '  ', type: 'ALL' }),
      catalog('w-mail-sent', 'mail_list', { folder: 'SENT', unreadOnly: true }),
      catalog('w-mail-inbox', 'mail_list', { folder: 'INBOX', unreadOnly: true }),
      catalog('w-calendar', 'calendar', { range: 'week' }),
      catalog('w-wiki', 'wiki', { query: '온보딩' }),
    ]),
    {
      handlers: [
        http.get('/api/v1/contacts', () => HttpResponse.json({ items: [], total: 0 })),
        // 노트 위젯 본문은 스페이스 목록을 읽는다 — 부하에서 늦게 그려지면 테스트 끝 무렵에 요청이 나간다.
        http.get('/api/v1/wiki/spaces', () => HttpResponse.json([])),
      ],
    },
  )
  const expected: Record<string, string> = {
    'w-projects': '/projects',
    'w-drive': '/drive',
    'w-channels': '/chat',
    // 활동 피드는 전용 화면이 없어 actorKind 를 버리고 프로젝트 루트로.
    'w-activity': '/projects',
    'w-issues-me': '/me/tasks/assigned?status=TODO%2CIN_PROGRESS&priority=HIGH',
    // assignee=all 은 전역 이슈 화면이 없어 /projects 폴백.
    'w-issues-all': '/projects',
    'w-contacts': '/contacts?q=%EA%B9%80&type=MEMBER',
    'w-contacts-all': '/contacts',
    'w-mail-sent': '/mail?folder=sent',
    'w-mail-inbox': '/mail',
    'w-calendar': '/calendar',
    'w-wiki': '/wiki',
  }
  for (const [id, href] of Object.entries(expected)) {
    await waitFor(() => expect(headerLink(id)).toHaveAttribute('href', href))
  }
  await user.click(headerLink('w-contacts')!)
  // 이동은 라우터가 다음 렌더에서 알리므로 기다린다(부하에서 클릭 직후 바로 읽으면 이전 주소였다).
  await waitFor(() => expect(location()).toBe('/contacts?q=%EA%B9%80&type=MEMBER'))
})

// WP-518 — 서버는 'all' 을 username 으로 보고 400 을 내므로 담당자 조건이 빠져야 한다. 다른 필터는 그대로.
test('이슈 목록 위젯 — 담당자 「전체」는 assignee 없이 조회해 목록을 보여준다 (WP-518)', async () => {
  const urls: URL[] = []
  await renderDashboard(layout([catalog('w-issues-all', 'issue_list', { assignee: 'all', priority: 'HIGH' })]), {
    handlers: [
      http.get('/api/v1/me/issues', ({ request }) => {
        urls.push(new URL(request.url))
        return HttpResponse.json(issues())
      }),
    ],
  })
  await waitFor(() => expect(cardById('w-issues-all')).toHaveTextContent('로그인 버그'))
  expect(within(cardById('w-issues-all')).queryByTestId('issuelist-error')).not.toBeInTheDocument()
  const url = urls.at(-1)!
  expect(url.searchParams.has('assignee')).toBe(false)
  expect(url.searchParams.get('priority')).toBe('HIGH')
})

// WP-520 — 보기 모드에서 모두 숨김이면 빈 캔버스 대신 안내 + 「홈 편집」, 누르면 숨긴 위젯도 카드로 보이는 편집 모드.
test('위젯을 모두 숨기면 빈 상태 안내가 보이고 「홈 편집」으로 편집에 들어간다 (WP-520)', async () => {
  const { user } = await renderDashboard(
    layout([
      { id: 'my_tasks', type: 'my_tasks', count: 5, hidden: true },
      { id: 'calendar_today', type: 'calendar_today', count: 5, hidden: true },
    ]),
  )
  const empty = await screen.findByTestId('dashboard-empty')
  expect(empty).toHaveTextContent('보이는 위젯이 없습니다')
  expect(screen.queryAllByTestId('dashboard-widget')).toHaveLength(0)
  await user.click(within(empty).getByTestId('dashboard-empty-action'))
  expect(screen.getByTestId('dashboard-edit-banner')).toBeInTheDocument()
  expect(screen.getAllByTestId('dashboard-widget')).toHaveLength(2)
})

// #274 — 알림 위젯 헤더는 엉뚱한 화면으로 가는 링크가 아니라 인박스 패널을 여는 버튼이다(주소는 홈에 머문다).
test('알림 위젯 헤더를 누르면 라우팅 대신 인박스 패널이 열린다 (#274)', async () => {
  const { user, location } = await renderDashboard(layout(['notifications']))
  const widget = card('notifications')
  expect(within(widget).queryByRole('link', { name: '알림' })).not.toBeInTheDocument()
  expect(screen.queryByTestId('inbox-panel')).not.toBeInTheDocument()
  await user.click(within(widget).getByRole('button', { name: '알림' }))
  const panel = await screen.findByTestId('inbox-panel')
  expect((await within(panel).findAllByTestId('inbox-item'))[0]).toHaveTextContent('리뷰 요청 이슈')
  expect(location()).toBe('/')
})

test('합성 — 카운트 스트립이 메일·일정·멘션·오늘 마감 수를 보이고 각 셀이 모듈로 딥링크된다 (#275)', async () => {
  await renderDashboard(layout(['synthesis', 'my_tasks']), {
    handlers: [myIssues([createIssue({ id: 1, projectKey: 'WP', number: 7, title: '오늘 마감 이슈', dueDate: todayKey() })]), commented],
  })
  const counts = await screen.findByTestId('dashboard-counts')
  expect(await within(counts).findByRole('link', { name: '안 읽음 2건' })).toHaveAttribute('href', '/mail')
  expect(await within(counts).findByRole('link', { name: '오늘 일정 1건' })).toHaveAttribute('href', '/calendar')
  // 멘션 셀은 링크가 아니라 패널을 여는 버튼(#273).
  expect(await within(counts).findByRole('button', { name: '멘션 1건' })).toBeInTheDocument()
  // 오늘 마감은 전체 할당 목록이 아니라 dueDate=today 필터(#275).
  expect(await within(counts).findByRole('link', { name: '오늘 마감 1건' })).toHaveAttribute('href', '/me/tasks/assigned?dueDate=today')
})

// WP-675 — 완료·취소된 이슈는 오늘 마감 수에도, 주의 필요 목록에도 들지 않는다.
test('합성 — 완료·취소된 이슈는 오늘 마감 수와 주의 필요 목록에서 빠진다 (WP-675)', async () => {
  await renderDashboard(layout(['synthesis']), {
    handlers: [
      myIssues([
        createIssue({ id: 1, number: 1, title: '오늘마감-TODO', status: 'TODO', dueDate: todayKey() }),
        createIssue({ id: 2, number: 2, title: '오늘마감-DONE', status: 'DONE', dueDate: todayKey() }),
        createIssue({ id: 3, number: 3, title: '오늘마감-CANCELED', status: 'CANCELED', dueDate: todayKey() }),
        createIssue({ id: 4, number: 4, title: '어제마감-TODO', status: 'TODO', dueDate: '2020-01-01' }),
        createIssue({ id: 5, number: 5, title: '어제마감-DONE', status: 'DONE', dueDate: '2020-01-01' }),
      ]),
    ],
  })
  expect(await within(await screen.findByTestId('dashboard-counts')).findByRole('link', { name: '오늘 마감 1건' })).toBeInTheDocument()
  const attention = screen.getByTestId('dashboard-attention')
  expect(await within(attention).findByRole('link', { name: '이슈 열기: 오늘마감-TODO' })).toBeInTheDocument()
  expect(within(attention).getByRole('link', { name: '이슈 열기: 어제마감-TODO' })).toBeInTheDocument()
  expect(within(attention).queryByRole('link', { name: /이슈 열기: .*-(DONE|CANCELED)$/ })).not.toBeInTheDocument()
})

// #273 — 멘션 셀은 전용 페이지가 없어 알림 인박스 패널을 연다(주소는 홈에 머문다).
test('합성 — 멘션 셀을 누르면 인박스 패널이 열려 멘션 알림을 보인다 (#273)', async () => {
  const { user, location } = await renderDashboard(layout(['synthesis', 'my_tasks']), { handlers: [commented] })
  expect(screen.queryByTestId('inbox-panel')).not.toBeInTheDocument()
  await user.click(await within(await screen.findByTestId('dashboard-counts')).findByRole('button', { name: '멘션 1건' }))
  const panel = await screen.findByTestId('inbox-panel')
  expect((await within(panel).findAllByTestId('inbox-item'))[0]).toHaveTextContent('코멘트 달린 이슈')
  expect(location()).toBe('/')
})

// #293 — 주의 항목이 있을 때만 헤더 아이콘이 경고색, 없으면 중립색.
test('합성 — 마감 지난 이슈가 주의 필요 행(마감 지남)으로 보이고 누르면 이슈로 가며, 헤더 아이콘은 경고색이다 (#293)', async () => {
  const { user, location } = await renderDashboard(layout(['synthesis', 'my_tasks']), {
    handlers: [myIssues([createIssue({ id: 1, projectKey: 'WP', number: 7, title: '지연된 이슈', dueDate: '2020-01-01' })])],
  })
  const attention = await screen.findByTestId('dashboard-attention')
  const row = await within(attention).findByRole('link', { name: '이슈 열기: 지연된 이슈' })
  expect(row).toHaveTextContent('마감 지남')
  expect(row).toHaveAttribute('href', '/projects/WP/issues/7')
  const icon = attention.querySelector('svg')!
  expect(icon).toHaveClass('text-destructive')
  expect(icon).not.toHaveClass('text-muted-foreground')
  await user.click(row)
  expect(location()).toBe('/projects/WP/issues/7')
})

test('합성 — 급한 항목이 없으면 차분한 빈 상태(이모지 없음)와 중립색 헤더 아이콘을 보인다 (#280·#293)', async () => {
  await renderDashboard(layout(['synthesis']), { widgets: false })
  const empty = await screen.findByTestId('dashboard-attention-empty')
  expect(empty).toHaveTextContent('다 확인했습니다')
  expect(empty).not.toHaveTextContent('✅')
  const icon = screen.getByTestId('dashboard-attention').querySelector('svg')!
  expect(icon).toHaveClass('text-muted-foreground')
  expect(icon).not.toHaveClass('text-destructive')
})

test('빠른 액션 — 각 버튼이 실제 라우트로 연결된다', async () => {
  await renderDashboard(layout(['quick_actions']), { widgets: false })
  const qa = await screen.findByTestId('dashboard-quickactions')
  expect(within(qa).getByRole('link', { name: '새 이슈' })).toHaveAttribute('href', '/projects')
  expect(within(qa).getByRole('link', { name: '메일 작성' })).toHaveAttribute('href', '/mail')
  expect(within(qa).getByRole('link', { name: '새 대화' })).toHaveAttribute('href', '/chat/new')
})

test('그리드 — 저장 순서로 5종 위젯을 그리고, 알림 위젯만 tall(lg:row-span-2)이다', async () => {
  await renderDashboard(layout(['my_tasks', 'calendar_today', 'notifications', 'recent_chats', 'unread_mail']))
  expect(order()).toEqual(['my_tasks', 'calendar_today', 'notifications', 'recent_chats', 'unread_mail'])
  expect(card('notifications')).toHaveClass('lg:row-span-2')
  expect(card('my_tasks')).not.toHaveClass('lg:row-span-2')
})

// 메일 요약만 500 — 메일 위젯은 오류+다시 시도, 내 작업은 정상. 메일 위젯이 거짓 빈/정상 상태를 보이면 안 된다.
test('한 위젯 데이터 실패는 그 위젯에만 오류·다시 시도를 보이고 다른 위젯은 정상이다', async () => {
  await renderDashboard(layout(['my_tasks', 'unread_mail']), {
    handlers: [http.get('/api/v1/me/mail-summary', () => HttpResponse.json({ message: 'server error' }, { status: 500 }))],
  })
  const error = await screen.findByTestId('dash-mail-error')
  expect(within(error).getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  expect(await screen.findByTestId('dash-mytasks')).toBeInTheDocument()
  expect(screen.queryByTestId('dash-mail')).not.toBeInTheDocument()
  expect(screen.queryByTestId('dash-mail-empty')).not.toBeInTheDocument()
})

test('count:10 위젯은 항목 12건 중 10건만 렌더한다', async () => {
  await renderDashboard(
    { widgets: [{ id: 'my_tasks', type: 'my_tasks', count: 10, hidden: false }] },
    {
      handlers: [
        myIssues(Array.from({ length: 12 }, (_, i) => createIssue({ id: i + 1, projectKey: 'WP', number: i + 1, title: `이슈 ${i + 1}`, status: 'IN_PROGRESS' }))),
      ],
    },
  )
  const body = await screen.findByTestId('dash-mytasks')
  await waitFor(() => expect(within(body).getAllByRole('link', { name: /^이슈 열기:/ })).toHaveLength(10))
})

// WP-1850 — 레이아웃 조회가 실패하면 빈 상태(「보이는 위젯이 없습니다」)로 위장하지 않고 오류 안내·다시 시도를 보인다.
test('레이아웃 조회가 실패하면 빈 상태 대신 오류 안내와 다시 시도를 보이고 편집을 잠근다 (WP-1850)', async () => {
  let fail = true
  let calls = 0
  // 두 번째(다시 시도) 응답을 붙잡아 둔다 — 응답이 이미 도착한 뒤에 단언하면 `!loadFailed` 가 빠져도 통과하기 때문(WP-1850).
  const retryGate = gate()
  // 실패하면 위젯 그리드가 그려지지 않으므로 그리드를 기다리지 않는다.
  const { user } = await renderDashboard(layout(['my_tasks']), {
    waitForGrid: false,
    handlers: [
      http.get('/api/v1/me/dashboard', async () => {
        calls += 1
        if (fail) return HttpResponse.json({ message: 'boom' }, { status: 500 })
        await retryGate.promise
        return undefined
      }),
    ],
  })
  expect(await screen.findByTestId('dashboard-load-error')).toHaveTextContent('홈 위젯을 불러오지 못했습니다')
  expect(screen.queryByTestId('dashboard-empty')).not.toBeInTheDocument()
  expect(screen.getByTestId('dashboard-edit-toggle')).toBeDisabled()

  // 다시 시도 — 서버가 살아나면 위젯이 나오고 안내가 사라지며 편집이 풀린다. 다시 부르는 동안에도 빈 상태로 바뀌지 않는다.
  fail = false
  await clickRetryAndExpectErrorKept(user, 'dashboard-load-error', () => calls)
  expect(screen.queryByTestId('dashboard-empty')).not.toBeInTheDocument()
  expect(screen.queryByTestId('dashboard-skeleton')).not.toBeInTheDocument()
  retryGate.release()
  await waitFor(() => expect(card('my_tasks')).toBeTruthy())
  expect(screen.queryByTestId('dashboard-load-error')).not.toBeInTheDocument()
  expect(screen.getByTestId('dashboard-edit-toggle')).toBeEnabled()
})

test('저장된 위젯이 0개면(조회 성공) 오류가 아니라 빈 상태를 보인다 (WP-1850)', async () => {
  await renderDashboard(layout([]))
  expect(await screen.findByTestId('dashboard-empty')).toBeInTheDocument()
  expect(screen.queryByTestId('dashboard-load-error')).not.toBeInTheDocument()
})

test('이미 받은 레이아웃은 재조회가 실패해도 위젯을 그대로 보인다 (WP-1850)', async () => {
  let fail = false
  let failedCalls = 0
  const { queryClient } = await renderDashboard(layout(['my_tasks']), {
    handlers: [
      http.get('/api/v1/me/dashboard', () => {
        if (!fail) return undefined
        failedCalls += 1
        return HttpResponse.json({ message: 'boom' }, { status: 500 })
      }),
    ],
  })
  expect(card('my_tasks')).toBeTruthy()
  fail = true
  await queryClient.invalidateQueries({ queryKey: dashboardKeys.all })
  expect(failedCalls).toBeGreaterThan(0) // 500 경로가 실제로 탔는지
  // 쿼리가 실패 상태가 된 뒤의 화면을 본다 — 다시 그리기 전에 단언하면 오류 안내가 없다는 단언이 저절로 통과한다.
  await waitFor(() => expect(queryClient.getQueryState(dashboardKeys.layout('desktop'))?.status).toBe('error'))
  expect(card('my_tasks')).toBeTruthy()
  expect(screen.queryByTestId('dashboard-load-error')).not.toBeInTheDocument()
})

// WP-1850 /code-review — 편집 중에 레이아웃 캐시가 비고 다시 부르기가 실패하면 편집 배너(저장·위젯 추가)를 숨긴다.
// 기준 레이아웃을 볼 수 없는 채로 저장하면 서버 레이아웃을 덮어쓰기 때문이다.
test('편집 중 레이아웃을 다시 불러오다 실패하면 편집 배너를 숨기고 오류 안내만 보인다 (WP-1850)', async () => {
  let fail = false
  const { user, queryClient } = await renderDashboard(layout(['my_tasks']), {
    handlers: [http.get('/api/v1/me/dashboard', () => (fail ? HttpResponse.json({ message: 'boom' }, { status: 500 }) : undefined))],
  })
  await user.click(screen.getByTestId('dashboard-edit-toggle'))
  expect(await screen.findByTestId('dashboard-edit-banner')).toBeInTheDocument()
  fail = true
  // 캐시를 비우고 다시 부른다 — 데이터 없이 실패한 상태(gcTime 으로 캐시가 지워진 뒤 돌아온 경우와 같다).
  await queryClient.resetQueries({ queryKey: dashboardKeys.all })
  expect(await screen.findByTestId('dashboard-load-error')).toBeInTheDocument()
  expect(screen.queryByTestId('dashboard-edit-banner')).not.toBeInTheDocument()
  expect(screen.queryByTestId('dashboard-edit-save')).not.toBeInTheDocument()
})

// WP-1850 리뷰 후속 — 편집 중 기준 레이아웃을 잃으면 편집 세션을 끝낸다. 다시 시도로 바뀐 레이아웃을 받았을 때 옛 초안으로
// 편집이 되살아나 저장하면 그사이 바뀐 레이아웃을 덮어쓰지 않게, 다시 들어가면 새 레이아웃에서 시작하게 한다.
test('편집 중 기준 레이아웃을 잃었다가 다시 받으면 옛 초안으로 편집이 되살아나지 않고 새 레이아웃에서 다시 시작한다 (WP-1850)', async () => {
  let fail = false
  const { user, queryClient, dash } = await renderDashboard(layout(['my_tasks', 'calendar_today']), {
    handlers: [http.get('/api/v1/me/dashboard', () => (fail ? HttpResponse.json({ message: 'boom' }, { status: 500 }) : undefined))],
  })
  await user.click(screen.getByTestId('dashboard-edit-toggle'))
  expect(await screen.findByTestId('dashboard-edit-banner')).toBeInTheDocument()
  // 초안을 바꿔 둔다(내 작업 숨김) — 세션이 남으면 이 초안이 되살아난다.
  await user.click(within(card('my_tasks')).getByTestId('widget-hide-toggle'))

  fail = true
  await queryClient.resetQueries({ queryKey: dashboardKeys.all })
  expect(await screen.findByTestId('dashboard-load-error')).toBeInTheDocument()

  // 그사이 다른 기기·탭에서 레이아웃이 바뀌었다 — 다시 시도로 새 레이아웃을 받는다.
  dash.state.stored = layout(['calendar_today'])
  fail = false
  await user.click(within(screen.getByTestId('dashboard-load-error')).getByRole('button', { name: '다시 시도' }))
  await waitFor(() => expect(order()).toEqual(['calendar_today']))
  // 편집 세션이 끝나 보기 모드다 — 옛 초안(내 작업 숨김)으로 편집 배너·저장이 되살아나지 않는다.
  expect(screen.queryByTestId('dashboard-edit-banner')).not.toBeInTheDocument()
  expect(screen.getByTestId('dashboard-edit-toggle')).toBeEnabled()

  // 다시 들어가면 새 레이아웃에서 시작하고, 저장하면 새 레이아웃 그대로 보낸다(옛 초안의 my_tasks 가 섞이지 않는다).
  await user.click(screen.getByTestId('dashboard-edit-toggle'))
  expect(await screen.findByTestId('dashboard-edit-banner')).toBeInTheDocument()
  expect(order()).toEqual(['calendar_today'])
  await user.click(screen.getByTestId('dashboard-edit-save'))
  await waitFor(() => expect(dash.state.puts).toHaveLength(1))
  expect(dash.state.puts[0].body.widgets.map((w) => w.id)).toEqual(['calendar_today'])
})

// WP-1850 리뷰 후속 /code-review — 실패가 아니라 캐시가 지워져 다시 받는 중이면 편집 세션을 끝내지 않는다(WP-162 초안 유지).
test('편집 중 레이아웃 캐시가 지워져 다시 받기만 하면 초안과 편집이 그대로 이어진다 (WP-1850)', async () => {
  // 다시 받는 응답을 붙잡아 둔다 — 바로 응답하면 「받는 중」(데이터 없음) 렌더가 건너뛰어져 세션을 끝내는 잘못을 못 잡는다.
  let hold: ReturnType<typeof gate> | null = null
  const { user, queryClient } = await renderDashboard(layout(['my_tasks', 'calendar_today']), {
    handlers: [
      http.get('/api/v1/me/dashboard', async () => {
        if (hold) await hold.promise
        return undefined
      }),
    ],
  })
  await user.click(screen.getByTestId('dashboard-edit-toggle'))
  expect(await screen.findByTestId('dashboard-edit-banner')).toBeInTheDocument()
  await user.click(within(card('my_tasks')).getByTestId('widget-hide-toggle'))
  expect(within(card('my_tasks')).getByTestId('widget-hide-toggle')).toHaveAccessibleName(/^표시:/)

  // 캐시를 비우고 다시 받는다(성공) — gcTime 으로 지워진 뒤 돌아온 것과 같다. 받는 중(스켈레톤)을 화면에서 확인한 뒤 응답을 푼다.
  hold = gate()
  void queryClient.resetQueries({ queryKey: dashboardKeys.all })
  expect(await screen.findByTestId('dashboard-skeleton')).toBeInTheDocument()
  hold.release()
  expect(await screen.findByTestId('dashboard-edit-banner')).toBeInTheDocument()
  // 숨김 초안이 남아 있다(세션이 끝났다면 「숨김:」으로 돌아온다).
  expect(within(card('my_tasks')).getByTestId('widget-hide-toggle')).toHaveAccessibleName(/^표시:/)
  expect(screen.getByTestId('dashboard-edit-undo')).toBeEnabled()
})

// WP-1885 — 위젯 제목이 헤딩이 아니라 div 라 스크린리더 헤딩 탐색에서 빠졌다. 제목=h2, 요약 소제목=h3.
test('위젯 제목은 h2 로, 요약 안 「지금 신경 쓸 일」은 h3 로 그려진다(WP-1885)', async () => {
  await renderDashboard(layout(['synthesis', 'my_tasks', 'notifications', 'unread_mail']))
  await screen.findByTestId('dashboard-attention')
  const names = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
  expect(names).toEqual(expect.arrayContaining(['내 작업', '알림', '메일']))
  expect(screen.getByRole('heading', { level: 3, name: /지금 신경 쓸 일/ })).toBeInTheDocument()
  // 링크 머리는 h2 안의 링크, 인박스를 여는 알림 머리는 h2 안의 단추 — 헤딩이 단추를 감싼다.
  const mail = screen.getByRole('heading', { level: 2, name: '메일' })
  expect(within(mail).getByRole('link')).toHaveAttribute('href', '/mail')
  const noti = screen.getByRole('heading', { level: 2, name: '알림' })
  expect(within(noti).getByRole('button', { name: '알림' })).toBeInTheDocument()
})

// WP-1941 — 위젯 제목이 본문 상속 16px/400 이라 홈 제목(15px/700)보다 컸다. 섹션 제목 토큰(14px/600)을 쓴다.
test('위젯 제목 h2 는 섹션 제목 토큰(heading-body-section)을 쓴다(WP-1941)', async () => {
  await renderDashboard(layout(['my_tasks', 'notifications', 'unread_mail']))
  for (const name of ['내 작업', '알림', '메일']) {
    const h = await screen.findByRole('heading', { level: 2, name })
    expect(h).toHaveClass('text-sm', 'leading-5', 'font-semibold')
    // 글꼴은 h2 에서만 정한다 — 안쪽 card-title span 이 자기 글꼴 클래스로 토큰을 덮으면 안 된다.
    const span = h.querySelector('[data-slot="card-title"]')
    expect(span).not.toBeNull()
    for (const c of ['font-medium', 'text-sm', 'leading-none']) expect(span).not.toHaveClass(c)
  }
})

test('제목을 숨긴(chromeless) 위젯도 보이지 않는 h2 제목이 있다(WP-1885)', async () => {
  await renderDashboard(layout([{ id: 'quick_actions', type: 'quick_actions', count: 5, hidden: false, chromeless: true }]))
  const h = await screen.findByRole('heading', { level: 2, name: '빠른 액션' })
  expect(h).toHaveClass('sr-only')
})

// WP-1888 — 카탈로그 위젯 제목(WidgetFrame)은 카드 제목 아래라 h3. 카드 제목 자체(WP-1885 뒤 h2)와 상관없이
// 위젯 틀(home-widget) 안에는 h2 가 없어야 한다.
test('카탈로그 위젯 제목은 카드 안에서 h3 — 카드 제목 아래 위계 (WP-1888)', async () => {
  await renderDashboard(layout([catalog('w-projects', 'projects')]), {
    // 프로젝트 위젯이 함께 부르는 위키 스페이스 조회 — 핸들러가 없으면 테스트가 실패한다
    handlers: [http.get('/api/v1/wiki/spaces', () => HttpResponse.json([]))],
  })
  const c = cardById('w-projects')
  expect(await within(c).findByRole('heading', { level: 3, name: '프로젝트' })).toBeInTheDocument()
  expect(within(c).getByTestId('home-widget').querySelector('h2')).toBeNull()
})

// 제목을 숨긴 카탈로그 카드는 위젯 자체 제목 하나만 h2 — sr-only h2 를 따로 두지 않아 두 번 읽히지 않는다(WP-1888).
// 사용자가 붙인 라벨(cfg.label)이 위젯 제목과 달라도 보이는 위젯 제목이 헤딩이다.
test.each([undefined, '내 일감'])('제목을 숨긴 카탈로그 위젯은 위젯 제목 하나만 h2 다 (라벨 %s)', async (label) => {
  await renderDashboard(layout([{ ...catalog('w-projects', 'projects'), chromeless: true, label }]), {
    handlers: [http.get('/api/v1/wiki/spaces', () => HttpResponse.json([]))],
  })
  const c = cardById('w-projects')
  const h = await within(c).findByRole('heading', { level: 2, name: '프로젝트' })
  expect(within(c).getAllByRole('heading')).toHaveLength(1)
  expect(within(c).getByTestId('home-widget')).toContainElement(h)
})
