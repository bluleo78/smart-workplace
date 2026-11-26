// 팀 리스트 뷰 — 화면 테스트(WP-971, WP-1002 에서 목록 화면(ProjectDetailPage)만 띄우게 바꿈).
// 행 셀 표기(마감일·마감 지남·우선순위 5단계·하위 진행률), 기본 검색 쿼리, 필터 facet 옵션·아이콘과 선택 → URL·검색 파라미터,
// 빈 상태 두 가지, 사용자 정의 상태(WP-808) 필터·그룹 헤더, 상태 목록 도착 전 그리지 않기는 브라우저 없이 판정되므로
// e2e/pages/projects/{issue-list,issue-list-duedate}.spec.ts 에서 옮겼다.
// 라우트 → 목록 API → 행 배선(@wiring)·칩/레이블 폭(@layout)·우선순위 「!」 가상 요소(@layout)·history 한 번만 쌓기(@platform)는 E2E 에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { describe, expect, test } from 'vitest'

import { settleHistory } from '@/test/history'
import { renderProjectScreen } from '@/test/kits/projects/projectDetailScreen'
import { API, projectScreen } from '@/test/kits/projects/projectScreens'
import { openQuickFacet } from '@/test/kits/projects/quickFilter'
import type { ScreenUser } from '@/test/renderScreen'
import type { IssueResponse } from '@/types/issue'

import { createIssue } from '../../../e2e/factories/issue.factory'
import { createMember } from '../../../e2e/factories/project.factory'
import { seedStatuses, withCustomStatuses } from '../../../e2e/factories/projectStatus.factory'
import { countsJudgments, headerCount } from './components/issueListHeaderCount'

const KEY = 'WP'

/**
 * 라우터 이동 버튼 — 실제 라우터로 새 history 항목(PUSH)을 쌓는다. push-plain 은 state 없이, push-copy 는 지금 location.state 를 그대로 복사해
 * (이슈 드로어 열기·AI 딥링크가 하는 이동과 같다) 같은 주소로 이동한다.
 */
function NavButtons() {
  const navigate = useNavigate()
  const loc = useLocation()
  const to = `${loc.pathname}${loc.search}`
  return (
    <>
      <button type="button" data-testid="nav-push-plain" onClick={() => navigate(to)}>
        plain
      </button>
      <button type="button" data-testid="nav-push-copy" onClick={() => navigate(to, { state: loc.state })}>
        copy
      </button>
    </>
  )
}

/** 목록을 연다 — search 는 검색 응답(기본 issues 그대로), extra 는 테스트별 핸들러(앞에 두어 우선). */
function openList(
  issues: IssueResponse[],
  { path = `/projects/${KEY}`, extra = [], search, screenExtra }: { path?: string; extra?: RequestHandler[]; search?: (url: URL) => IssueResponse[]; screenExtra?: ReactNode } = {},
) {
  const api = projectScreen(KEY, { search: search ?? (() => issues) })
  const view = renderProjectScreen(path, { handlers: [...extra, ...api.handlers], extra: screenExtra })
  return { ...view, api, lastSearch: () => api.searches.at(-1) }
}

/** 빠른 필터 칩(또는 「더 보기」) → facet 값 목록을 연다(WP-1020). */
const openFacet = (user: ScreenUser, facet: string) => openQuickFacet(user, facet)

const customStatuses = () => http.get(`${API}/projects/${KEY}/statuses`, () => HttpResponse.json(withCustomStatuses('대기', '검토 중')))

describe('행 셀 표기', () => {
  // 마감일은 ISO 원문이 아닌 목록 공용 표기 — 다른 해는 「YYYY. M. D」, 마감 없음은 —(refs #162, WP-919).
  test('마감일은 다른 해 「2099. 6. 30」, 마감 없음은 「—」로 보인다', async () => {
    openList([
      createIssue({ id: 1, number: 1, title: '마감일 테스트 이슈', dueDate: '2099-06-30' }),
      createIssue({ id: 2, number: 2, title: '마감 없는 이슈', dueDate: null }),
    ])
    expect(await screen.findByTestId('issue-row-1-due')).toHaveTextContent(/^2099\. 6\. 30$/)
    expect(screen.getByTestId('issue-row-2-due')).toHaveTextContent(/^—$/)
    expect(screen.queryByText('2099-06-30')).not.toBeInTheDocument()
  })

  // WP-649: 마감 지난 미완료 행만 빨간색 + 「마감 지남」 — 완료·미래 마감은 그대로.
  test('마감 지난 미완료 이슈만 「마감 지남」과 빨간색, 완료·미래 마감은 아니다', async () => {
    openList([
      createIssue({ id: 1, number: 1, title: '지난 마감', status: 'IN_PROGRESS', dueDate: '2020-01-15' }),
      createIssue({ id: 2, number: 2, title: '완료된 지난 마감', status: 'DONE', dueDate: '2020-01-15' }),
      createIssue({ id: 3, number: 3, title: '먼 미래 마감', status: 'TODO', dueDate: '2099-01-15' }),
    ])
    const due1 = await screen.findByTestId('issue-row-1-due')
    expect(due1).toHaveTextContent('마감 지남')
    expect(due1).toHaveClass('text-destructive')
    for (const n of [2, 3]) {
      expect(screen.getByTestId(`issue-row-${n}-due`)).not.toHaveTextContent('마감 지남')
      expect(screen.getByTestId(`issue-row-${n}-due`)).not.toHaveClass('text-destructive')
    }
  })

  // 하위(SUBTASK)를 가진 부모 행만 └ done/total 배지.
  test('하위가 있는 행에만 진행률 배지 2/5 가 보인다', async () => {
    openList([
      createIssue({ number: 9, title: '결제 모듈 개편', childCount: 5, childDoneCount: 2 }),
      createIssue({ id: 2, number: 10, title: '문구 수정' }),
    ])
    expect(await screen.findByTestId('issue-row-9-child-progress')).toHaveTextContent('2/5')
    expect(screen.queryByTestId('issue-row-10-child-progress')).not.toBeInTheDocument()
  })

  // WP-886: 우선순위 5단계 — 매우 높음/높음/매우 낮음이 서로 다른 이름의 아이콘(매우 높음은 글자 없이, 매우 낮음은 빈 막대 3개).
  test('우선순위 매우 높음·높음·매우 낮음 아이콘이 각자의 이름으로 읽힌다', async () => {
    openList([
      createIssue({ id: 1, number: 1, title: '결제 장애', priority: 'HIGHEST' }),
      createIssue({ id: 2, number: 2, title: '로그인 오류', priority: 'HIGH' }),
      createIssue({ id: 3, number: 3, title: '아이디어', priority: 'LOWEST' }),
    ])
    const row1 = await screen.findByTestId('issue-row-1')
    const highest = within(row1).getByRole('img', { name: '우선순위 매우 높음' })
    expect(highest).toHaveTextContent(/^$/)
    expect(within(screen.getByTestId('issue-row-2')).getByRole('img', { name: '우선순위 높음' })).toBeInTheDocument()
    const lowest = within(screen.getByTestId('issue-row-3')).getByRole('img', { name: '우선순위 매우 낮음' })
    expect(lowest.querySelectorAll('span')).toHaveLength(3)
  })
})

