// 내 작업(/me/tasks/:tab, 3탭) — 화면 테스트(WP-971, WP-995).
// 탭별 조회 파라미터(assignee/reporter·group·hideClosed)·탭 이동 주소·잘못된 탭 바로잡기·facet 칩 → status 쿼리·아이콘 표시·
// aria-controls 패널·프로젝트 묶음 머리(서버 건수, 페이지 이어짐)·레이블 +N·행 클릭 이동·마감 지남·완료 모두 보기 토글·
// 실패·로딩·필터 0건·데이터 없음 상태, 구독 탭(group=recent·담당자 열·빈 문구)은 API 응답과 주소가 화면으로 바뀌는 것이라
// 브라우저 없이 판정되므로 e2e/pages/me/my-tasks.spec.ts·watched.spec.ts 에서 옮겼다.
// 헤더 정렬·행 높이·배지 한 줄·ID 헤더 x 맞춤(@layout)과 /me/tasks → 할당 탭 대표 흐름(@wiring), 구버전 /me/watched 라우트(@wiring)는 E2E 에 남는다.
// 페이지 컴포넌트를 탭 경로 라우트 하나로 감싸 renderScreen 으로 띄운다 — 탭은 경로 세그먼트(:tab)라 Route 가 필요하고, 앱 셸은 필요 없다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { openQuickFacet } from '@/test/kits/projects/quickFilter'
import { renderScreen } from '@/test/renderScreen'
import type { IssueSearchResponse } from '@/types/issue'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { createLabel, toLabelSummary } from '../../../e2e/factories/label.factory'
import MyTasksPage from './MyTasksPage'

afterEach(() => {
  vi.useRealTimers()
})

const EX = { name: '외부 연동 프로젝트', size: 7 }
const OPS = { name: '운영 개선', size: 2 }
const labels = (n: number) => Array.from({ length: n }, (_, i) => toLabelSummary(createLabel({ id: 900 + i, name: `레이블${i + 1}` })))

/** 두 프로젝트(EX·OPS)에 걸친 기본 응답 — 52번은 긴 제목·레이블 5개, 53번은 레이블 0개. */
function twoProjectItems() {
  return [
    createIssue({ id: 52, projectKey: 'EX', number: 52, title: '긴 제목 '.repeat(30).trim(), labels: labels(5), projectGroup: EX }),
    createIssue({ id: 53, projectKey: 'EX', number: 53, title: '짧은 제목', projectGroup: EX }),
    createIssue({ id: 61, projectKey: 'OPS', number: 61, title: '운영 이슈', projectGroup: OPS }),
  ]
}

type Respond = (sp: URLSearchParams) => IssueSearchResponse | Response | Promise<IssueSearchResponse | Response>

/** /me/issues·/me/watched-issues 목 — 요청 검색 파라미터를 모두 기록하고 응답은 쿼리별로 고른다. */
function renderMyTasks(path: string, respond: Respond = () => createIssueSearchResponse(twoProjectItems()), watched: Respond = () => createIssueSearchResponse([])) {
  const seen: URLSearchParams[] = []
  const seenWatched: URLSearchParams[] = []
  const reply = async (r: Respond, sp: URLSearchParams) => {
    const body = await r(sp)
    return body instanceof Response ? body : HttpResponse.json(body)
  }
  const view = renderScreen(
    <Routes>
      <Route path="/me/tasks/:tab" element={<MyTasksPage />} />
      <Route path="*" element={null} />
    </Routes>,
    {
      path,
      handlers: [
        http.get('/api/v1/me/issues', ({ request }) => {
          const sp = new URL(request.url).searchParams
          seen.push(sp)
          return reply(respond, sp)
        }),
        http.get('/api/v1/me/watched-issues', ({ request }) => {
          const sp = new URL(request.url).searchParams
          seenWatched.push(sp)
          return reply(watched, sp)
        }),
      ],
    },
  )
  return { ...view, seen, seenWatched }
}

const search = (location: string) => new URL(location, 'http://x').searchParams

