// 이슈 목록 「사이클」 그룹(#878) — 화면 테스트(WP-980, WP-1002 에서 목록 화면(ProjectDetailPage)만 띄우게 바꿈).
// 구간별 요청 파라미터, 접힘/펼침 지연 요청, 그룹 전환·저장 뷰 하위호환, M:N 중복 표시와 선택 공유·일괄 작업, 로딩·빈 구간 문구는
// 브라우저 없이 판정되므로 e2e/pages/projects/issue-list-cycle-group.spec.ts 에서 옮겼다.
// 기본 사이클 그룹 진입(@wiring)·스크롤해 체크해도 일괄 바가 보임(@layout)·구간 끝 자동 로드(@layout)는 E2E 에 남는다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { API, bodyOf, expectToggleLook, issueSearch, KEY, projectMeta } from '@/test/kits/projects/listBoard'
import { renderProjectScreen } from '@/test/kits/projects/projectDetailScreen'
import type { ScreenUser } from '@/test/renderScreen'
import type { CycleProgress, CycleResponse } from '@/types/cycle'
import type { IssueResponse } from '@/types/issue'
import type { SavedViewResponse } from '@/types/savedView'

import { createIssue } from '../../../e2e/factories/issue.factory'
import { createMember } from '../../../e2e/factories/project.factory'

function cycle(overrides: Partial<CycleResponse>): CycleResponse {
  return { id: 1, projectId: 1, name: '스프린트', goal: null, startDate: null, endDate: null, status: 'ACTIVE', createdAt: '', updatedAt: '', ...overrides }
}

// 진행 중 2개, 예정 2개(미정 포함), 완료 1개 — E2E 와 같은 데이터.
const CYCLES: CycleResponse[] = [
  cycle({ id: 1, name: '스프린트 12', status: 'ACTIVE', startDate: '2026-09-21', endDate: '2026-10-03', goal: '결제 개편' }),
  cycle({ id: 2, name: '핫픽스 주간', status: 'ACTIVE', startDate: '2026-09-10', endDate: '2026-09-28' }),
  cycle({ id: 3, name: '스프린트 13', status: 'PLANNED', startDate: '2026-10-06', endDate: '2026-10-17' }),
  cycle({ id: 4, name: '미정 스프린트', status: 'PLANNED' }),
  cycle({ id: 5, name: '스프린트 11', status: 'COMPLETED', startDate: '2026-09-01', endDate: '2026-09-14' }),
]
const PROGRESS: CycleProgress[] = [
  { cycleId: 1, total: 3, done: 1, byStatus: { DONE: 1, TODO: 2 } },
  { cycleId: 2, total: 2, done: 0, byStatus: { TODO: 2 } },
  { cycleId: 3, total: 1, done: 0, byStatus: { TODO: 1 } },
  // 미정 스프린트 — 행(상위 작업)은 0 인데 하위 이슈 2건이 있는 경우.
  { cycleId: 4, total: 2, done: 0, byStatus: { TODO: 2 } },
]
// 구간별 이슈 — #11 은 스프린트 12·핫픽스 주간 두 사이클에 모두 속한다(M:N).
const ISSUES_BY_CYCLE: Record<string, IssueResponse[]> = {
  '1': [createIssue({ id: 11, number: 11, title: '결제 모듈 리팩터링' }), createIssue({ id: 12, number: 12, title: '결제 실패 알림', status: 'DONE' })],
  '2': [createIssue({ id: 21, number: 21, title: '로그인 오류 수정' }), createIssue({ id: 11, number: 11, title: '결제 모듈 리팩터링' })],
  '3': [createIssue({ id: 31, number: 31, title: '다음 스프린트 작업' })],
  '4': [],
  '5': [createIssue({ id: 51, number: 51, title: '지난 스프린트 작업', status: 'DONE' })],
  null: [createIssue({ id: 41, number: 41, title: '백로그 작업' })],
}
const FLAT_ISSUES = [createIssue({ id: 90, number: 90, title: '평면 목록 이슈' })]

// 오늘 고정(2026-09-30) — 사이클 구간 판정이 날짜를 읽는다. Date 만 바꿔 타이머·MSW 는 그대로 돈다.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 30, 10, 0))
})
afterEach(() => vi.useRealTimers())

type Options = {
  savedViews?: SavedViewResponse[]
  backlog?: IssueResponse[]
  /** 사이클 목록 응답을 늦추는 약속 — cyclesGate() 반환의 held. */
  cyclesGate?: Promise<void>
}

