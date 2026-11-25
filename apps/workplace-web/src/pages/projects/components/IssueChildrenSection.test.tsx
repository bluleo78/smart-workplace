// IssueChildrenSection — 하위 목록 섹션 화면 테스트.
// - 조회가 실패하면 진행률(「1/2」)만 남은 빈 목록 대신 실패 안내 + 다시 시도(WP-858).
// - 같은 프로젝트 하위 행에도 이슈 키(WP-1635).
// - 열린 하위만 보이고 끝난 하위는 「완료 n건」으로 접는다, 100건씩 「더 보기」, 하위 태스크도 /children 한 갈래(WP-1684).
// 이슈 상세 화면 배선은 subtasks·issueDetailFields 페이지 테스트가 맡는다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, it } from 'vitest'

import { childrenResolver } from '@/test/kits/projects/children'
import { recordRequests } from '@/test/kits/projects/issueDetailStubs'
import { clickRetryAndExpectErrorKept, gate } from '@/test/loadErrorRetry'
import { renderScreen } from '@/test/renderScreen'
import type { IssueResponse } from '@/types/issue'

import { createIssue } from '../../../../e2e/factories/issue.factory'
import { makeEpicType, makeSubtaskType, systemTypes } from '../../../../e2e/factories/issueType.factory'
import { createProject } from '../../../../e2e/factories/project.factory'
import { IssueChildrenSection } from './IssueChildrenSection'

const API = '/api/v1'
const CHILDREN = `${API}/projects/WP/issues/1/children`
const SEARCH = `${API}/projects/WP/issues`

/** 하위 하나 — 만든 순서를 id 순으로 맞춘다(서버가 (created_at, id) 로 정렬해 준다). */
const child = (id: number, status: IssueResponse['status'] = 'TODO', title = `하위 ${id}`) =>
  createIssue({ id, number: id, title, status, createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, id)).toISOString() })

/** 섹션을 띄운다 — 프로젝트·유형 조회와 하위 목록 API 를 MSW 로 준다. */
function renderSection(
  all: () => IssueResponse[],
  {
    parentTypeName = 'EPIC',
    childCount,
    childDoneCount,
    extra = [],
  }: { parentTypeName?: string; childCount?: number; childDoneCount?: number; extra?: RequestHandler[] } = {},
) {
  const items = all()
  return renderScreen(
    <IssueChildrenSection
      projectKey="WP"
      parentNumber={1}
      parentTypeName={parentTypeName}
      parentStatus="TODO"
      childCount={childCount ?? items.length}
      childDoneCount={childDoneCount ?? items.filter((it) => it.status === 'DONE' || it.status === 'CANCELED').length}
    />,
    {
      path: '/projects/WP/issues/1',
      handlers: [
        ...extra,
        http.get(`${API}/projects/WP`, () => HttpResponse.json(createProject({ key: 'WP' }))),
        http.get(`${API}/projects/WP/types`, () => HttpResponse.json(systemTypes())),
        http.get(CHILDREN, childrenResolver(all)),
      ],
    },
  )
}

describe('IssueChildrenSection — 하위 목록 조회 실패', () => {
  it('조회가 실패하면 실패 안내를 보이고, 다시 시도하면 하위 이슈를 그린다', async () => {
    let fail = true
    const { user } = renderSection(() => [child(10, 'TODO', '살아 있는 하위')], {
      parentTypeName: 'TASK',
      extra: [
        http.get(CHILDREN, () => {
          if (!fail) return undefined
          fail = false
          return new HttpResponse(null, { status: 500 })
        }),
      ],
    })

    const error = await screen.findByTestId('children-load-error')
    expect(error).toHaveTextContent('하위 이슈를 불러오지 못했습니다')

    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(screen.getByTestId('child-row-10')).toHaveTextContent('살아 있는 하위'))
    expect(screen.queryByTestId('children-load-error')).not.toBeInTheDocument()
  })
})