describe('내 작업 탭', () => {
  // 할당 탭: assignee=me·group=due·hideClosed=true 로 조회, 담당자 열 없음(#201).
  test('할당 탭은 assignee=me·group=due·hideClosed=true 로 조회하고 담당자 열이 없다', async () => {
    const { seen } = renderMyTasks('/me/tasks/assigned')
    expect(await screen.findByTestId('assigned-row-52')).toBeInTheDocument()
    expect(seen[0].get('assignee')).toBe('me')
    expect(seen[0].get('group')).toBe('due')
    expect(seen[0].get('hideClosed')).toBe('true')
    expect(screen.queryByRole('columnheader', { name: '담당자' })).not.toBeInTheDocument()
  })

  // 내가 만든 탭: reporter=me·group=recent·hideClosed 없음, 담당자 열 있음. 탭 클릭은 경로를 바꾼다.
  test('탭 클릭으로 내가 만든 탭(reporter=me, group=recent, 담당자 열)으로 간다', async () => {
    const { user, location, seen } = renderMyTasks('/me/tasks/assigned')
    await screen.findByTestId('assigned-row-52')
    await user.click(screen.getByTestId('tab-reported'))
    await waitFor(() => expect(location()).toBe('/me/tasks/reported'))
    expect(await screen.findByTestId('reported-row-52')).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader', { name: '담당자' })).toHaveLength(1)
    const reported = seen.find((sp) => sp.get('reporter') === 'me')!
    expect(reported.get('group')).toBe('recent')
    expect(reported.get('hideClosed')).toBeNull()
  })

  // WP-926: 알 수 없는 탭은 필터 쿼리를 유지한 채 할당 탭 주소로 바로잡고 할당 탭을 선택해 그린다.
  test('잘못된 탭은 할당 탭 주소로 바로잡고 할당 탭을 그린다', async () => {
    const { location } = renderMyTasks('/me/tasks/bogus?priority=HIGH', () =>
      createIssueSearchResponse([createIssue({ id: 55, title: '폴백 할당 이슈' })]),
    )
    expect(await screen.findByTestId('assigned-row-55')).toHaveTextContent('폴백 할당 이슈')
    expect(location()).toBe('/me/tasks/assigned?priority=HIGH')
    expect(screen.getByTestId('tab-assigned')).toHaveAttribute('aria-selected', 'true')
  })

  // #233-B: ＋필터 → 상태 → 진행 중 → status=IN_PROGRESS(+assignee=me) 요청·칩, 칩 제거 → status 쿼리·칩 사라짐(탭 유지).
  test('상태 facet 을 선택하면 status query 로 조회하고 칩이 보인다 (할당 탭 유지)', async () => {
    const { user, location, seen } = renderMyTasks('/me/tasks/assigned')
    await screen.findByTestId('assigned-row-52')
    expect(seen.at(-1)?.get('status')).toBeNull()
    await openQuickFacet(user, 'status')
    await user.click(await screen.findByTestId('facet-value-status-IN_PROGRESS'))
    await waitFor(() => expect(seen.at(-1)?.get('status')).toBe('IN_PROGRESS'))
    expect(seen.at(-1)?.get('assignee')).toBe('me')
    expect(location()).toMatch(/^\/me\/tasks\/assigned\?/)
    expect(screen.getByTestId('quick-filter-status')).toHaveAttribute('data-active', 'true')
    await user.keyboard('{Escape}')
    await user.click(screen.getByTestId('quick-filter-status-remove'))
    await waitFor(() => expect(search(location()).has('status')).toBe(false))
    expect(screen.getByTestId('quick-filter-status')).not.toHaveAttribute('data-active')
  })

  // #294: 상태·우선순위는 텍스트 배지가 아니라 아이콘(role=img + aria-label).
  test('상태·우선순위가 텍스트 배지 아닌 아이콘으로 렌더된다 (#294)', async () => {
    renderMyTasks('/me/tasks/assigned', () =>
      createIssueSearchResponse([createIssue({ id: 77, title: '아이콘 검증 이슈', status: 'IN_PROGRESS', priority: 'HIGH' })]),
    )
    const row = await screen.findByTestId('assigned-row-77')
    expect(within(row).getByRole('img', { name: /상태:/ })).toBeInTheDocument()
    expect(within(row).getByRole('img', { name: /우선순위/ })).toBeInTheDocument()
    expect(within(row).queryByText('진행 중')).not.toBeInTheDocument()
    expect(within(row).queryByText('높음')).not.toBeInTheDocument()
  })

  // WP-841: 선택 탭의 aria-controls 가 그 탭으로 이름 붙은 tabpanel(목록 포함)을 가리킨다 — 할당·구독 탭 모두.
  test('선택 탭의 aria-controls 가 그 탭으로 이름 붙은 tabpanel(목록 포함)을 가리킨다', async () => {
    const { user } = renderMyTasks(
      '/me/tasks/assigned',
      () => createIssueSearchResponse([createIssue({ id: 31, title: '패널 안 이슈' })]),
      () => createIssueSearchResponse([createIssue({ id: 32, title: '구독 이슈' })]),
    )
    await screen.findByTestId('assigned-row-31')
    for (const [tab, row] of [['assigned', 'assigned-row-31'], ['watched', 'watched-row-32']] as const) {
      if (tab === 'watched') await user.click(screen.getByTestId('tab-watched'))
      const trigger = screen.getByTestId(`tab-${tab}`)
      await waitFor(() => expect(trigger).toHaveAttribute('aria-selected', 'true'))
      const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!
      expect(panel).toHaveAttribute('role', 'tabpanel')
      expect(panel).toHaveAttribute('aria-labelledby', trigger.getAttribute('id'))
      expect(await within(panel).findByTestId(row)).toBeInTheDocument()
    }
  })
})