describe('검색 쿼리', () => {
  // 목록 기본(#874): 에픽 행 숨김·에픽 직속 자식 유지·SUBTASK 숨김 → topLevel 미송신, excludeSubtasks·excludeEpics=true.
  test('필터 없이 열면 topLevel 없이 excludeSubtasks=true·excludeEpics=true 로 검색한다', async () => {
    const { lastSearch } = openList([createIssue({ number: 7 })])
    await screen.findByTestId('issue-row-7')
    const url = lastSearch()!
    expect(url.searchParams.get('topLevel')).toBeNull()
    expect(url.searchParams.get('excludeSubtasks')).toBe('true')
    expect(url.searchParams.get('excludeEpics')).toBe('true')
  })

  // WP-886: 우선순위 facet 은 5개를 매우 높음→매우 낮음 순서로, 매우 높음을 고르면 priority=HIGHEST(높음과 따로).
  test('우선순위 facet 은 5개 옵션을 순서대로 보이고, 매우 높음을 고르면 priority=HIGHEST 로 검색한다', async () => {
    const { user, lastSearch, location } = openList([createIssue({ number: 7 })])
    await openFacet(user, 'priority')
    const options = (await screen.findAllByTestId(/^facet-value-priority-/)).filter((el) => !el.dataset.testid?.endsWith('-and-hint'))
    expect(options.map((o) => o.textContent)).toEqual(['매우 높음', '높음', '보통', '낮음', '매우 낮음'])
    expect(within(screen.getByTestId('facet-value-priority-HIGHEST')).getByRole('img', { name: '우선순위 매우 높음' })).toBeInTheDocument()
    await user.click(screen.getByTestId('facet-value-priority-HIGHEST'))
    await waitFor(() => expect(lastSearch()?.searchParams.get('priority')).toBe('HIGHEST'))
    expect(location()).toMatch(/priority=HIGHEST/)
  })

  // #295/#657: 상태 옵션 아이콘은 장식(aria-hidden svg), 우선순위 옵션은 막대 아이콘(role=img).
  test('상태 facet 옵션에는 장식 아이콘, 우선순위 facet 옵션에는 막대 아이콘이 붙는다', async () => {
    const { user } = openList([])
    await openFacet(user, 'status')
    for (const value of ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']) {
      expect((await screen.findByTestId(`facet-value-status-${value}`)).querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    }
    await user.keyboard('{Escape}')
    await openFacet(user, 'priority')
    for (const value of ['LOW', 'MID', 'HIGH']) {
      expect(within(await screen.findByTestId(`facet-value-priority-${value}`)).getAllByRole('img').length).toBeGreaterThan(0)
    }
  })

  // #363: 담당자 facet 이 멤버로 구성되고, 고르면 URL·검색 요청에 assignee 가 실린다.
  test('담당자 facet 이 멤버를 보이고, 고르면 URL 과 검색에 assignee=2 가 실린다', async () => {
    const { user, lastSearch, location } = openList([], {
      extra: [
        http.get(`${API}/projects/${KEY}/members`, () =>
          HttpResponse.json([
            createMember({ userId: 2, name: '김개발', username: 'kim@example.com' }),
            createMember({ userId: 3, name: '이테스트', username: 'lee@example.com', role: 'MEMBER' }),
          ]),
        ),
      ],
    })
    await openFacet(user, 'assignee')
    expect(await screen.findByTestId('facet-value-assignee-2')).toHaveTextContent('김개발')
    expect(screen.getByTestId('facet-value-assignee-3')).toHaveTextContent('이테스트')
    await user.click(screen.getByTestId('facet-value-assignee-2'))
    await waitFor(() => expect(location()).toMatch(/assignee=2/))
    await waitFor(() => expect(lastSearch()?.searchParams.get('assignee')).toBe('2'))
  })
})

describe('빈 상태 (#337)', () => {
  // 필터가 걸린 0건 → 「검색 결과가 없습니다」 + 「필터 지우기」, 누르면 q 가 빠진 주소·요청으로 다시 불러 행이 보인다.
  test('필터 결과 0건이면 검색 빈 상태가 보이고 「필터 지우기」로 q 를 지우면 이슈가 보인다', async () => {
    const { user, location, lastSearch } = openList([], {
      path: `/projects/${KEY}?q=xxxxxxxxxnotfound`,
      search: (url) => (url.searchParams.has('q') ? [] : [createIssue({ number: 5, title: '정상 이슈' })]),
    })
    expect(await screen.findByTestId('empty-filter')).toBeInTheDocument()
    expect(screen.getByText('검색 결과가 없습니다')).toBeInTheDocument()
    expect(screen.getByText('다른 키워드나 필터 조건을 사용해 보세요.')).toBeInTheDocument()
    // WP-2086: 필터 줄과 빈 상태 CTA 가 같은 이름 「필터 지우기」 — 「필터 초기화」 버튼은 없다.
    expect(screen.queryByRole('button', { name: '필터 초기화' })).not.toBeInTheDocument()
    expect(within(screen.getByTestId('empty-filter')).getByRole('button', { name: '필터 지우기' })).toBeInTheDocument()
    expect(screen.getByTestId('quick-filter-clear-all')).toHaveTextContent('필터 지우기')
    await user.click(screen.getByTestId('empty-reset-filter'))
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}`))
    expect(await screen.findByTestId('issue-row-5')).toBeInTheDocument()
    expect(lastSearch()!.searchParams.has('q')).toBe(false)
  })

  // WP-2125: 검색어를 치고 300ms 안에 빈 상태 「필터 지우기」를 누르면 대기 중이던 q 쓰기가 지운 뒤 되살아나지 않는다.
  test('검색어를 치자마자 빈 상태 「필터 지우기」를 눌러도 300ms 뒤 q 가 되살아나지 않고, 지운 뒤 새 검색어는 URL 에 쓰인다', async () => {
    const { user, location } = openList([], {
      path: `/projects/${KEY}?status=IN_PROGRESS`,
      search: (url) => (url.searchParams.has('status') || url.searchParams.has('q') ? [] : [createIssue({ number: 5, title: '정상 이슈' })]),
    })
    const input = await screen.findByRole('textbox', { name: '이슈 필터: 제목·키' })
    await user.click(input)
    await user.paste('결제')
    // 300ms debounce 가 끝나기 전에 빈 상태 CTA 로 지운다.
    await user.click(await screen.findByTestId('empty-reset-filter'))
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}`))
    // debounce 시간이 충분히 흐른 뒤에도 q 가 없고 검색 칸이 비어 있다.
    await new Promise((r) => setTimeout(r, 500))
    expect(location()).toBe(`/projects/${KEY}`)
    expect(screen.getByRole('textbox', { name: '이슈 필터: 제목·키' })).toHaveValue('')
    // 지운 뒤 다시 친 검색어는 평소처럼 300ms 뒤 URL 에 쓰인다.
    await user.click(screen.getByRole('textbox', { name: '이슈 필터: 제목·키' }))
    await user.paste('버그')
    await waitFor(() => expect(location()).toMatch(/q=/))
    expect(decodeURIComponent(location())).toContain('q=버그')
  })

  // WP-2125 리뷰 후속: 뒤로 가기(POP)로 옛 지우기 신호가 남은 항목에 돌아가도 그 신호를 지우기로 보지 않아 방금 친 검색어가 버려지지 않는다.
  test('옛 지우기 신호가 남은 항목으로 뒤로 가도 그 사이 친 검색어는 300ms 뒤 URL 에 쓰인다', async () => {
    const { user, location } = openList([], {
      path: `/projects/${KEY}/issues?status=IN_PROGRESS`,
      search: (url) => (url.searchParams.has('status') || url.searchParams.has('q') ? [] : [createIssue({ number: 5, title: '정상 이슈' })]),
      screenExtra: <NavButtons />,
    })
    // 항목 A — 「필터 지우기」(replace)로 지우기 신호가 history.state 에 남는다.
    await user.click(await screen.findByTestId('empty-reset-filter'))
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}/issues`))
    // 항목 B — 같은 주소를 라우터 이동(PUSH)으로 새 항목에 쌓는다(신호 없음).
    await user.click(screen.getByTestId('nav-push-plain'))
    await user.click(await screen.findByRole('textbox', { name: '이슈 필터: 제목·키' }))
    await user.paste('결제')
    // 검색어를 치자마자 A 로 뒤로 간다 — 옛 신호가 남은 항목이다.
    window.history.back()
    await settleHistory()
    await waitFor(() => expect(decodeURIComponent(location())).toContain('q=결제'))
    expect(screen.getByRole('textbox', { name: '이슈 필터: 제목·키' })).toHaveValue('결제')
  })

  // WP-2125 리뷰 후속 2: 지우기 → state 를 복사하는 다른 PUSH → 뒤로(POP) → 검색어 → state 를 복사하는 이동 — 옛 신호가 다시 실려도 새 지우기가 아니다.
  test('옛 지우기 신호를 복사한 이동이 뒤따라도 그 사이 친 검색어는 버려지지 않는다', async () => {
    const { user, location } = openList([], {
      path: `/projects/${KEY}/issues?status=IN_PROGRESS`,
      search: (url) => (url.searchParams.has('status') || url.searchParams.has('q') ? [] : [createIssue({ number: 5, title: '정상 이슈' })]),
      screenExtra: <NavButtons />,
    })
    await user.click(await screen.findByTestId('empty-reset-filter'))
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}/issues`))
    // 드로어 열기처럼 location.state 를 그대로 복사하는 PUSH, 그리고 뒤로(POP).
    await user.click(screen.getByTestId('nav-push-copy'))
    await settleHistory()
    window.history.back()
    await settleHistory()
    await user.click(await screen.findByRole('textbox', { name: '이슈 필터: 제목·키' }))
    await user.paste('결제')
    // debounce(300ms) 안에 state 를 복사하는 이동이 다시 일어난다 — 옛 신호값 그대로.
    await user.click(screen.getByTestId('nav-push-copy'))
    await waitFor(() => expect(decodeURIComponent(location())).toContain('q=결제'), { timeout: 2000 })
    expect(screen.getByRole('textbox', { name: '이슈 필터: 제목·키' })).toHaveValue('결제')
  })

  // 필터 없는 0건 → 「이슈가 없습니다」 + 「새 이슈 만들기」 → 유형 중립 「새 이슈」 다이얼로그(#641).
  test('필터 없이 0건이면 「이슈가 없습니다」와 CTA, 누르면 「새 이슈」 다이얼로그가 열린다', async () => {
    const { user } = openList([])
    expect(await screen.findByTestId('empty-no-issues')).toBeInTheDocument()
    expect(screen.getByText('이슈가 없습니다')).toBeInTheDocument()
    expect(screen.getByText('새 이슈를 만들어 프로젝트를 시작하세요.')).toBeInTheDocument()
    await user.click(screen.getByTestId('empty-create-issue'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: '새 이슈' })).toBeInTheDocument()
  })
})