// WP-1820: 데이터 없이 실패한 쿼리를 다시 부르면 status 가 pending 으로 돌아간다 — 그 동안에도 안내·초점이 남아야 한다.
describe('IssueChildrenSection — WP-1820 조회 실패 뒤 다시 시도', () => {
  it('WP-1820 하위 목록 다시 시도 — 응답 전 안내·초점 유지, 응답 뒤 행', async () => {
    let calls = 0
    const { promise, release } = gate()
    const { user } = renderSection(() => [child(10, 'TODO', '살아 있는 하위')], {
      parentTypeName: 'TASK',
      extra: [
        http.get(CHILDREN, async () => {
          calls += 1
          if (calls === 1) return new HttpResponse(null, { status: 500 })
          await promise
          return undefined
        }),
      ],
    })
    await clickRetryAndExpectErrorKept(user, 'children-load-error', () => calls)
    expect(screen.queryByText('로딩 중…')).toBeNull()
    await act(async () => { release() })
    expect(await screen.findByTestId('child-row-10')).toBeInTheDocument()
    expect(screen.queryByTestId('children-load-error')).toBeNull()
  })

  it('WP-1820 끝난 하위 다시 시도 — 같은 기준', async () => {
    let closedCalls = 0
    const { promise, release } = gate()
    const { user } = renderSection(() => [child(1, 'DONE', '끝난 하위'), child(2, 'TODO', '열린 하위')], {
      extra: [
        http.get(CHILDREN, async ({ request }) => {
          if (new URL(request.url).searchParams.get('state') !== 'closed') return undefined
          closedCalls += 1
          if (closedCalls === 1) return new HttpResponse(null, { status: 500 })
          await promise
          return undefined
        }),
      ],
    })
    await user.click(await screen.findByTestId('children-closed-toggle'))
    await clickRetryAndExpectErrorKept(user, 'children-closed-load-error', () => closedCalls)
    expect(screen.queryByText('로딩 중…')).toBeNull()
    await act(async () => { release() })
    expect(await screen.findByTestId('children-closed-list')).toBeInTheDocument()
    expect(screen.queryByTestId('children-closed-load-error')).toBeNull()
  })

  it('WP-1820 첫 진입 로딩 중에는 실패 전이라 「로딩 중…」을 보인다', async () => {
    const { promise, release } = gate()
    renderSection(() => [child(10, 'TODO', '하위')], {
      parentTypeName: 'TASK',
      extra: [
        http.get(CHILDREN, async () => {
          await promise
          return undefined
        }),
      ],
    })
    expect(await screen.findByText('로딩 중…')).toBeInTheDocument()
    expect(screen.queryByTestId('children-load-error')).toBeNull()
    await act(async () => { release() })
    expect(await screen.findByTestId('child-row-10')).toBeInTheDocument()
  })
})