describe('내 작업 묶음 목록(WP-916)', () => {
  // 레이블은 2개만 보이고 나머지는 +3.
  test('레이블은 2개 + +3', async () => {
    renderMyTasks('/me/tasks/assigned')
    const meta = await screen.findByTestId('assigned-row-52-labels')
    expect(within(meta).getAllByText(/^레이블\d$/)).toHaveLength(2)
    expect(meta).toHaveTextContent('+3')
  })

  // 프로젝트 머리 줄은 이름·서버 건수(projectGroup.size), 두 페이지에 걸쳐도 한 번만, 겹친 행(53)도 한 번만.
  test('프로젝트 머리 줄은 이름·서버 건수를 보이고 두 페이지에 이어져도 한 번만', async () => {
    // 목록 끝 sentinel 이 곧바로 보인다고 알리는 IntersectionObserver — jsdom 은 교차를 재지 않으므로 「끝에 닿음」을 흉내 낸다.
    vi.stubGlobal('IntersectionObserver', class {
      private cb: IntersectionObserverCallback
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb
      }
      observe(el: Element) {
        queueMicrotask(() => this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this as unknown as IntersectionObserver))
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    })
    try {
      renderMyTasks('/me/tasks/assigned', (sp) =>
        sp.get('cursor')
          ? createIssueSearchResponse([
              createIssue({ id: 53, projectKey: 'EX', number: 53, title: '짧은 제목', projectGroup: EX }),
              createIssue({ id: 54, projectKey: 'EX', number: 54, title: '2페이지 이슈', projectGroup: EX }),
              createIssue({ id: 61, projectKey: 'OPS', number: 61, title: '운영 이슈', projectGroup: OPS }),
            ])
          : createIssueSearchResponse(twoProjectItems().slice(0, 2), 'g1:opaque'),
      )
      await screen.findByTestId('assigned-row-54')
      expect(document.querySelectorAll('[data-testid$="-project-EX-head"]')).toHaveLength(1)
      expect(screen.getByTestId('assigned-row-project-EX-head-name')).toHaveTextContent(/^외부 연동 프로젝트$/)
      expect(screen.getByTestId('assigned-row-project-EX-head-count')).toHaveTextContent(/^EX · 7$/)
      expect(screen.getAllByTestId('assigned-row-53')).toHaveLength(1)
      expect(within(screen.getByTestId('assigned-row-project-OPS')).getByTestId('assigned-row-61')).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  // 행 빈 곳(마감 칸)을 누르면 이슈 상세로 간다.
  test('행 빈 곳을 누르면 상세로 간다', async () => {
    const { user, location } = renderMyTasks('/me/tasks/assigned')
    await user.click(await screen.findByTestId('assigned-row-52-due'))
    await waitFor(() => expect(location()).toMatch(/^\/projects\/EX\/issues\/52/))
  })

  // 마감 지남은 빨강 + 「마감 지남」(sr-only), 완료 행은 지나도 아니다. 기준 시각 고정.
  test('마감 지남은 빨강·sr-only, 완료 행은 아니다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-24T10:00:00'))
    renderMyTasks('/me/tasks/assigned', () =>
      createIssueSearchResponse([
        createIssue({ id: 71, projectKey: 'EX', number: 71, title: '지난 마감', dueDate: '2026-10-20', projectGroup: EX }),
        createIssue({ id: 72, projectKey: 'EX', number: 72, title: '끝난 일', status: 'DONE', dueDate: '2026-10-20', projectGroup: EX }),
      ]),
    )
    const overdue = await screen.findByTestId('assigned-row-71-due')
    expect(overdue).toHaveClass('text-destructive')
    expect(overdue).toHaveTextContent('10월 20일')
    expect(overdue).toHaveTextContent('마감 지남')
    const done = screen.getByTestId('assigned-row-72-due')
    expect(done).not.toHaveClass('text-destructive')
    expect(done).not.toHaveTextContent('마감 지남')
  })

  // 「완료 모두 보기」 토글 → closed=all 주소, 눌림 표시, hideClosed 없이 group=due 로 다시 조회.
  test('완료 모두 보기를 켜면 closed=all 과 hideClosed 없이 다시 부른다', async () => {
    const { user, location, seen } = renderMyTasks('/me/tasks/assigned')
    await screen.findByTestId('assigned-row-52')
    const toggle = screen.getByTestId('show-all-closed-toggle')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(toggle)
    await waitFor(() => expect(location()).toMatch(/closed=all/))
    expect(screen.getByTestId('show-all-closed-toggle')).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(seen.at(-1)?.get('hideClosed')).toBeNull())
    expect(seen.at(-1)?.get('group')).toBe('due')
  })

  // 상태=완료 필터는 숨김을 풀고(hideClosed 없음) 완료 행을 보이며, 토글은 비활성.
  test('할당 탭 상태=완료 필터는 숨김을 풀어 완료 행을 보인다', async () => {
    const done = createIssue({ id: 81, projectKey: 'EX', number: 81, title: '완료한 일', status: 'DONE', projectGroup: EX })
    const { seen } = renderMyTasks('/me/tasks/assigned?status=DONE', (sp) => createIssueSearchResponse(sp.get('hideClosed') === 'true' ? [] : [done]))
    expect(await screen.findByTestId('assigned-row-81')).toBeInTheDocument()
    expect(seen.at(-1)?.get('status')).toBe('DONE')
    expect(seen.at(-1)?.get('hideClosed')).toBeNull()
    expect(screen.getByTestId('show-all-closed-toggle')).toBeDisabled()
  })

  test('내가 만든 탭에는 완료 모두 보기 토글이 없다', async () => {
    renderMyTasks('/me/tasks/reported')
    await screen.findByTestId('reported-row-52')
    expect(screen.queryByTestId('show-all-closed-toggle')).not.toBeInTheDocument()
  })
})