describe('사용자 정의 상태 (WP-808)', () => {
  // 「상태」(statusId) facet 은 프로젝트 상태 이름 순서, 고르면 statusId=12 만 싣고 칩 「상태: 검토 중」.
  test('「상태」 필터에서 「검토 중」을 고르면 statusId=12 로 검색하고 칩이 생긴다', async () => {
    const { user, lastSearch, location } = openList([createIssue({ number: 7 })], { extra: [customStatuses()] })
    // 「상태」는 기본 칩 — 칩을 한 번 누르면 값 목록이 열린다(WP-1020).
    expect(await screen.findByTestId('quick-filter-statusId-trigger')).toHaveTextContent(/^상태$/)
    await user.click(screen.getByTestId('quick-filter-statusId-trigger'))
    const options = await screen.findAllByTestId(/^facet-value-statusId-/)
    expect(options.map((o) => o.textContent)).toEqual(['할 일', '진행 중', '대기', '검토 중', '완료', '취소'])
    expect(screen.getByTestId('facet-value-statusId-12').querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    await user.click(screen.getByTestId('facet-value-statusId-12'))
    await waitFor(() => expect(location()).toMatch(/statusId=12/))
    await waitFor(() => expect(lastSearch()?.searchParams.get('statusId')).toBe('12'))
    expect(lastSearch()?.searchParams.get('status')).toBeNull()
    const chip = await screen.findByTestId('quick-filter-statusId')
    await waitFor(() => expect(chip).toHaveAttribute('data-active', 'true'))
    expect(chip).toHaveTextContent('상태:')
    expect(chip).toHaveTextContent('검토 중')
  })

  // 「상태 범주」 facet 은 기존 status 파라미터를 쓴다.
  test('「상태 범주」 필터는 status=IN_PROGRESS 로 검색한다(statusId 없음)', async () => {
    const { user, lastSearch } = openList([createIssue({ number: 7 })], { extra: [customStatuses()] })
    // 「상태 범주」는 「더 보기」 소속(WP-1020).
    await user.click(await screen.findByTestId('quick-filter-more'))
    expect(await screen.findByTestId('quick-filter-more-facet-status')).toHaveTextContent(/^상태 범주$/)
    await user.click(screen.getByTestId('quick-filter-more-facet-status'))
    await user.click(await screen.findByTestId('facet-value-status-IN_PROGRESS'))
    await waitFor(() => expect(lastSearch()?.searchParams.get('status')).toBe('IN_PROGRESS'))
    expect(lastSearch()?.searchParams.get('statusId')).toBeNull()
  })

  // 예전 ?status= 링크는 상태 범주 칩으로, 둘 다 있으면 칩 둘·파라미터 둘(서버 AND).
  test('예전 ?status= 링크는 상태 범주 칩으로 열리고, statusId 와 함께면 칩·파라미터가 둘 다 실린다', async () => {
    const first = openList([createIssue({ number: 7 })], { path: `/projects/${KEY}?status=IN_PROGRESS`, extra: [customStatuses()] })
    // 「더 보기」 소속인 상태 범주도 값이 걸리면 칩으로 꺼내 보인다(WP-1020). 「상태」 칩은 걸리지 않은 채.
    const category = await screen.findByTestId('quick-filter-status')
    expect(category).toHaveTextContent('상태 범주:')
    expect(category).toHaveTextContent('진행 중')
    expect(screen.getByTestId('quick-filter-statusId')).not.toHaveAttribute('data-active')
    await waitFor(() => expect(first.lastSearch()?.searchParams.get('status')).toBe('IN_PROGRESS'))
    expect(first.lastSearch()?.searchParams.get('statusId')).toBeNull()
    first.unmount()

    const both = openList([createIssue({ number: 7 })], { path: `/projects/${KEY}?status=IN_PROGRESS&statusId=12`, extra: [customStatuses()] })
    await waitFor(() => expect(screen.getByTestId('quick-filter-statusId')).toHaveTextContent('검토 중'))
    expect(screen.getByTestId('quick-filter-status')).toHaveTextContent('진행 중')
    await waitFor(() => expect(both.lastSearch()?.searchParams.get('statusId')).toBe('12'))
    expect(both.lastSearch()?.searchParams.get('status')).toBe('IN_PROGRESS')
  })

  // 상태 그룹은 statusId 별 버킷 — 헤더는 상태 이름 + 서버 총계(groupBy=statusId), 행 아이콘 이름도 상태 이름.
  test('상태 그룹은 사용자 정의 상태마다 묶이고 헤더에 이름·서버 총계가 보인다', async () => {
    const counts: URL[] = []
    openList(
      [
        createIssue({ id: 1, number: 1, title: '리뷰 대기 작업', status: 'IN_PROGRESS', statusId: 12, statusName: '검토 중' }),
        createIssue({ id: 2, number: 2, title: '진행 작업', status: 'IN_PROGRESS' }),
      ],
      {
        path: `/projects/${KEY}?group=status`,
        extra: [
          customStatuses(),
          http.get(`${API}/projects/${KEY}/issues/group-counts`, ({ request }) => {
            counts.push(new URL(request.url))
            return HttpResponse.json({ groupBy: 'statusId', groups: [{ key: '12', count: 5 }, { key: '2', count: 1 }] })
          }),
        ],
      },
    )
    expect(await screen.findByTestId('list-group-toggle-12')).toHaveTextContent('검토 중')
    await waitFor(() => expect(screen.getByTestId('list-group-count-12')).toHaveTextContent(/^5$/))
    expect(within(screen.getByTestId('list-group-12')).getByTestId('issue-row-1')).toBeInTheDocument()
    expect(within(screen.getByTestId('list-group-2')).getByTestId('issue-row-2')).toBeInTheDocument()
    expect(within(screen.getByTestId('issue-row-1')).getByLabelText('상태: 검토 중')).toBeInTheDocument()
    expect(counts.at(-1)?.searchParams.get('groupBy')).toBe('statusId')
  })

  // WP-870: 상태 목록이 오기 전엔 목록을 그리지 않는다 — 범주 버킷(list-group-TODO)으로 먼저 그렸다 바꾸지 않게.
  test('상태 목록이 늦게 오면 그 전엔 목록을 그리지 않고, 온 뒤 statusId 버킷으로만 그린다', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    let hits = 0
    openList([createIssue({ id: 1, number: 1, title: '할 일 이슈', status: 'TODO' })], {
      path: `/projects/${KEY}?group=status`,
      extra: [
        http.get(`${API}/projects/${KEY}/statuses`, async () => {
          hits++
          await held
          return HttpResponse.json(seedStatuses())
        }),
      ],
    })
    await screen.findByTestId('quick-filter-more')
    await waitFor(() => expect(hits).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.queryByTestId('issue-list-scroll')).not.toBeInTheDocument()
    release()
    expect(await within(await screen.findByTestId('list-group-1')).findByTestId('issue-row-1')).toBeInTheDocument()
    expect(screen.queryByTestId('list-group-TODO')).not.toBeInTheDocument()
  })
})

