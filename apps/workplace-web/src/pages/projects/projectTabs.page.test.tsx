// 프로젝트 화면 탭(WP-1477) — 머리줄·탭 줄, 탭 길(기존 주소 호환), 마지막 탭 기억·되돌리기 페이지 테스트.
// App 라우트 배선(첫 진입 → 개요 탭, 탭 이동, 기존 주소, 이슈 상세는 탭 밖)은 renderPage 로 실제 라우트 트리를 띄워 보고,
// 되돌리기 규칙(PUSH·첫 진입만, POP·REPLACE·이슈 탭 클릭·쿼리는 되돌리지 않음, 되돌리는 렌더에서 쓰지 않음, 개인·없는 프로젝트는
// 읽지도 쓰지도 않음)은 레이아웃 + 탭 자리 표시 본문을 renderRoutesScreen 으로 띄워 이동 종류를 직접 만들어 본다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, useNavigate } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'

import { PROJECT_TABS, type ProjectTabId } from '@/pages/projects/tabs/projectTabs'
import { ProjectTabsLayout } from '@/pages/projects/tabs/ProjectTabsLayout'
import { issueDetailSubHandlers } from '@/test/kits/projects/issueDetailStubs'
import { projectScreen } from '@/test/kits/projects/projectScreens'
import { renderRoutesScreen, SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import { rememberProjectTab } from '@/test/projectTabMemory'
import { PAGE_LOAD_TIMEOUT, renderPage, settleHistory } from '@/test/renderPage'
import type { ProjectResponse } from '@/types/project'

import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { createProject } from '../../../e2e/factories/project.factory'
import { createProjectOverview } from '../../../e2e/factories/projectOverview.factory'

// 개인 프로젝트의 이슈 길은 레이아웃이 개인 전용 화면을 바로 그린다 — 여기선 레이아웃의 분기만 보므로 그 화면을 자리 표시로 바꾼다
// (개인 화면 자체는 personalProjectDetail.test.tsx·mobile/personalProject.test.tsx 가 본다).
vi.mock('@/pages/projects/personal/PersonalProjectDetail', () => ({
  PersonalProjectDetail: () => <p>개인 이슈 화면</p>,
}))

const KEY = 'WP'
/** 기본 로그인 사용자(id 1, 워크스페이스 없음)의 탭 기억 키 — useRememberedProjectTab 과 같은 규칙. */
const STORE_KEY = `project-tab:${KEY}:1:-`
const stored = () => window.localStorage.getItem(STORE_KEY)
/** 렌더 도우미가 기본으로 심는 탭 기억(WP → 이슈)을 끈다 — 이 파일은 기억이 없을 때의 기본 탭(개요)과 기억·되돌리기 규칙 자체를 본다. */
const NO_MEMORY = {}

/** 탭 줄(nav「프로젝트 탭」) — 페이지 이동 링크 묶음이라 tablist 가 아니라 navigation 이다. */
const tabNav = () => screen.getByRole('navigation', { name: '프로젝트 탭' })
const queryTabNav = () => screen.queryByRole('navigation', { name: '프로젝트 탭' })
/** 탭 줄의 탭 하나 — 이름(라벨)으로 찾은 링크. */
const tab = (id: ProjectTabId) =>
  within(tabNav()).getByRole('link', { name: PROJECT_TABS.find((t) => t.id === id)!.label })

// ── App 라우트 배선(renderPage) ─────────────────────────────────────────────

/** 팀 프로젝트 WP — 이슈 목록·보드 기본 조회 + 사이드바 즐겨찾기(사이드바의 WP 링크로 PUSH 진입을 만든다). */
function appHandlers(project: ProjectResponse = createProject({ key: KEY, name: '워크플레이스' })) {
  return [
    ...projectScreen(KEY, { project }).handlers,
    http.get('/api/v1/projects', () =>
      HttpResponse.json({ content: [project], page: 0, size: 20, totalElements: 1, totalPages: 1 }),
    ),
    http.get('/api/v1/me/project-favorites', () => HttpResponse.json({ projectKeys: [KEY] })),
    http.get(`/api/v1/projects/${KEY}/overview`, () => HttpResponse.json(createProjectOverview())),
    // 개요 리포트 줄(WP-1483) — 리포트 없음.
    http.get(`/api/v1/projects/${KEY}/reports`, () =>
      HttpResponse.json({ latest: null, past: [], reportsPageId: null, cadenceLabel: null }),
    ),
  ]
}

describe('프로젝트 탭 — 앱 라우트', () => {
  test('처음 /projects/WP 에 들어오면(기억 없음) 개요 탭으로 열리고, 머리줄은 설정·+ 새 태스크만 둔다 — 이슈 탭을 누르면 이슈 목록이 열리고 기억된다', async () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    const { user, location } = renderPage(`/projects/${KEY}`, { handlers: appHandlers(), projectTabs: NO_MEMORY })
    // 기본 탭은 개요(DEFAULT_PROJECT_TAB, WP-1478) — 처음 들어오는 사람은 개요부터. 이슈 목록은 그리지 않는다.
    expect(await screen.findByTestId('project-overview-widgets', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(location()).toBe(`/projects/${KEY}/overview`)
    expect(tab('overview')).toHaveAttribute('aria-current', 'page')
    expect(tab('issues')).not.toHaveAttribute('aria-current')
    expect(screen.queryByRole('region', { name: '태스크' })).not.toBeInTheDocument()
    // 되돌리는 렌더는 이슈 탭을 기억에 쓰지 않고, 도착한 개요를 기억한다.
    await waitFor(() => expect(stored()).toBe('overview'))
    expect(setItem.mock.calls.filter(([k, v]) => k === STORE_KEY && v === 'issues')).toEqual([])

    // 탭 다섯 — 순서대로, 노트는 숨김.
    const tabs = within(tabNav()).getAllByRole('link')
    expect(tabs.map((t) => t.textContent)).toEqual(['개요', '이슈', '타임라인', '사이클', '버전'])
    expect(within(tabNav()).queryByRole('link', { name: '노트' })).not.toBeInTheDocument()
    // 탭 패턴(tablist·tab·aria-selected)이 아니다 — 패널·화살표 키 이동이 없는 페이지 이동 링크라 그 계약을 걸지 않는다.
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(tab('issues')).toHaveAttribute('href', `/projects/${KEY}`)
    expect(tab('cycles')).toHaveAttribute('href', `/projects/${KEY}/cycles`)

    // 머리줄 — 이름·키, 설정·+ 새 태스크. 예전 사이클·버전·타임라인 단추는 없다.
    const header = screen.getByTestId('page-header')
    expect(within(header).getByRole('heading', { name: '워크플레이스' })).toBeInTheDocument()
    expect(header).toHaveTextContent(KEY)
    expect(within(header).getByRole('link', { name: '설정' })).toHaveAttribute('href', `/projects/${KEY}/settings`)
    expect(within(header).getByRole('button', { name: '+ 새 태스크' })).toBeInTheDocument()
    for (const name of ['사이클', '버전', '타임라인']) {
      expect(within(header).queryByRole('link', { name })).not.toBeInTheDocument()
    }

    // 이슈 탭 클릭 — 이슈 목록이 열리고(되돌리지 않음), 이슈 탭을 기억한다.
    await user.click(tab('issues'))
    expect(await screen.findByRole('region', { name: '태스크' })).toBeInTheDocument()
    expect(location()).toBe(`/projects/${KEY}`)
    expect(tab('issues')).toHaveAttribute('aria-current', 'page')
    await waitFor(() => expect(stored()).toBe('issues'))
  })

  test('사이클 탭을 연 뒤 링크로 /projects/WP 에 다시 들어오면 사이클로, 이슈 탭을 연 뒤면 이슈 탭으로 열린다', async () => {
    const { user, location } = renderPage(`/projects/${KEY}/cycles`, { handlers: appHandlers(), projectTabs: NO_MEMORY })
    expect(await screen.findByText('아직 사이클이 없습니다.', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(tab('cycles')).toHaveAttribute('aria-current', 'page')

    // 개요 → 사이클 탭 클릭.
    await user.click(tab('overview'))
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}/overview`))
    await user.click(tab('cycles'))
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}/cycles`))

    // 사이드바의 프로젝트 링크(PUSH, 쿼리 없음) — 기억한 사이클로 바꿔 보낸다.
    await user.click(await screen.findByTestId(`team-project-${KEY}`))
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}/cycles`))
    expect(screen.getByText('아직 사이클이 없습니다.')).toBeInTheDocument()

    // 이슈 탭 클릭 — /projects/WP 에 머문다(되돌리지 않음).
    await user.click(tab('issues'))
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}`))
    expect(tab('issues')).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('region', { name: '태스크' })).toBeInTheDocument()
    await waitFor(() => expect(stored()).toBe('issues'))

    // 다시 사이드바 링크 — 기억이 이슈라 이슈 탭 그대로.
    await user.click(screen.getByTestId(`team-project-${KEY}`))
    await settleHistory()
    expect(location()).toBe(`/projects/${KEY}`)
    expect(tab('issues')).toHaveAttribute('aria-current', 'page')
  })

  test('쿼리가 있는 기존 주소(/projects/WP?view=board)는 기억과 상관없이 이슈 탭 보드를 그대로 연다', async () => {
    rememberProjectTab(KEY, 'cycles')
    const { location } = renderPage(`/projects/${KEY}?view=board`, { handlers: appHandlers(), projectTabs: NO_MEMORY })
    expect(await screen.findByTestId('board-scroll', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(location()).toBe(`/projects/${KEY}?view=board`)
    expect(tab('issues')).toHaveAttribute('aria-current', 'page')
  })

  test('기존 버전 주소(/projects/WP/versions)는 버전 탭, 이슈 상세(/projects/WP/issues/1)는 탭 줄 없는 상세 화면이다', async () => {
    const { location } = renderPage(`/projects/${KEY}/versions`, {
      projectTabs: NO_MEMORY,
      handlers: [
        ...appHandlers(),
        ...issueDetailSubHandlers({ key: KEY, number: 1, detail: createIssueDetail({ summary: createIssue({ id: 1, number: 1, title: '상세 이슈' }) }) }),
      ],
    })
    expect(await screen.findByTestId('version-empty', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(tab('versions')).toHaveAttribute('aria-current', 'page')
    expect(location()).toBe(`/projects/${KEY}/versions`)

    // 이슈 상세는 탭 레이아웃 밖 — 탭 줄이 없다. 목록 화면 링크를 거치지 않고 주소로 연다.
    await act(async () => {
      window.history.pushState(null, '', `/projects/${KEY}/issues/1`)
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    const heading = await screen.findByTestId('issue-title-heading', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(heading).toHaveTextContent('상세 이슈')
    expect(queryTabNav()).not.toBeInTheDocument()
  })
})

// ── 되돌리기 규칙(레이아웃 + 자리 표시 본문) ─────────────────────────────────

/** 탭 본문 자리 — 이 탭이 그려졌음을 보이고, 이동 종류(PUSH·REPLACE·쿼리 PUSH)를 직접 만든다. */
function Body({ name }: { name: string }) {
  const navigate = useNavigate()
  return (
    <div>
      <p>{name} 본문</p>
      <button type="button" onClick={() => navigate(`/projects/${KEY}`)}>PUSH 진입</button>
      <button type="button" onClick={() => navigate(`/projects/${KEY}`, { replace: true })}>REPLACE 진입</button>
      <button type="button" onClick={() => navigate(`/projects/${KEY}?view=board`)}>쿼리 진입</button>
      <button type="button" onClick={() => navigate(`/projects/${KEY}/timeline`)}>타임라인 PUSH</button>
    </div>
  )
}

/** 레이아웃 아래 이슈(index)·개요·타임라인·사이클·버전 자리 표시 본문. */
const tabRoutes = (
  <Route path="/projects/:key" element={<ProjectTabsLayout />}>
    <Route index element={<Body name="이슈" />} />
    <Route path="overview" element={<Body name="개요" />} />
    <Route path="timeline" element={<Body name="타임라인" />} />
    <Route path="cycles" element={<Body name="사이클" />} />
    <Route path="versions" element={<Body name="버전" />} />
  </Route>
)

/** 레이아웃을 path 에서 띄운다 — 프로젝트 응답만 준다(404 면 status). */
function openLayout(path: string, project: ProjectResponse | 404 = createProject({ key: KEY })) {
  return renderRoutesScreen(tabRoutes, path, {
    projectTabs: NO_MEMORY,
    handlers: [
      http.get(`/api/v1/projects/${KEY}`, () =>
        project === 404
          ? HttpResponse.json({ status: 404, message: '프로젝트를 찾을 수 없습니다' }, { status: 404 })
          : HttpResponse.json(project),
      ),
    ],
  })
}

describe('프로젝트 탭 — 마지막 탭으로 되돌리기', () => {
  test('첫 진입(주소 입력·새로고침)은 기억한 탭으로 바꿔 보내고, 되돌리는 렌더에서 이슈 탭을 기억에 쓰지 않는다', async () => {
    rememberProjectTab(KEY, 'cycles')
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    const { location } = openLayout(`/projects/${KEY}`)
    expect(await screen.findByText('사이클 본문', {}, { timeout: SCREEN_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(location()).toBe(`/projects/${KEY}/cycles`)
    // 이슈 본문은 한 번도 그리지 않았고, 이슈 탭을 쓰지 않았다.
    expect(setItem.mock.calls.filter(([k, v]) => k === STORE_KEY && v === 'issues')).toEqual([])
    expect(stored()).toBe('cycles')
  })

  test('앱 안 링크(PUSH)로 조건 없이 들어오면 기억한 탭으로 — 이슈 본문을 그리지 않는다', async () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    const { user, location } = openLayout(`/projects/${KEY}/cycles`)
    await screen.findByText('사이클 본문', {}, { timeout: SCREEN_LOAD_TIMEOUT })
    await waitFor(() => expect(stored()).toBe('cycles'))
    await user.click(screen.getByRole('button', { name: 'PUSH 진입' }))
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}/cycles`))
    expect(screen.queryByText('이슈 본문')).not.toBeInTheDocument()
    expect(setItem.mock.calls.filter(([k, v]) => k === STORE_KEY && v === 'issues')).toEqual([])
  })

  test('REPLACE 로 조건 없는 주소가 되면(화면 안에서 필터를 모두 지움) 이슈 탭에 머문다', async () => {
    const { user, location } = openLayout(`/projects/${KEY}/cycles`)
    await screen.findByText('사이클 본문', {}, { timeout: SCREEN_LOAD_TIMEOUT })
    await user.click(screen.getByRole('button', { name: 'REPLACE 진입' }))
    expect(await screen.findByText('이슈 본문')).toBeInTheDocument()
    expect(location()).toBe(`/projects/${KEY}`)
    await waitFor(() => expect(stored()).toBe('issues'))
  })

  test('뒤로 가기(POP)로 조건 없는 /projects/WP 에 돌아오면 다른 탭으로 튕기지 않고, 이슈 탭으로 기억을 덮어쓰지 않는다', async () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    const { user, location } = openLayout(`/projects/${KEY}/cycles`)
    await screen.findByText('사이클 본문', {}, { timeout: SCREEN_LOAD_TIMEOUT })
    // 상태 없이 /projects/WP 기록을 만든다(REPLACE) → 타임라인으로 PUSH(기억 = 타임라인) → 뒤로 가기.
    await user.click(screen.getByRole('button', { name: 'REPLACE 진입' }))
    await screen.findByText('이슈 본문')
    await user.click(screen.getByRole('button', { name: '타임라인 PUSH' }))
    await screen.findByText('타임라인 본문')
    await waitFor(() => expect(stored()).toBe('timeline'))
    setItem.mockClear()
    await act(async () => {
      window.history.back()
      await settleHistory()
    })
    expect(await screen.findByText('이슈 본문')).toBeInTheDocument()
    await settleHistory()
    expect(location()).toBe(`/projects/${KEY}`)
    // POP 도착은 사용자가 고른 탭이 아니다 — 기억은 타임라인 그대로(다음 링크 진입이 타임라인으로 열린다).
    expect(setItem.mock.calls.filter(([k]) => k === STORE_KEY)).toEqual([])
    expect(stored()).toBe('timeline')
  })

  test('탭을 눌러 옮겨 다녀도 방문 기록이 쌓이지 않는다(replace) — 모바일 ‹ 가 탭을 하나씩 거슬러 가지 않는다', async () => {
    const { user, location } = openLayout(`/projects/${KEY}/cycles`)
    await screen.findByText('사이클 본문', {}, { timeout: SCREEN_LOAD_TIMEOUT })
    const before = window.history.length
    await user.click(tab('overview'))
    await screen.findByText('개요 본문')
    await user.click(tab('timeline'))
    await screen.findByText('타임라인 본문')
    await user.click(tab('issues'))
    expect(await screen.findByText('이슈 본문')).toBeInTheDocument()
    expect(location()).toBe(`/projects/${KEY}`)
    expect(window.history.length).toBe(before)
    // 이슈 탭 클릭(REPLACE)도 고른 탭이라 기억한다.
    await waitFor(() => expect(stored()).toBe('issues'))
  })

  test('이슈 탭을 눌러 온 이동과 쿼리가 있는 주소는 되돌리지 않는다', async () => {
    const { user, location } = openLayout(`/projects/${KEY}/cycles`)
    await screen.findByText('사이클 본문', {}, { timeout: SCREEN_LOAD_TIMEOUT })
    await user.click(tab('issues'))
    expect(await screen.findByText('이슈 본문')).toBeInTheDocument()
    expect(location()).toBe(`/projects/${KEY}`)

    // 기억을 사이클로 돌려 두고 쿼리가 있는 주소로 PUSH — 이슈 탭 그대로.
    await user.click(tab('cycles'))
    await screen.findByText('사이클 본문')
    await waitFor(() => expect(stored()).toBe('cycles'))
    await user.click(screen.getByRole('button', { name: '쿼리 진입' }))
    expect(await screen.findByText('이슈 본문')).toBeInTheDocument()
    expect(location()).toBe(`/projects/${KEY}?view=board`)
  })

  test.each(['notes', 'foo'])('기억한 값이 %s(숨긴 탭·모르는 값)면 기억 없음과 같이 기본 탭(개요)으로 연다', async (value) => {
    window.localStorage.setItem(STORE_KEY, value)
    const { location } = openLayout(`/projects/${KEY}`)
    expect(await screen.findByText('개요 본문', {}, { timeout: SCREEN_LOAD_TIMEOUT })).toBeInTheDocument()
    await settleHistory()
    expect(location()).toBe(`/projects/${KEY}/overview`)
    expect(screen.queryByText('이슈 본문')).not.toBeInTheDocument()
  })

  test('개인 프로젝트는 탭 줄·팀 머리줄 없이 개인 이슈 화면만 — 주소 그대로, 기억을 읽지도 쓰지도 않는다', async () => {
    rememberProjectTab(KEY, 'cycles')
    const getItem = vi.spyOn(window.localStorage, 'getItem')
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    const { location } = openLayout(`/projects/${KEY}`, createProject({ key: KEY, type: 'PERSONAL' }))
    expect(await screen.findByText('개인 이슈 화면', {}, { timeout: SCREEN_LOAD_TIMEOUT })).toBeInTheDocument()
    // 팀 이슈 탭(index 본문)은 그리지 않는다 — 개인/팀 판단은 레이아웃 한 곳.
    expect(screen.queryByText('이슈 본문')).not.toBeInTheDocument()
    await settleHistory()
    expect(location()).toBe(`/projects/${KEY}`)
    expect(queryTabNav()).not.toBeInTheDocument()
    expect(screen.queryByTestId('page-header')).not.toBeInTheDocument()
    expect(getItem.mock.calls.filter(([k]) => k === STORE_KEY)).toEqual([])
    expect(setItem.mock.calls.filter(([k]) => k === STORE_KEY)).toEqual([])
  })

  test('개인 프로젝트로 개요 탭 주소를 열면 이슈 화면(/projects/ME)으로 보낸다 — 크래시·탭 줄 없음', async () => {
    const { location } = openLayout(`/projects/${KEY}/overview`, createProject({ key: KEY, type: 'PERSONAL' }))
    expect(await screen.findByText('개인 이슈 화면', {}, { timeout: SCREEN_LOAD_TIMEOUT })).toBeInTheDocument()
    await settleHistory()
    expect(location()).toBe(`/projects/${KEY}`)
    expect(screen.queryByText('개요 본문')).not.toBeInTheDocument()
    expect(queryTabNav()).not.toBeInTheDocument()
    expect(screen.queryByTestId('page-header')).not.toBeInTheDocument()
  })

  test.each([
    ['cycles', '사이클'],
    ['timeline', '타임라인'],
    ['versions', '버전'],
  ])('개인 프로젝트의 %s 주소는 main 처럼 화면 이름 머리줄·← 돌아가기와 Page 틀 안에서 연다 — 탭 줄 없음', async (path, title) => {
    const { user, location } = openLayout(`/projects/${KEY}/${path}`, createProject({ key: KEY, type: 'PERSONAL' }))
    const body = await screen.findByText(`${title} 본문`, {}, { timeout: SCREEN_LOAD_TIMEOUT })
    await settleHistory()
    expect(location()).toBe(`/projects/${KEY}/${path}`)
    expect(queryTabNav()).not.toBeInTheDocument()
    // 본문은 Page(세로 flex 전체 높이 틀) 안 — 스크롤·타임라인 고정 높이가 이 부모에 기댄다.
    expect(screen.getByTestId('project-personal-page')).toContainElement(body)
    const header = screen.getByTestId('page-header')
    expect(within(header).getByRole('heading', { name: title })).toBeInTheDocument()
    expect(header).toHaveTextContent(KEY)
    // 팀 머리줄 단추(설정·+ 새 태스크)는 없다 — 개인 프로젝트 화면 머리줄은 main 과 같다.
    expect(within(header).queryByRole('button', { name: '+ 새 태스크' })).not.toBeInTheDocument()
    await user.click(within(header).getByRole('button', { name: '프로젝트로 돌아가기' }))
    expect(await screen.findByText('개인 이슈 화면')).toBeInTheDocument()
    expect(location()).toBe(`/projects/${KEY}`)
  })

  test('없는 프로젝트(404)는 「프로젝트를 불러올 수 없습니다」 — 기억을 읽지도 쓰지도 않는다', async () => {
    const getItem = vi.spyOn(window.localStorage, 'getItem')
    const { location } = openLayout(`/projects/${KEY}`, 404)
    expect(await screen.findByRole('heading', { name: '프로젝트를 불러올 수 없습니다' }, { timeout: SCREEN_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(location()).toBe(`/projects/${KEY}`)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(getItem.mock.calls.filter(([k]) => k === STORE_KEY)).toEqual([])
    expect(stored()).toBeNull()
  })
})