// WP-1635 — 하위 목록에 제목만 있으면 어느 이슈인지 바로 알 수 없어, 같은 프로젝트 하위 행에도 이슈 키를 보인다.
describe('IssueChildrenSection — 하위 행 이슈 키', () => {
  it('같은 프로젝트 하위 태스크 행에 유형 아이콘과 제목 사이로 이슈 키를 보인다', async () => {
    const sub = { ...child(12, 'TODO', '키가 보일 하위'), type: makeSubtaskType() }
    renderSection(() => [sub], { parentTypeName: 'TASK' })

    const row = await screen.findByTestId('child-row-12')
    const key = within(row).getByTestId('child-row-key')
    expect(key).toHaveTextContent('WP-12')
    // 키는 링크가 아닌 텍스트 — 행의 링크는 제목 하나뿐이다(탭 순서·스크린리더 중복 방지).
    expect(within(row).getAllByRole('link')).toHaveLength(1)
    expect(key.compareDocumentPosition(within(row).getByRole('link', { name: '키가 보일 하위' }))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    // 유형 아이콘 → 키 순서 — 아이콘이 키보다 앞에 온다.
    expect(within(row).getByTestId('issue-type-badge-5').compareDocumentPosition(key)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })
})

// WP-1684 — 하위가 많은 에픽에서 남은 일이 목록 끝에 묻히지 않게, 열린 하위만 보이고 끝난 하위는 「완료 n건」 한 줄로 접는다.
describe('IssueChildrenSection — 열린 하위만, 「완료 n건」 접기', () => {
  // 하위 60건 — 완료 54(취소 포함)·열림 6. 끝난 것이 먼저 만들어져 예전에는 열린 6건이 맨 아래 묻혔다.
  const sixty = () => [
    ...Array.from({ length: 54 }, (_, i) => child(i + 1, i === 0 ? 'CANCELED' : 'DONE')),
    ...Array.from({ length: 6 }, (_, i) => child(55 + i, i % 2 ? 'IN_PROGRESS' : 'TODO')),
  ]

  it('열린 6건만 보이고 그 아래 「완료 54건」(접힘) — 끝난 하위는 펼치기 전까지 묻지 않는다, 진행률은 54/60 그대로', async () => {
    const requests = recordRequests()
    renderSection(sixty)

    expect(await screen.findByTestId('child-row-55')).toBeInTheDocument()
    expect(screen.getAllByTestId(/^child-row-\d+$/).map((r) => r.dataset.testid)).toEqual([55, 56, 57, 58, 59, 60].map((n) => `child-row-${n}`))
    const toggle = screen.getByRole('button', { name: /완료 54건/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('child-progress-text')).toHaveTextContent('54/60')
    // 첫 조회는 열린 하위만(state=open), 끝난 하위는 펼칠 때 받는다.
    expect(requests.of('GET', CHILDREN).map((r) => r.search.get('state'))).toEqual(['open'])
    expect(requests.of('GET', CHILDREN)[0].search.get('size')).toBe('100')
    // 「완료 n건」 줄은 목록 아래·추가 입력 위.
    expect(toggle.compareDocumentPosition(screen.getByTestId('child-add-input'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.getByTestId('child-row-60').compareDocumentPosition(toggle)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('「완료 54건」을 누르면 끝난 하위 54건이 만든 순서로 펼쳐지고, 다시 누르면 접힌다', async () => {
    const requests = recordRequests()
    const { user } = renderSection(sixty)
    const toggle = await screen.findByRole('button', { name: /완료 54건/ })

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const closed = await screen.findByTestId('children-closed-list')
    await waitFor(() => expect(within(closed).getAllByTestId(/^child-row-\d+$/)).toHaveLength(54))
    expect(within(closed).getAllByTestId(/^child-row-\d+$/)[0]).toHaveAttribute('data-testid', 'child-row-1')
    expect(within(closed).getByTestId('child-row-1').querySelector('[data-status]')).toBeInTheDocument()
    expect(requests.of('GET', CHILDREN).map((r) => r.search.get('state'))).toEqual(['open', 'closed'])
    // 열린 목록은 그대로 위에 남는다.
    expect(screen.getByTestId('child-row-55')).toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('children-closed-list')).not.toBeInTheDocument()
    expect(screen.queryByTestId('child-row-1')).not.toBeInTheDocument()
  })

  it('하위가 모두 끝났으면 열린 목록 없이 「완료 n건」 한 줄만 보인다', async () => {
    renderSection(() => [child(1, 'DONE'), child(2, 'DONE'), child(3, 'CANCELED')])
    const toggle = await screen.findByRole('button', { name: /완료 3건/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryAllByTestId(/^child-row-\d+$/)).toHaveLength(0)
  })

  it('끝난 하위가 없으면 「완료 n건」 줄이 없다', async () => {
    renderSection(() => [child(1), child(2, 'IN_PROGRESS')])
    expect(await screen.findByTestId('child-row-2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /완료 \d+건/ })).not.toBeInTheDocument()
  })

  it('하위가 하나도 없으면 목록·「완료 n건」 없이 추가 입력만', async () => {
    const requests = recordRequests()
    renderSection(() => [])
    await waitFor(() => expect(requests.count('GET', CHILDREN)).toBe(1))
    expect(await screen.findByTestId('child-add-input')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /완료 \d+건/ })).not.toBeInTheDocument()
  })

  it('읽을 수 없는 하위는 열린 목록 아래 「볼 수 없는 하위 N건」, 그 아래 「완료 n건」', async () => {
    renderScreen(
      <IssueChildrenSection projectKey="WP" parentNumber={1} parentTypeName="EPIC" parentStatus="TODO" childCount={5} childDoneCount={2} />,
      {
        path: '/projects/WP/issues/1',
        handlers: [
          http.get(`${API}/projects/WP`, () => HttpResponse.json(createProject({ key: 'WP' }))),
          http.get(`${API}/projects/WP/types`, () => HttpResponse.json(systemTypes())),
          http.get(CHILDREN, childrenResolver(() => [child(1, 'DONE'), child(2)], 3)),
        ],
      },
    )
    const hidden = await screen.findByTestId('child-hidden-count')
    expect(hidden).toHaveTextContent('볼 수 없는 하위 3건')
    // 진행률(2/5)은 볼 수 없는 하위까지, 「완료 n건」은 볼 수 있는 것만 센다 — 차이는 「볼 수 없는 하위」 줄이 설명한다.
    const toggle = screen.getByRole('button', { name: /완료 1건/ })
    expect(screen.getByTestId('child-row-2').compareDocumentPosition(hidden)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(hidden.compareDocumentPosition(toggle)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })
})

// WP-2101 — 끝난 하위의 제목은 목록·카드와 같은 규칙(WP-2099)으로 흐리게, 취소는 삭선까지. 열린 하위는 그대로.
describe('IssueChildrenSection — 끝난 하위 제목 흐림·삭선', () => {
  it('열린 하위는 상태 이름이 「완료」여도 제목이 흐리지도 삭선되지도 않고, 행은 group 이다', async () => {
    renderSection(() => [{ ...child(1, 'IN_PROGRESS', '열린 하위'), statusName: '완료' }])
    const row = await screen.findByTestId('child-row-1')
    const link = within(row).getByRole('link', { name: '열린 하위' })
    expect(link).not.toHaveClass('text-muted-foreground')
    expect(link).not.toHaveClass('line-through')
    expect(row).toHaveClass('group')
  })

  it('펼친 완료 하위는 흐리고 호버 때 원래 색이며 삭선은 없고, 취소 하위는 삭선도 있다', async () => {
    const { user } = renderSection(() => [child(1, 'DONE', '완료 하위'), child(2, 'CANCELED', '취소 하위'), child(3)])
    await user.click(await screen.findByRole('button', { name: /완료 2건/ }))
    const closed = await screen.findByTestId('children-closed-list')
    const done = await within(closed).findByRole('link', { name: '완료 하위' })
    expect(done).toHaveClass('text-muted-foreground', 'group-hover:text-foreground')
    expect(done).not.toHaveClass('line-through')
    const canceled = within(closed).getByRole('link', { name: '취소 하위' })
    expect(canceled).toHaveClass('text-muted-foreground', 'group-hover:text-foreground', 'line-through')
    // 호버 밑줄이 삭선을 덮지 않게 둘을 함께 그리는 규칙이 붙는다
    expect(canceled).toHaveClass('hover:[&.line-through]:[text-decoration-line:underline_line-through]')
    expect(within(closed).getByTestId('child-row-1')).toHaveClass('group')
  })
})

describe('IssueChildrenSection — 100건씩 「더 보기」', () => {
  it('열린 하위가 101건이면 100건 뒤에 「더 보기」, 누르면 나머지 1건이 만든 순서대로 붙고 「더 보기」가 사라진다', async () => {
    const requests = recordRequests()
    const all = Array.from({ length: 101 }, (_, i) => child(i + 1))
    const { user } = renderSection(() => all)

    expect(await screen.findByTestId('child-row-100')).toBeInTheDocument()
    expect(screen.queryByTestId('child-row-101')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '더 보기' }))
    expect(await screen.findByTestId('child-row-101')).toBeInTheDocument()
    const rows = screen.getAllByTestId(/^child-row-\d+$/)
    expect(rows).toHaveLength(101)
    expect(rows.at(-1)).toHaveAttribute('data-testid', 'child-row-101')
    expect(screen.queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument()
    // 두 번째 요청은 첫 응답의 다음 커서를 싣는다.
    const opens = requests.of('GET', CHILDREN)
    expect(opens.map((r) => r.search.get('cursor'))).toEqual([null, '100'])
  })

  it('펼친 끝난 하위도 100건씩 — 「더 보기」로 이어 받는다', async () => {
    const all = [...Array.from({ length: 102 }, (_, i) => child(i + 1, 'DONE')), child(200)]
    const { user } = renderSection(() => all)
    await user.click(await screen.findByRole('button', { name: /완료 102건/ }))
    const closed = await screen.findByTestId('children-closed-list')
    await waitFor(() => expect(within(closed).getAllByTestId(/^child-row-\d+$/)).toHaveLength(100))
    // 열린 목록에는 다음 페이지가 없어 「더 보기」는 끝난 목록의 것 하나뿐이다.
    await user.click(within(closed).getByRole('button', { name: '더 보기' }))
    await waitFor(() => expect(within(closed).getAllByTestId(/^child-row-\d+$/)).toHaveLength(102))
    expect(within(closed).queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument()
  })
})

describe('IssueChildrenSection — 하위 태스크도 /children 한 갈래', () => {
  it('일반 이슈의 하위 태스크는 검색 API 를 쓰지 않고 /children 으로 받는다 — 100건을 넘어도 「더 보기」로 모두 본다', async () => {
    const requests = recordRequests()
    const all = Array.from({ length: 120 }, (_, i) => child(i + 1))
    const { user } = renderSection(() => all, { parentTypeName: 'TASK' })
    expect(await screen.findByTestId('child-row-100')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '더 보기' }))
    expect(await screen.findByTestId('child-row-120')).toBeInTheDocument()
    expect(requests.count('GET', SEARCH)).toBe(0)
  })
})

describe('IssueChildrenSection — 상태가 바뀌면 두 목록 모두 다시 받는다', () => {
  it('하위를 완료로 바꾼 뒤 검색 캐시를 무효화하면 열린 목록에서 빠지고 「완료 n건」이 하나 는다(펼친 끝난 목록에도 붙는다)', async () => {
    const all = [child(1, 'DONE'), child(2), child(3)]
    const { user, queryClient } = renderSection(() => all, { childCount: 3, childDoneCount: 1 })
    const toggle = await screen.findByRole('button', { name: /완료 1건/ })
    await user.click(toggle)
    const closed = await screen.findByTestId('children-closed-list')
    await waitFor(() => expect(within(closed).getAllByTestId(/^child-row-\d+$/)).toHaveLength(1))

    // 하위 2를 완료로 — 상태 변경 훅들이 쓰는 검색 접두 무효화와 같다.
    all[1] = { ...all[1], status: 'DONE' }
    await queryClient.invalidateQueries({ queryKey: ['issues', 'search', 'WP'] })

    expect(await screen.findByRole('button', { name: /완료 2건/ })).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(within(screen.getByTestId('children-closed-list')).getAllByTestId(/^child-row-\d+$/)).toHaveLength(2))
    expect(screen.getAllByTestId('child-row-2')).toHaveLength(1)
    expect(within(screen.getByTestId('children-closed-list')).getByTestId('child-row-2')).toBeInTheDocument()
  })
})

describe('IssueChildrenSection — 에픽 하위 추가', () => {
  it('하위를 추가하면 열린 목록 끝에 붙는다', async () => {
    const all = [child(1), child(2, 'DONE')]
    const { user } = renderSection(() => all, {
      extra: [
        http.post(SEARCH, async ({ request }) => {
          const { title } = (await request.json()) as { title: string }
          const made = { ...child(3, 'TODO', title), type: makeEpicType() }
          all.push(made)
          return HttpResponse.json(made)
        }),
      ],
    })
    await screen.findByTestId('child-row-1')
    await waitFor(() => expect(screen.getByTestId('epic-child-type-select')).toHaveTextContent('태스크'))
    await user.type(screen.getByTestId('child-add-input'), '새 하위{Enter}')
    expect(await screen.findByTestId('child-row-3')).toHaveTextContent('새 하위')
    const rows = screen.getAllByTestId(/^child-row-\d+$/)
    expect(rows.map((r) => r.dataset.testid)).toEqual(['child-row-1', 'child-row-3'])
  })
})