// WP-1238: 정렬 — 열 머리 클릭(오름차순 → 내림차순 → 기본)과 필터 막대 「⇅ 정렬」 칩 메뉴가 같은 URL(sort·direction)과 검색 파라미터를 쓴다.
describe('정렬 (WP-1238)', () => {
  /** 이슈 본문 목록 검색(에픽 패널 조회 제외 — 그쪽은 정렬을 싣지 않는다)의 마지막 정렬 파라미터. */
  const lastSort = (api: ReturnType<typeof openList>['api']) => {
    const u = api.lastBodySearch()
    return u ? `${u.searchParams.get('sort')}/${u.searchParams.get('direction')}` : null
  }

  test('정렬 없이 열면 sort·direction 을 보내지 않고, 칩은 「정렬」만 보인다', async () => {
    const { api } = openList([createIssue({ number: 7 })])
    await screen.findByTestId('issue-row-7')
    expect(api.searches.every((u) => !u.searchParams.has('sort') && !u.searchParams.has('direction'))).toBe(true)
    expect(screen.getByTestId('issue-sort-chip')).toHaveTextContent(/^정렬$/)
  })

  test('「마감」 머리를 누르면 오름차순 → 내림차순 → 기본으로 돌고, 검색·URL·aria-sort·칩이 따라간다', async () => {
    const { user, api, location } = openList([createIssue({ number: 7 })])
    await screen.findByTestId('issue-row-7')
    const head = screen.getByTestId('issue-sort-head-dueDate')
    const th = head.closest('th')!
    expect(th).not.toHaveAttribute('aria-sort')

    await user.click(head)
    await waitFor(() => expect(lastSort(api)).toBe('dueDate/asc'))
    expect(location()).toMatch(/sort=dueDate&direction=asc/)
    expect(th).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByTestId('issue-sort-chip')).toHaveTextContent('정렬: 마감일 ↑')

    await user.click(head)
    await waitFor(() => expect(lastSort(api)).toBe('dueDate/desc'))
    expect(th).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByTestId('issue-sort-chip')).toHaveTextContent('정렬: 마감일 ↓')

    await user.click(head)
    await waitFor(() => expect(location()).not.toMatch(/sort=/))
    expect(th).not.toHaveAttribute('aria-sort')
    expect(screen.getByTestId('issue-sort-chip')).toHaveTextContent(/^정렬$/)
  })

  test('아이콘 열(상태)의 머리도 정렬 단추이고, 다른 열을 누르면 그 열 오름차순으로 바뀐다', async () => {
    const { user, api } = openList([createIssue({ number: 7 })], { path: `/projects/${KEY}?sort=dueDate&direction=desc` })
    await screen.findByTestId('issue-row-7')
    expect(lastSort(api)).toBe('dueDate/desc')
    // 머리 단추는 화살표만 보이고 이름은 sr-only 「상태」 — 표 머리 안에서 이름으로 찾는다(필터 칩 「상태」와 구분).
    await user.click(within(screen.getByRole('table').querySelector('thead')!).getByRole('button', { name: '상태' }))
    await waitFor(() => expect(lastSort(api)).toBe('status/asc'))
    expect(screen.getByTestId('issue-sort-head-status').closest('th')).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByTestId('issue-sort-head-dueDate').closest('th')).not.toHaveAttribute('aria-sort')
  })

  test('칩 메뉴에서 기준·방향을 고르면 검색에 실리고, 「기본으로」는 정렬을 지운다', async () => {
    const { user, api, location } = openList([createIssue({ number: 7 })])
    await screen.findByTestId('issue-row-7')
    await user.click(screen.getByTestId('issue-sort-chip'))
    await user.click(await screen.findByTestId('issue-sort-key-priority'))
    await waitFor(() => expect(lastSort(api)).toBe('priority/asc'))
    // 메뉴는 열린 채라 이어서 방향을 바꾼다.
    await user.click(screen.getByTestId('issue-sort-direction-desc'))
    await waitFor(() => expect(lastSort(api)).toBe('priority/desc'))
    expect(location()).toMatch(/sort=priority&direction=desc/)
    await user.click(screen.getByTestId('issue-sort-reset'))
    await waitFor(() => expect(location()).not.toMatch(/sort=|direction=/))
    expect(screen.getByTestId('issue-sort-chip')).toHaveTextContent(/^정렬$/)
  })

  test('기본 상태 메뉴는 수정일·내림차순에 체크돼 있고, 내림차순을 다시 골라도 주소에 정렬이 생기지 않는다', async () => {
    const { user, location } = openList([createIssue({ number: 7 })])
    await screen.findByTestId('issue-row-7')
    await user.click(screen.getByTestId('issue-sort-chip'))
    expect(await screen.findByTestId('issue-sort-key-updatedAt')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('issue-sort-direction-desc')).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByTestId('issue-sort-direction-desc'))
    expect(location()).not.toMatch(/sort=|direction=/)
    expect(screen.getByTestId('issue-sort-chip')).toHaveTextContent(/^정렬$/)
  })

  test('정렬만 걸린 0건은 필터 빈 상태가 아니라 「이슈가 없습니다」, 「필터 지우기」도 나오지 않는다', async () => {
    openList([], { path: `/projects/${KEY}?sort=createdAt&direction=asc` })
    expect(await screen.findByTestId('empty-no-issues')).toBeInTheDocument()
    expect(screen.queryByTestId('empty-filter')).not.toBeInTheDocument()
    expect(screen.queryByTestId('quick-filter-clear-all')).not.toBeInTheDocument()
  })

  test('「필터 지우기」는 필터만 지우고 정렬은 남긴다', async () => {
    const { user, location } = openList([createIssue({ number: 7 })], { path: `/projects/${KEY}?priority=HIGH&sort=assignee&direction=asc` })
    await screen.findByTestId('issue-row-7')
    await user.click(screen.getByTestId('quick-filter-clear-all'))
    await waitFor(() => expect(location()).not.toMatch(/priority=/))
    expect(location()).toMatch(/sort=assignee&direction=asc/)
  })

  test('보드도 같은 정렬로 컬럼마다 검색한다(컬럼 안 카드 순서)', async () => {
    const { api } = openList([createIssue({ number: 7 })], { path: `/projects/${KEY}?view=board&sort=dueDate&direction=asc` })
    await waitFor(() => expect(api.searches.some((u) => u.searchParams.has('statusId'))).toBe(true))
    const columnSearches = api.searches.filter((u) => u.searchParams.has('statusId'))
    expect(columnSearches.every((u) => u.searchParams.get('sort') === 'dueDate' && u.searchParams.get('direction') === 'asc')).toBe(true)
    expect(screen.getByTestId('issue-sort-chip')).toHaveTextContent('정렬: 마감일 ↑')
  })
})

