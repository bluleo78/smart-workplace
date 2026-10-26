// 이슈 불러오기 실패 상태(WP-858) — 페이지 테스트(WP-980).
// 이슈 검색이 실패하면 빈 상태 대신 「이슈를 불러오지 못했습니다」+다시 시도를 보이고, 다시 시도가 재요청해 결과를 그리는지(목록·보드·사이클 그룹),
// 정수가 아닌 id 토큰(label=1.5)을 서버로 보내지 않는지 본다. 4xx/5xx → 안내·다시 시도라 브라우저 없이 판정되므로
// e2e/pages/projects/issue-load-error.spec.ts 에서 옮겼다. 다시 시도 동안 초점을 지키는지(WP-893)는 E2E(@input)에 남는다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { API, fail, issueSearch, KEY, projectMeta } from '@/test/kits/projects/listBoard'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { createIssue } from '../../../e2e/factories/issue.factory'

/** 프로젝트 메타 + 이슈 검색 — failing() 이 true 인 동안 500, 아니면 할 일 범주/열에만 이슈 1건. */
function mockSearch(failing: () => boolean, extra: (url: URL) => Response | null = () => null) {
  const search = issueSearch((url) => {
    const special = extra(url)
    if (special) return special
    if (failing()) return fail()
    // 목록은 범주(status)로, 보드 열은 프로젝트 상태 id(statusId — 시드 할 일 = 1)로 좁혀 온다(WP-808).
    const statusId = url.searchParams.get('statusId')
    const todo = statusId != null ? statusId === '1' : (url.searchParams.get('status') ?? 'TODO').includes('TODO')
    return todo ? [createIssue({ number: 7, title: '살아 있는 이슈', status: 'TODO' })] : []
  })
  return { search, handlers: [...projectMeta(), http.get(`${API}/projects/${KEY}/views`, () => HttpResponse.json([])), search.handler] }
}

describe('이슈 불러오기 실패 상태 (WP-858)', () => {
  test('목록: 검색이 500 이면 빈 상태가 아니라 실패 안내, 다시 시도하면 이슈가 보인다', async () => {
    let failing = true
    const { user } = renderPage(`/projects/${KEY}`, { handlers: mockSearch(() => failing).handlers })

    const error = await screen.findByTestId('issue-load-error', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(error).toHaveTextContent('이슈를 불러오지 못했습니다')
    expect(screen.queryByTestId('empty-no-issues')).not.toBeInTheDocument()
    expect(screen.queryByTestId('empty-filter')).not.toBeInTheDocument()

    failing = false
    await user.click(screen.getByTestId('issue-load-error-retry'))
    expect(await screen.findByTestId('issue-row-7')).toHaveTextContent('살아 있는 이슈')
    expect(screen.queryByTestId('issue-load-error')).not.toBeInTheDocument()
  })

  test('목록: 다시 보내도 같은 실패(400)면 다시 시도 대신 필터 초기화 — 누르면 필터 없이 다시 불러온다', async () => {
    // 서버가 주소의 조건(q)을 받지 못하면 400, 조건이 없으면 이슈 1건.
    const { handlers } = mockSearch(
      () => false,
      (url) => (url.searchParams.has('q') ? fail(400, '잘못된 조건') : null),
    )
    const { user, location } = renderPage(`/projects/${KEY}?q=broken`, { handlers })

    await waitFor(() => expect(screen.getByTestId('issue-load-error')).toHaveTextContent('필터를 초기화해 보세요'), { timeout: PAGE_LOAD_TIMEOUT })
    expect(screen.queryByTestId('issue-load-error-retry')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('issue-load-reset-filter'))

    await waitFor(() => expect(location()).toBe(`/projects/${KEY}`))
    expect(await screen.findByTestId('issue-row-7')).toBeInTheDocument()
  })

  test('보드: 열 검색이 500 이면 보드 전체에 실패 안내, 다시 시도하면 카드가 보인다', async () => {
    let failing = true
    const { user } = renderPage(`/projects/${KEY}?view=board`, { handlers: mockSearch(() => failing).handlers })

    await screen.findByTestId('issue-load-error', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(screen.queryByTestId('board-col-1')).not.toBeInTheDocument()

    failing = false
    await user.click(screen.getByTestId('issue-load-error-retry'))
    await waitFor(() => expect(screen.getByTestId('board-col-1')).toHaveTextContent('살아 있는 이슈'))
    expect(screen.queryByTestId('issue-load-error')).not.toBeInTheDocument()
  })

  test('사이클 그룹: 사이클 목록이 500 이면 실패 안내, 다시 시도하면 구간이 보인다', async () => {
    let failing = true
    const handlers = [
      ...mockSearch(() => false).handlers,
      http.get(`${API}/projects/${KEY}/cycles`, () => (failing ? fail() : HttpResponse.json([]))),
    ]
    const { user } = renderPage(`/projects/${KEY}?group=cycle`, { handlers })

    await screen.findByTestId('issue-load-error', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(screen.queryByTestId('issue-cycle-grouped-list')).not.toBeInTheDocument()

    failing = false
    await user.click(screen.getByTestId('issue-load-error-retry'))
    expect(await screen.findByTestId('issue-cycle-grouped-list')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-load-error')).not.toBeInTheDocument()
  })

  test('정수가 아닌 라벨 id(label=1.5)는 서버로 보내지 않고 이슈를 그대로 보인다', async () => {
    const { search, handlers } = mockSearch(() => false)
    renderPage(`/projects/${KEY}?label=1.5`, { handlers })

    expect(await screen.findByTestId('issue-row-7', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(search.urls.length).toBeGreaterThan(0)
    expect(search.urls.every((u) => !u.searchParams.has('label'))).toBe(true)
  })
})