describe('내 작업 상태 화면(WP-916)', () => {
  // 첫 페이지 500 → 실패 안내 + 다시 시도(빈 상태 아님), 다시 시도 성공이면 행이 그려지고 안내가 사라진다.
  test('첫 페이지 500이면 실패 안내와 다시 시도, 빈 상태가 아니다', async () => {
    let failing = true
    const { user } = renderMyTasks('/me/tasks/assigned', () =>
      failing ? HttpResponse.json({ message: '서버 오류' }, { status: 500 }) : createIssueSearchResponse(twoProjectItems()),
    )
    const error = await screen.findByTestId('assigned-row-error')
    expect(error).toHaveTextContent('작업을 불러오지 못했습니다')
    expect(screen.queryByTestId('assigned-row-empty')).not.toBeInTheDocument()
    failing = false
    await user.click(screen.getByTestId('assigned-row-error-retry'))
    expect(await screen.findByTestId('assigned-row-52')).toBeInTheDocument()
    expect(screen.queryByTestId('assigned-row-error')).not.toBeInTheDocument()
  })

  // 응답 전에는 스켈레톤(aria-busy), 응답 뒤엔 사라진다.
  test('불러오는 동안 스켈레톤', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    renderMyTasks('/me/tasks/assigned', async () => {
      await gate
      return createIssueSearchResponse(twoProjectItems())
    })
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull())
    release()
    expect(await screen.findByTestId('assigned-row-52')).toBeInTheDocument()
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
  })

  // 필터 0건(완료 숨김 아님: status 지정) → 조건 문구 + 초기화, 누르면 status·priority 가 주소에서 빠지고 목록이 돌아온다.
  test('필터 0건은 초기화 버튼, 누르면 status 쿼리가 사라진다', async () => {
    const { user, location } = renderMyTasks('/me/tasks/assigned?status=IN_PROGRESS&priority=HIGH', (sp) =>
      createIssueSearchResponse(sp.get('status') ? [] : twoProjectItems()),
    )
    const empty = await screen.findByTestId('assigned-row-empty')
    expect(empty).toHaveTextContent('조건에 맞는 작업이 없습니다')
    expect(empty).toHaveTextContent('할당된 작업은 있지만 필터에 걸러졌습니다')
    await user.click(screen.getByTestId('assigned-row-empty-reset'))
    await waitFor(() => expect(location()).toBe('/me/tasks/assigned'))
    expect(await screen.findByTestId('assigned-row-52')).toBeInTheDocument()
  })

  // WP-941: 완료 숨김 중 필터 0건 → 숨김 안내 + 「완료 모두 보기」, 누르면 필터는 두고 closed=all·hideClosed 없음.
  test('완료 숨김 중 필터 0건은 숨김 안내와 「완료 모두 보기」, 누르면 필터는 남기고 hideClosed 를 뺀다', async () => {
    const { user, location, seen } = renderMyTasks('/me/tasks/assigned?priority=HIGH', (sp) =>
      createIssueSearchResponse(sp.get('hideClosed') ? [] : twoProjectItems()),
    )
    const empty = await screen.findByTestId('assigned-row-empty')
    expect(empty).toHaveTextContent('조건에 맞는 작업이 없습니다')
    expect(empty).toHaveTextContent('완료·취소한 작업은 숨겨져 있습니다')
    expect(screen.getByTestId('assigned-row-empty-reset')).toBeInTheDocument()
    await user.click(screen.getByTestId('assigned-row-empty-show-closed'))
    await waitFor(() => expect(search(location()).get('closed')).toBe('all'))
    expect(search(location()).get('priority')).toBe('HIGH')
    await waitFor(() => expect(seen.at(-1)?.get('hideClosed')).toBeNull())
    expect(seen.at(-1)?.get('priority')).toBe('HIGH')
    expect(await screen.findByTestId('assigned-row-52')).toBeInTheDocument()
  })

  test('상태 필터로 0건이면 숨김이 꺼져 있어 「완료 모두 보기」를 주지 않는다', async () => {
    renderMyTasks('/me/tasks/assigned?status=DONE', () => createIssueSearchResponse([]))
    const empty = await screen.findByTestId('assigned-row-empty')
    expect(empty).toHaveTextContent('할당된 작업은 있지만 필터에 걸러졌습니다')
    expect(empty).not.toHaveTextContent('숨겨져 있습니다')
    expect(screen.getByTestId('assigned-row-empty-reset')).toBeInTheDocument()
    expect(screen.queryByTestId('assigned-row-empty-show-closed')).not.toBeInTheDocument()
  })

  test('내가 만든 탭의 필터 0건 설명은 내가 만든 작업 문구다', async () => {
    renderMyTasks('/me/tasks/reported?status=DONE', () => createIssueSearchResponse([]))
    expect(await screen.findByTestId('reported-row-empty')).toHaveTextContent('내가 만든 작업은 있지만 필터에 걸러졌습니다')
  })

  // 데이터 없음(필터 없음) → 「완료 모두 보기」 안내(초기화 없음), 누르면 closed=all·hideClosed 없이 다시 조회.
  test('데이터 없음(필터 없음)은 「완료 모두 보기」 안내', async () => {
    const { user, location, seen } = renderMyTasks('/me/tasks/assigned', () => createIssueSearchResponse([]))
    const empty = await screen.findByTestId('assigned-row-empty')
    expect(empty).toHaveTextContent('할당된 작업이 없습니다')
    expect(empty).toHaveTextContent('완료한 작업은 「완료 모두 보기」로 볼 수 있습니다')
    expect(screen.queryByTestId('assigned-row-empty-reset')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('assigned-row-empty-show-closed'))
    await waitFor(() => expect(location()).toMatch(/closed=all/))
    await waitFor(() => expect(seen.at(-1)?.get('hideClosed')).toBeNull())
  })
})