/** 사이클 응답 게이트 — release 를 부르기 전까지 /cycles 응답을 멈춰 판정 대기 상태를 만든다(issueListPendingGroup.test.tsx 와 같은 패턴). */
function cyclesGate() {
  let release: () => void = () => {}
  const held = new Promise<void>((r) => (release = r))
  return { held, release }
}

/** 공통 목 — 이슈 검색 URL·저장 뷰 POST·상태 PATCH·진행률 조회 수를 기록한다. */
function setup({ savedViews = [], backlog, cyclesGate }: Options = {}) {
  const views = [...savedViews]
  const viewPosts: { query: string }[] = []
  const statusPatches: number[] = []
  let progressGets = 0
  const search = issueSearch((url) => {
    const c = url.searchParams.get('cycle')
    if (c == null) return FLAT_ISSUES
    if (c === 'null' && backlog) return backlog
    return ISSUES_BY_CYCLE[c] ?? []
  })
  const handlers = [
    ...projectMeta([createMember({ userId: 10, name: '김개발', username: 'kim' })]),
    http.get(`${API}/projects/${KEY}/views`, () => HttpResponse.json([])),
    http.get(`${API}/projects/${KEY}/cycles`, async () => {
      if (cyclesGate) await cyclesGate
      return HttpResponse.json(CYCLES)
    }),
    http.get(`${API}/projects/${KEY}/cycles/progress`, () => {
      progressGets++
      return HttpResponse.json(PROGRESS)
    }),
    http.get(`${API}/projects/${KEY}/saved-views`, () => HttpResponse.json(views)),
    http.post(`${API}/projects/${KEY}/saved-views`, async ({ request }) => {
      const body = (await bodyOf(request)) as { name: string; query: string; visibility: SavedViewResponse['visibility'] }
      viewPosts.push(body)
      const created: SavedViewResponse = { id: views.length + 100, name: body.name, query: body.query, visibility: body.visibility, ownerId: 1, mine: true, pinned: false, createdAt: '', updatedAt: '' }
      views.push(created)
      return HttpResponse.json(created, { status: 201 })
    }),
    http.patch(`${API}/projects/${KEY}/issues/:num/status`, ({ params }) => {
      statusPatches.push(Number(params.num))
      return HttpResponse.json(createIssue({ number: Number(params.num), status: 'DONE' }))
    }),
    search.handler,
  ]
  return { handlers, params: () => search.urls.map((u) => u.searchParams), viewPosts, statusPatches, progressGets: () => progressGets }
}

const section = (key: string) => screen.getByTestId(`list-cycle-section-${key}`)

async function open(path = `/projects/${KEY}`, opts: Options = {}) {
  const api = setup(opts)
  const page = renderProjectScreen(path, { handlers: api.handlers })
  await waitFor(() => expect(within(section('backlog')).getAllByTestId(/^issue-row-/).length).toBeGreaterThan(0))
  return { ...page, api }
}

/**
 * 그룹 셀렉트(Radix Select)에서 값을 고른다 — jsdom 은 포인터 캡처가 없어 마우스로 열면 던지므로 키보드로 열고 고른다.
 */
async function chooseGroup(user: ScreenUser, value: string) {
  screen.getByTestId('group-by-trigger').focus()
  await user.keyboard('{Enter}')
  ;(await screen.findByTestId(`group-by-${value}`)).focus()
  await user.keyboard('{Enter}')
}