// WP-2103 — 목록 「끝난 이슈 아래로」: 그룹 없는 목록은 기본 켜짐(closedLast=true), 정렬 메뉴 항목으로 끈다(URL closedLast=off).
describe('끝난 이슈 아래로 (WP-2103)', () => {
  const withClosedLast = (api: ReturnType<typeof openList>['api']) => api.searches.filter((u) => u.searchParams.get('closedLast') === 'true')

  test('그룹 없는 목록은 처음부터 closedLast=true 로 한 번만 검색한다', async () => {
    const { api } = openList([createIssue({ number: 7 })], { path: `/projects/${KEY}?group=none` })
    await screen.findByTestId('issue-row-7')
    expect(withClosedLast(api)).toHaveLength(1)
  })

  test('메뉴에서 끄면 주소에 closedLast=off 가 생기고 검색에서 closedLast 가 빠지며, 다시 켜면 되돌아온다', async () => {
    const { user, api, location } = openList([createIssue({ number: 7 })], { path: `/projects/${KEY}?group=none` })
    await screen.findByTestId('issue-row-7')
    await user.click(screen.getByTestId('issue-sort-chip'))
    const item = await screen.findByTestId('issue-sort-closed-last')
    expect(item).toHaveAttribute('aria-checked', 'true')
    await user.click(item)
    await waitFor(() => expect(location()).toMatch(/closedLast=off/))
    await waitFor(() => expect(api.lastBodySearch()?.searchParams.has('closedLast')).toBe(false))
    // 메뉴는 열린 채 — 이어서 다시 켠다.
    expect(screen.getByTestId('issue-sort-closed-last')).toHaveAttribute('aria-checked', 'false')
    await user.click(screen.getByTestId('issue-sort-closed-last'))
    await waitFor(() => expect(location()).not.toMatch(/closedLast/))
    // 처음 켜짐 조회와 같은 쿼리 키라 캐시를 다시 쓴다 — 새 요청 없이 closedLast=true 검색은 처음 한 번뿐이다.
    await waitFor(() => expect(screen.getByTestId('issue-sort-closed-last')).toHaveAttribute('aria-checked', 'true'))
    expect(withClosedLast(api)).toHaveLength(1)
  })

  test('「기본으로」는 정렬과 끝난 이슈 아래로 끔을 함께 되돌린다', async () => {
    const { user, location } = openList([createIssue({ number: 7 })], { path: `/projects/${KEY}?group=none&closedLast=off&sort=dueDate&direction=asc` })
    await screen.findByTestId('issue-row-7')
    expect(screen.getByTestId('issue-sort-chip')).toHaveTextContent('정렬: 마감일 ↑ · 끝난 이슈 섞음')
    await user.click(screen.getByTestId('issue-sort-chip'))
    await user.click(await screen.findByTestId('issue-sort-reset'))
    await waitFor(() => expect(location()).not.toMatch(/sort=/))
    expect(location()).not.toMatch(/closedLast/)
    expect(screen.getByTestId('issue-sort-chip')).toHaveTextContent(/^정렬$/)
  })

  // WP-2103 리뷰 후속 — 끈 것만으로도 기본 순서가 아니다: 칩이 켜짐 모양·문구로 알리고 「기본으로」가 살아 있다.
  test('정렬 없이 끄기만 해도 칩이 켜짐 모양과 「끝난 이슈 섞음」 문구를 보이고, 「기본으로」로 다시 켠다', async () => {
    const { user, location } = openList([createIssue({ number: 7 })], { path: `/projects/${KEY}?group=none&closedLast=off` })
    await screen.findByTestId('issue-row-7')
    const chip = screen.getByTestId('issue-sort-chip')
    expect(chip).toHaveTextContent('정렬 · 끝난 이슈 섞음')
    expect(chip).toHaveAccessibleName(/끝난 이슈 섞음/)
    expect(chip).not.toHaveClass('text-muted-foreground')
    await user.click(chip)
    const reset = await screen.findByTestId('issue-sort-reset')
    expect(reset).not.toHaveAttribute('data-disabled')
    await user.click(reset)
    await waitFor(() => expect(location()).not.toMatch(/closedLast/))
    expect(screen.getByTestId('issue-sort-chip')).toHaveClass('text-muted-foreground')
  })

  // WP-2103 리뷰 후속 — 기본 그룹 판정(사이클 목록) 전에는 groupBy 가 아직 null 이라도 항목을 보이지 않는다(보였다 사라지는 깜빡임 방지).
  test('사이클 목록을 받기 전(기본 그룹 판정 중)에는 메뉴에 끝난 이슈 아래로 항목이 없다', async () => {
    const { user } = openList([createIssue({ number: 7 })], {
      extra: [http.get(`${API}/projects/${KEY}/cycles`, () => new Promise<Response>(() => {}))],
    })
    await user.click(await screen.findByTestId('issue-sort-chip', {}, { timeout: 45_000 }))
    await screen.findByTestId('issue-sort-menu')
    expect(screen.queryByTestId('issue-sort-closed-last')).not.toBeInTheDocument()
  })

  test('그룹을 묶은 목록에서는 closedLast 를 보내지 않고 메뉴 항목도 없다', async () => {
    const { user, api } = openList([createIssue({ number: 7 })], { path: `/projects/${KEY}?group=status` })
    await screen.findByTestId('issue-row-7')
    expect(withClosedLast(api)).toHaveLength(0)
    await user.click(screen.getByTestId('issue-sort-chip'))
    await screen.findByTestId('issue-sort-menu')
    expect(screen.queryByTestId('issue-sort-closed-last')).not.toBeInTheDocument()
  })

  test('보드에서는 closedLast 를 보내지 않고 메뉴 항목도 없다', async () => {
    const { user, api } = openList([createIssue({ number: 7 })], { path: `/projects/${KEY}?view=board` })
    await waitFor(() => expect(api.searches.some((u) => u.searchParams.has('statusId'))).toBe(true))
    expect(withClosedLast(api)).toHaveLength(0)
    await user.click(screen.getByTestId('issue-sort-chip'))
    await screen.findByTestId('issue-sort-menu')
    expect(screen.queryByTestId('issue-sort-closed-last')).not.toBeInTheDocument()
  })
})