describe('내 작업 구독 탭', () => {
  // WP-916: 구독 탭은 group=recent 로 부르고, 남의 이슈가 섞이므로 담당자 열과 프로젝트 머리 줄을 둔다.
  test('구독 탭은 group=recent 로 부르고 담당자 열·행·프로젝트 머리가 있다', async () => {
    const { seenWatched } = renderMyTasks('/me/tasks/watched', undefined, () =>
      createIssueSearchResponse([
        createIssue({
          id: 5, projectKey: 'EX', number: 5, title: '구독한 이슈',
          assignees: [{ id: 7, username: 'kim', name: '김담당', kind: 'HUMAN' }],
          projectGroup: { name: '외부 연동 프로젝트', size: 1 },
        }),
      ]),
    )
    expect(await screen.findByTestId('watched-row-5')).toHaveTextContent('구독한 이슈')
    expect(seenWatched[0].get('group')).toBe('recent')
    expect(screen.getAllByRole('columnheader', { name: '담당자' })).toHaveLength(1)
    expect(screen.getByTestId('watched-row-project-EX-head-name')).toHaveTextContent(/^외부 연동 프로젝트$/)
  })

  test('구독 중인 작업이 없으면 빈 메시지를 표시한다', async () => {
    renderMyTasks('/me/tasks/watched')
    expect(await screen.findByTestId('watched-row-empty')).toHaveTextContent('구독 중인 작업이 없습니다')
  })
})