describe('이슈 목록 사이클 그룹 (#878)', () => {
  test('구간별 요청 파라미터 — 사이클 구간은 종료 이슈 포함, 백로그는 cycle=null + 미종료 스코프', async () => {
    // WP-1929 — 사이클 응답을 게이트로 묶어 두고, 판정 전에 평면 프리페치가 이미 나가는지 먼저 고정한다.
    // 게이트 해제 전 단언이 없으면 「목록이 필터 메타데이터를 기다렸다가 발사하는」 회귀(바로잡은 그 버그)가 통과해 버린다.
    const gate = cyclesGate()
    const api = setup({ cyclesGate: gate.held })
    renderProjectScreen(`/projects/${KEY}`, { handlers: api.handlers })
    // WP-1929 리뷰 반려 — 판정 전엔 스켈레톤(행이 아직 없다). 발사는 스켈레톤과 무관하게 게이트 위에서 이미 끝났음을
    // 아래 flat 요청 카운트로 증명한다.
    expect(await screen.findByTestId('issue-list-pending')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-row-90')).not.toBeInTheDocument()
    await waitFor(() => expect(api.params().filter((p) => !p.has('cycle'))).toHaveLength(1))
    gate.release()
    await waitFor(() => expect(within(section('backlog')).getAllByTestId(/^issue-row-/).length).toBeGreaterThan(0))

    const backlog = api.params().find((p) => p.get('cycle') === 'null')
    expect(backlog?.get('hideInactiveClosed')).toBe('true')
    expect(backlog?.get('excludeEpics')).toBe('true')
    expect(backlog?.get('excludeSubtasks')).toBe('true')
    expect(backlog?.get('status')).toBeNull()

    const active = api.params().find((p) => p.get('cycle') === '1')
    expect(active?.get('hideInactiveClosed')).toBeNull()
    expect(active?.get('excludeEpics')).toBe('true')
    expect(active?.get('excludeSubtasks')).toBe('true')
    // WP-1929 — 사이클 판정 전에 이미 발사한 평면 프리페치 1건은 허용, 그 뒤 중복 평면 요청은 금지.
    // (옛 불변식 « 평면 목록 요청은 아예 나가지 않는다 » 는 「게이트 위 즉시 발사」 와 양립 불가라 새 불변식으로 갱신)
    const flat = api.params().filter((p) => !p.has('cycle'))
    expect(flat).toHaveLength(1)
  })

  test('예정 구간은 접혀 있고 펼칠 때 요청한다 — 다시 접으면 행이 사라지고, 빈 구간은 하위 이슈 안내', async () => {
    const { user, api } = await open()
    expect(api.params().some((p) => p.get('cycle') === '3')).toBe(false)
    expect(screen.getByTestId('list-cycle-toggle-cycle-3')).toHaveAttribute('aria-expanded', 'false')

    await user.click(screen.getByTestId('list-cycle-toggle-cycle-3'))
    await waitFor(() => expect(api.params().some((p) => p.get('cycle') === '3')).toBe(true))
    expect(screen.getByTestId('list-cycle-toggle-cycle-3')).toHaveAttribute('aria-expanded', 'true')
    expect(await within(section('cycle-3')).findByTestId('issue-row-31')).toBeInTheDocument()

    await user.click(screen.getByTestId('list-cycle-toggle-cycle-3'))
    await waitFor(() => expect(within(section('cycle-3')).queryByTestId('issue-row-31')).not.toBeInTheDocument())

    // 상위 작업 0행 + 진행률 total 2 → 하위 이슈 안내.
    await user.click(screen.getByTestId('list-cycle-toggle-cycle-4'))
    expect(await screen.findByTestId('list-cycle-empty-cycle-4')).toHaveTextContent('표시할 상위 작업이 없습니다 (하위 이슈 2건 포함)')
  })

  test('그룹 메뉴에서 없음 ↔ 사이클 전환이 URL 에 반영된다', async () => {
    const { user, location } = await open()
    await chooseGroup(user, 'none')
    await waitFor(() => expect(location()).toMatch(/group=none/))
    expect(await screen.findByTestId('issue-row-90')).toBeInTheDocument()
    expect(screen.queryByTestId('list-cycle-section-backlog')).not.toBeInTheDocument()

    await chooseGroup(user, 'cycle')
    await waitFor(() => expect(location()).toMatch(/group=cycle/))
    expect(await screen.findByTestId('list-cycle-section-backlog')).toBeInTheDocument()
  })

  test('group 없는 저장 뷰를 적용하면 그룹 없음(평면)으로 열리고 칩이 활성', async () => {
    const savedViews: SavedViewResponse[] = [
      { id: 7, name: '높은 우선순위', query: 'priority=HIGH', visibility: 'PRIVATE', ownerId: 1, mine: true, pinned: false, createdAt: '', updatedAt: '' },
    ]
    const { user, location } = await open(`/projects/${KEY}`, { savedViews })
    await user.click(await screen.findByTestId('view-chip-7'))
    await waitFor(() => expect(location()).toMatch(/group=none/))
    expect(location()).toMatch(/priority=HIGH/)
    expect(await screen.findByTestId('issue-row-90')).toBeInTheDocument()
    expect(screen.queryAllByTestId(/^list-cycle-section-/)).toHaveLength(0)
    expect(screen.getByTestId('view-chip-7')).toHaveClass('font-medium')
    // WP-368 — 활성 칩은 켜짐 모양, 비활성 「전체」 칩엔 없다.
    expectToggleLook(screen.getByTestId('view-chip-7'), true)
    expectToggleLook(screen.getByTestId('view-chip-all'), false)
    // 적용 직후는 저장된 뷰와 일치 — 「뷰 업데이트」가 뜨지 않는다.
    expect(screen.queryByTestId('update-view-button')).not.toBeInTheDocument()
  })

  test('기본 사이클 그룹 화면을 저장하면 group=cycle 이 명시 저장된다', async () => {
    const { user, api } = await open(`/projects/${KEY}?priority=HIGH`)
    await user.click(screen.getByTestId('save-view-button'))
    await user.click(await screen.findByTestId('save-view-name'))
    await user.paste('사이클 HIGH')
    await user.click(screen.getByTestId('save-view-submit'))
    await waitFor(() => expect(api.viewPosts).toHaveLength(1))
    const query = new URLSearchParams(api.viewPosts[0].query)
    expect(query.get('group')).toBe('cycle')
    expect(query.get('priority')).toBe('HIGH')
  })

  test('M:N — 두 사이클에 속한 이슈는 두 구간 모두에 보이고 선택을 공유한다 + 일괄 상태 변경 뒤 진행률 재조회', async () => {
    const { user, api, location } = await open()
    const inActive = await within(section('cycle-1')).findByTestId('select-issue-11')
    const inHotfix = await within(section('cycle-2')).findByTestId('select-issue-11')

    await user.click(inActive)
    expect(inHotfix).toBeChecked()
    expect(screen.getByTestId('issue-bulk-toolbar')).toHaveTextContent('선택 1개')

    // 다른 구간 선택을 더한다. 구간 헤더엔 체크박스가 없다 — 사이클이 이슈 선택으로 오인되지 않게(#881).
    await user.click(within(section('cycle-2')).getByTestId('select-issue-21'))
    expect(within(screen.getByTestId('list-cycle-header-backlog')).queryByRole('checkbox')).not.toBeInTheDocument()
    await user.click(within(section('backlog')).getByTestId('select-issue-41'))
    expect(screen.getByTestId('issue-bulk-toolbar')).toHaveTextContent('선택 3개')
    expect(location()).toBe(`/projects/${KEY}/issues`)

    const progressBefore = api.progressGets()
    await user.click(screen.getByTestId('bulk-status-trigger'))
    await user.click(await screen.findByTestId('bulk-status-option-3'))
    await waitFor(() => expect([...api.statusPatches].sort((a, b) => a - b)).toEqual([11, 21, 41]))
    await waitFor(() => expect(screen.queryByTestId('issue-bulk-toolbar')).not.toBeInTheDocument())
    await waitFor(() => expect(api.progressGets()).toBeGreaterThan(progressBefore))
  })

  test('로딩 중엔 평면 목록을 띄우지 않고 스켈레톤을 보인다', async () => {
    const gate = cyclesGate()
    const api = setup({ cyclesGate: gate.held })
    renderProjectScreen(`/projects/${KEY}`, { handlers: api.handlers })
    // 판정 대기 동안엔 스켈레톤 — 평면 행이 잠깐 뜨지 않는다(#878 복원, WP-1929 리뷰 반려).
    expect(await screen.findByTestId('issue-list-pending')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-row-90')).not.toBeInTheDocument()
    // WP-1929 — 스켈레톤이 목록 쿼리를 막지는 않는다: 판정 전에 평면 프리페치 1건이 이미 발사돼 있어야 한다.
    // 게이트를 연 뒤에만 세면 사이클 판정 후 발사하는 회귀도 flat===1 로 통과해 버린다.
    await waitFor(() => expect(api.params().filter((p) => !p.has('cycle'))).toHaveLength(1))
    gate.release()
    expect(await screen.findByTestId('list-cycle-section-backlog')).toBeInTheDocument()
    // 판정 전에 발사한 평면 프리페치 1건은 허용, 그 뒤 중복 평면 요청은 금지.
    const flat = api.params().filter((p) => !p.has('cycle'))
    expect(flat).toHaveLength(1)
  })

  // WP-1929 리뷰 Important 1 — 사이클 그룹에선 평면 페이지를 그리지 않으므로 평면 옵저버가 살아 있으면
  // 필터·검색 변경마다 안 보이는 평면(size=30·cycle 없음) 요청이 하나씩 더 나간다(이 브랜치 이전 동작).
  test('기본 사이클 그룹에서 검색어를 바꿔도 평면 요청(size=30·cycle 없음)은 추가로 나가지 않는다 (WP-1929)', async () => {
    const { location, api } = await open()
    // 판정 대기 동안 발사한 평면 프리페치 1건 — 여기까진 기존 불변식 그대로다.
    await waitFor(() => expect(api.params().filter((p) => !p.has('cycle') && p.get('size') === '30')).toHaveLength(1))

    // 필터 변경 — 검색어(debounce) 하나만 바꾼다. 구간 쿼리는 새 필터로 다시 나가야 바뀐 게 확인된다.
    const box = await screen.findByLabelText('이슈 필터: 제목·키')
    fireEvent.change(box, { target: { value: 'login' } })
    await waitFor(() => expect(location()).toMatch(/q=login/))
    await waitFor(() => expect(api.params().some((p) => p.has('cycle') && p.get('q') === 'login')).toBe(true))
    // 새 필터의 구간 요청은 왔는데, 평면 요청은 프리페치 1건 그대로 — 사이클 그룹에선 평면 페이지를 그리지 않는다.
    expect(api.params().filter((p) => !p.has('cycle') && p.get('size') === '30')).toHaveLength(1)
  })

  test('명시 ?group=cycle 진입에선 평면 요청이 아예 나가지 않는다 — 필터를 바꿔도 (WP-1929)', async () => {
    const { location, api } = await open(`/projects/${KEY}?group=cycle`)
    // 명시 group=cycle 은 판정이 처음부터 확정이라(pending 없음) 평면 프리페치 자체가 없다.
    const box = await screen.findByLabelText('이슈 필터: 제목·키')
    fireEvent.change(box, { target: { value: 'login' } })
    await waitFor(() => expect(location()).toMatch(/q=login/))
    // 구간 쿼리가 새 필터로 나온 뒤에 세면, 진입 시점의 느린 평면 응답까지 잡아 잴 수 있다.
    await waitFor(() => expect(api.params().some((p) => p.has('cycle') && p.get('q') === 'login')).toBe(true))
    expect(api.params().filter((p) => !p.has('cycle') && p.get('size') === '30')).toHaveLength(0)
  })

  test('백로그 = 진행 중·예정 사이클 밖 — 완료 사이클에만 속한 미완료 이슈도 백로그 요청(cycle=null)으로 뜬다', async () => {
    const { api } = await open(`/projects/${KEY}`, {
      backlog: [createIssue({ id: 52, number: 52, title: '끝난 스프린트에서 넘어온 작업' })],
    })
    expect(within(section('backlog')).getByTestId('issue-row-52')).toHaveTextContent('끝난 스프린트에서 넘어온 작업')
    // 완료 사이클 구간은 없고 요청도 하지 않는다.
    expect(screen.queryByTestId('list-cycle-section-cycle-5')).not.toBeInTheDocument()
    expect(api.params().some((p) => p.get('cycle') === '5')).toBe(false)
  })

  test('위 구간에 이슈가 더 있으면 「더 보기」가 전체 건수 중 표시 건수를, 백로그 헤더가 정확한 건수를 보인다 (WP-1231)', async () => {
    const api = setup()
    const countParams: URLSearchParams[] = []
    // 사이클 1·백로그는 다음 페이지가 남은 첫 페이지 — 전체 수는 group-counts(우선순위별)의 합으로 센다.
    const paged = http.get(`${API}/projects/${KEY}/issues`, ({ request }) => {
      const c = new URL(request.url).searchParams.get('cycle')
      if (c !== '1' && c !== 'null') return undefined
      const items = c === '1' ? ISSUES_BY_CYCLE['1'] : ISSUES_BY_CYCLE['null']
      return HttpResponse.json({ items, nextCursor: 'next', hasMore: true })
    })
    const counts = http.get(`${API}/projects/${KEY}/issues/group-counts`, ({ request }) => {
      const params = new URL(request.url).searchParams
      countParams.push(params)
      const groups = params.get('cycle') === '1'
        ? [{ key: 'HIGH', count: 5 }, { key: null, count: 2 }]
        : [{ key: 'MID', count: 30 }]
      return HttpResponse.json({ groupBy: params.get('groupBy'), groups })
    })
    renderProjectScreen(`/projects/${KEY}`, { handlers: [paged, counts, ...api.handlers] })

    const more = await screen.findByTestId('list-cycle-more-cycle-1')
    await waitFor(() => expect(more).toHaveTextContent('전체 7건 중 2건 표시'))
    expect(within(more).getByRole('button', { name: /이 구간 이슈 더 보기/ })).toBeInTheDocument()
    // 백로그 헤더 — 「1+건」 대신 같은 필터로 센 정확한 수.
    await waitFor(() => expect(screen.getByTestId('list-cycle-count-backlog')).toHaveTextContent('30건'))
    // 총계는 구간 검색과 같은 필터로 센다 — 사이클 구간은 cycle=1, 백로그는 cycle=null.
    expect(countParams.map((p) => p.get('cycle'))).toEqual(expect.arrayContaining(['1', 'null']))
    expect(countParams.every((p) => p.get('groupBy') === 'priority')).toBe(true)
  })

  test('빈 백로그 문구는 새 정의(진행 중·예정 사이클 밖)를 따른다', async () => {
    const api = setup({ backlog: [] })
    renderProjectScreen(`/projects/${KEY}`, { handlers: api.handlers })
    expect(await screen.findByTestId('list-cycle-empty-backlog')).toHaveTextContent(
      '진행 중·예정 사이클에 없는 미완료 이슈가 없습니다',
    )
  })
})

// WP-2070 — sticky 일괄 작업 바 표지(data-sticky-bulk-bar). 슬롯의 scroll-padding(:has) 이 바 높이만큼 위 여백을 줘 Shift+Tab 초점이 바 뒤로 가려지지 않게 하는 근거다.
// 기하는 E2E(@layout·@input)가 보고, 모바일은 뷰포트가 달라 IssueCycleGroupedList.stickyBar.mobile.test.tsx 에서 본다.
describe('사이클 구간 sticky 바 표지 (WP-2070)', () => {
  const marker = () => document.querySelector('[data-sticky-bulk-bar]')

  test('sticky 바 표지는 데스크톱에서 선택이 있을 때만 달린다', async () => {
    const { user } = await open(`/projects/${KEY}?group=cycle`)
    expect(marker()).toBeNull()

    await user.click(await within(section('cycle-1')).findByTestId('select-issue-11'))
    await waitFor(() => expect(marker()).not.toBeNull())

    await user.click(screen.getByTestId('bulk-clear'))
    await waitFor(() => expect(marker()).toBeNull())
  })
})

// WP-1238: 사이클 구간 목록(사이클이 있는 팀의 기본 목록)도 열 머리 정렬이 된다 — 위에 한 번 보이는 머리만 단추이고, 구간 쿼리마다 정렬이 실린다.
describe('사이클 구간 목록 정렬 (WP-1238)', () => {
  test('「담당자」 머리를 누르면 모든 구간 요청에 sort=assignee&direction=asc 가 실리고, 단추는 보이는 머리 하나뿐이다', async () => {
    const { user, api, location } = await open()
    const heads = screen.getAllByTestId('issue-sort-head-assignee')
    expect(heads).toHaveLength(1)
    const before = api.params().length
    await user.click(heads[0])
    await waitFor(() => expect(location()).toMatch(/sort=assignee&direction=asc/))
    await waitFor(() => expect(api.params().slice(before).some((p) => p.get('cycle') === 'null' && p.get('sort') === 'assignee')).toBe(true))
    const sectionReqs = api.params().slice(before).filter((p) => p.has('cycle'))
    expect(sectionReqs.length).toBeGreaterThan(0)
    expect(sectionReqs.every((p) => p.get('sort') === 'assignee' && p.get('direction') === 'asc')).toBe(true)
    expect(heads[0].closest('th')).toHaveAttribute('aria-sort', 'ascending')
  })

  test('보이는 열 머리는 보조기기에서 숨기지 않는다 — 초점이 가는 정렬 단추가 읽힌다(aria-hidden-focus 방지)', async () => {
    await open()
    const head = screen.getByTestId('list-cycle-column-head')
    expect(head.closest('[aria-hidden="true"]')).toBeNull()
    const table = screen.getByRole('table', { name: '열 정렬' })
    expect(within(table).getByRole('button', { name: '담당자' })).toBeInTheDocument()
  })

  test('정렬만 바꾸면 일괄 선택이 남는다', async () => {
    const { user, location } = await open()
    await user.click(await within(section('backlog')).findByTestId('select-issue-41'))
    expect(screen.getByTestId('issue-bulk-toolbar')).toHaveTextContent('선택 1개')
    await user.click(screen.getByTestId('issue-sort-head-dueDate'))
    await waitFor(() => expect(location()).toMatch(/sort=dueDate/))
    expect(screen.getByTestId('issue-bulk-toolbar')).toHaveTextContent('선택 1개')
  })
})