// WP-1929 리뷰 3차 — 그룹 헤더 수(headerCount) 판정 규칙.
// 임시(이전 필터) 총계 placeholder 는 행과 맞물려 있을 때만 쓴다 · 실패·로드 뒤에는 행 수 폴백 · 로딩 중만 비운다.
describe('그룹 헤더 수 (WP-1929 리뷰 3차)', () => {
  const counts = (entries: [string, number][]) => new Map(entries)

  test('요청 실패·로드 완료 뒤에는 키가 없어도 행 수로 보인다(영영 비어 있지 않다)', () => {
    expect(headerCount('status', '12', 3, counts([['12', 7]]), false, false, true)).toBe(7)
    // 총계 응답에 키가 없는 그룹(0건·낙관적 변경) — 임시 총계가 아닐 때만 행 수 폴백.
    expect(headerCount('status', '99', 3, counts([['12', 7]]), false, false, true)).toBe(3)
  })

  test('총계를 기다리는 동안만 비운다', () => {
    expect(headerCount('status', '12', 3, counts([]), true, false, true)).toBeNull()
  })

  test('임시(이전 필터) 총계에 없는 그룹은 진짜 총계가 올 때까지 비운다 — 행 수로 깜빡이지 않는다', () => {
    expect(headerCount('status', '99', 3, counts([['12', 7]]), false, true, false)).toBeNull()
  })

  test('임시 총계는 행이 아직 이전 결과일 때만, 행이 이미 바뀌었으면 비운다 — 총계와 행이 어긋나지 않게', () => {
    // 행도 아직 이전 결과(placeholder) → 이전 총계를 그대로 써서 헤더가 사라졌다 다시 뜨지 않게 한다.
    expect(headerCount('status', '12', 3, counts([['12', 7]]), false, true, false)).toBe(7)
    // 행은 새 결과로 바뀌었는데 총계는 이전 필터 값 → 어긋나 보이니 비운다.
    expect(headerCount('status', '12', 3, counts([['12', 7]]), false, true, true)).toBeNull()
  })

  test('에픽 그룹은 집계 API 가 없어 늘 행 수다', () => {
    expect(headerCount('epic', 'epic-1', 4, counts([['epic-1', 9]]), false, false, true)).toBe(4)
  })
})

