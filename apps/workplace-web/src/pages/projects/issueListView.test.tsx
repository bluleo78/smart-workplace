// 팀 리스트 뷰 — 화면 테스트(WP-971, WP-1002 에서 목록 화면(ProjectDetailPage)만 띄우게 바꿈).
// 행 셀 표기(마감일·마감 지남·우선순위 5단계·하위 진행률), 기본 검색 쿼리, 필터 facet 옵션·아이콘과 선택 → URL·검색 파라미터,
// 빈 상태 두 가지, 사용자 정의 상태(WP-808) 필터·그룹 헤더, 상태 목록 도착 전 그리지 않기는 브라우저 없이 판정되므로
// e2e/pages/projects/{issue-list,issue-list-duedate}.spec.ts 에서 옮겼다.
// 라우트 → 목록 API → 행 배선(@wiring)·칩/레이블 폭(@layout)·우선순위 「!」 가상 요소(@layout)·history 한 번만 쌓기(@platform)는 E2E 에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test } from 'vitest'

import { renderProjectScreen } from '@/test/kits/projects/projectDetailScreen'
import { API, projectScreen } from '@/test/kits/projects/projectScreens'
import { openQuickFacet } from '@/test/kits/projects/quickFilter'
import type { ScreenUser } from '@/test/renderScreen'
import type { IssueResponse } from '@/types/issue'

import { createIssue } from '../../../e2e/factories/issue.factory'
import { createMember } from '../../../e2e/factories/project.factory'
import { seedStatuses, withCustomStatuses } from '../../../e2e/factories/projectStatus.factory'

const KEY = 'WP'

/** 목록을 연다 — search 는 검색 응답(기본 issues 그대로), extra 는 테스트별 핸들러(앞에 두어 우선). */
function openList(
  issues: IssueResponse[],
  { path = `/projects/${KEY}`, extra = [], search }: { path?: string; extra?: RequestHandler[]; search?: (url: URL) => IssueResponse[] } = {},
) {
  const api = projectScreen(KEY, { search: search ?? (() => issues) })
  const view = renderProjectScreen(path, { handlers: [...extra, ...api.handlers] })
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
  // 필터가 걸린 0건 → 「검색 결과가 없습니다」 + 「필터 초기화」, 누르면 q 가 빠진 주소·요청으로 다시 불러 행이 보인다.
  test('필터 결과 0건이면 검색 빈 상태가 보이고 「필터 초기화」로 q 를 지우면 이슈가 보인다', async () => {
    const { user, location, lastSearch } = openList([], {
      path: `/projects/${KEY}?q=xxxxxxxxxnotfound`,
      search: (url) => (url.searchParams.has('q') ? [] : [createIssue({ number: 5, title: '정상 이슈' })]),
    })
    expect(await screen.findByTestId('empty-filter')).toBeInTheDocument()
    expect(screen.getByText('검색 결과가 없습니다')).toBeInTheDocument()
    expect(screen.getByText('다른 키워드나 필터 조건을 사용해 보세요.')).toBeInTheDocument()
    await user.click(screen.getByTestId('empty-reset-filter'))
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}`))
    expect(await screen.findByTestId('issue-row-5')).toBeInTheDocument()
    expect(lastSearch()!.searchParams.has('q')).toBe(false)
  })

  // 필터 없는 0건 → 「이슈가 없습니다」 + 「새 태스크 만들기」 → 유형 중립 「새 이슈」 다이얼로그(#641).
  test('필터 없이 0건이면 「이슈가 없습니다」와 CTA, 누르면 「새 이슈」 다이얼로그가 열린다', async () => {
    const { user } = openList([])
    expect(await screen.findByTestId('empty-no-issues')).toBeInTheDocument()
    expect(screen.getByText('이슈가 없습니다')).toBeInTheDocument()
    expect(screen.getByText('새 태스크를 만들어 프로젝트를 시작하세요.')).toBeInTheDocument()
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
