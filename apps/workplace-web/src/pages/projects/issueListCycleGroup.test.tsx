// 이슈 목록 「사이클」 그룹(#878) — 화면 테스트(WP-980, WP-1002 에서 목록 화면(ProjectDetailPage)만 띄우게 바꿈).
// 구간별 요청 파라미터, 접힘/펼침 지연 요청, 그룹 전환·저장 뷰 하위호환, M:N 중복 표시와 선택 공유·일괄 작업, 로딩·빈 구간 문구는
// 브라우저 없이 판정되므로 e2e/pages/projects/issue-list-cycle-group.spec.ts 에서 옮겼다.
// 기본 사이클 그룹 진입(@wiring)·스크롤해 체크해도 일괄 바가 보임(@layout)·구간 끝 자동 로드(@layout)는 E2E 에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
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
  /** 사이클 목록 응답을 늦추는 약속. */
  cyclesGate?: Promise<void>
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
    const { api } = await open()
    const backlog = api.params().find((p) => p.get('cycle') === 'null')
    expect(backlog?.get('hideInactiveClosed')).toBe('true')
    expect(backlog?.get('excludeEpics')).toBe('true')
    expect(backlog?.get('excludeSubtasks')).toBe('true')
    expect(backlog?.get('status')).toBeNull()

    const active = api.params().find((p) => p.get('cycle') === '1')
    expect(active?.get('hideInactiveClosed')).toBeNull()
    expect(active?.get('excludeEpics')).toBe('true')
    expect(active?.get('excludeSubtasks')).toBe('true')
    // 평면 목록 요청(cycle 없음)은 나가지 않는다.
    expect(api.params().every((p) => p.has('cycle'))).toBe(true)
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
    expect(location()).toBe(`/projects/${KEY}`)

    const progressBefore = api.progressGets()
    await user.click(screen.getByTestId('bulk-status-trigger'))
    await user.click(await screen.findByTestId('bulk-status-option-3'))
    await waitFor(() => expect([...api.statusPatches].sort((a, b) => a - b)).toEqual([11, 21, 41]))
    await waitFor(() => expect(screen.queryByTestId('issue-bulk-toolbar')).not.toBeInTheDocument())
    await waitFor(() => expect(api.progressGets()).toBeGreaterThan(progressBefore))
  })

  test('로딩 중엔 평면 목록을 띄우지 않고 스켈레톤을 보인다', async () => {
    let release: () => void = () => {}
    const cyclesGate = new Promise<void>((r) => (release = r))
    const api = setup({ cyclesGate })
    renderProjectScreen(`/projects/${KEY}`, { handlers: api.handlers })
    expect(await screen.findByTestId('issue-list-pending')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-row-90')).not.toBeInTheDocument()
    release()
    expect(await screen.findByTestId('list-cycle-section-backlog')).toBeInTheDocument()
    expect(api.params().every((p) => p.has('cycle'))).toBe(true)
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

  test('빈 백로그 문구는 새 정의(진행 중·예정 사이클 밖)를 따른다', async () => {
    const api = setup({ backlog: [] })
    renderProjectScreen(`/projects/${KEY}`, { handlers: api.handlers })
    expect(await screen.findByTestId('list-cycle-empty-backlog')).toHaveTextContent(
      '진행 중·예정 사이클에 없는 미완료 이슈가 없습니다',
    )
  })
})