// WP-1929 리뷰 4차 — 오프라인에서 필터를 바꾸면 총계 요청이 paused 로 끝나지 않는다. 그때 이전 필터 총계
// placeholder 자리에 있으면 ① 행이 캐시에서 바로 와 rowsUpdated 가 되는 순간 모든 그룹 헤더가 null 로 비어
// 온라인이 될 때까지 계속 비었고(3차 2 와 같은 증상 — 기다림이 끝나지 않아 회복되지 않는다) ② 이전 필터 총계가
// 새 필터 행 위에 그대로 뜨기도 했다. 그래서 오프라인 자리채움은 총계를 신뢰하지 않는다.
describe('오프라인 그룹 헤더 수 (WP-1929 리뷰 4차)', () => {
  const counts = (entries: [string, number][]) => new Map(entries)
  const base = { countsStaleBy: false, countsError: false, countsOffline: false, isPlaceholderData: false }

  test('오프라인 자리채움 총계는 신뢰하지 않는다 — 이전 필터 총계 대신 행 수가 뜬다', () => {
    const judged = countsJudgments({ ...base, countsOffline: true, isPlaceholderData: true })
    expect(judged).toEqual({ usable: false, provisional: false })
    // 이전 필터 총계 맵(헤더 키 12 = 32)을 그대로 두면 새 필터 행 위에 32 가 뜬다 — 맵을 비워 행 수로 내린다.
    const map = judged.usable ? counts([['12', 32]]) : counts([])
    expect(headerCount('status', '12', 3, map, false, judged.provisional, true)).toBe(3)
    // 임시 총계 갈래가 꺼져 있어 행이 이미 새 결과(rowsUpdated)여도 헤더가 null 로 비어 있지 않다.
    expect(headerCount('status', '99', 3, map, false, judged.provisional, true)).toBe(3)
  })

  test('온라인 자리채움은 그대로 임시 총계 갈래를 쓴다(3차 3 무변화)', () => {
    const judged = countsJudgments({ ...base, isPlaceholderData: true })
    expect(judged).toEqual({ usable: true, provisional: true })
    const map = counts([['12', 32]])
    // 행이 이미 새 결과 → 어긋나 보이니 진짜 총계가 올 때까지 비운다.
    expect(headerCount('status', '12', 3, map, false, judged.provisional, true)).toBeNull()
    // 행도 아직 이전 결과 → 이전 총계를 그대로 써서 「헤더가 사라졌다 다시 뜨는」 깜빡임을 막는다.
    expect(headerCount('status', '12', 3, map, false, judged.provisional, false)).toBe(32)
  })

  test('오프라인 자리채움이 아니면(그룹 기준 변경·요청 실패 아님) 기존 규칙 그대로다', () => {
    expect(countsJudgments({ ...base, countsOffline: true })).toEqual({ usable: true, provisional: false })
    expect(countsJudgments({ ...base, countsStaleBy: true, countsOffline: true, isPlaceholderData: true })).toEqual({
      usable: false,
      provisional: false,
    })
    expect(countsJudgments({ ...base, countsError: true })).toEqual({ usable: false, provisional: false })
    expect(countsJudgments({ ...base })).toEqual({ usable: true, provisional: false })
  })
})

// WP-1929 리뷰 2차 1·3차 2 — group-counts 요청이 실패하면(4xx/5xx) 헤더 수가 영영 비어 있지 않고 행 수로 내려간다.
describe('그룹 총계 요청 실패 (WP-1929 리뷰)', () => {
  test('그룹 총계 요청이 500 이어도 헤더 수는 행 수로 보인다', async () => {
    openList(
      [createIssue({ id: 1, number: 1, title: '리뷰 대기 작업', status: 'IN_PROGRESS', statusId: 12, statusName: '검토 중' })],
      {
        path: `/projects/${KEY}?group=status`,
        extra: [
          customStatuses(),
          http.get(`${API}/projects/${KEY}/issues/group-counts`, () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
        ],
      },
    )
    expect(await screen.findByTestId('list-group-toggle-12')).toHaveTextContent('검토 중')
    await waitFor(() => expect(screen.getByTestId('list-group-count-12')).toHaveTextContent(/^1$/))
  })
})
