// 저장한 뷰를 바꿀 때 중간 상태가 비치지 않는다(WP-1049) — 페이지 테스트(WP-971).
// 예전에는 칩을 누르면 ① 고른 뷰 상태가 주소보다 먼저 커밋돼 칩 둘이 켜지고 「수정됨」이 한 프레임 비쳤고,
// ② 새 결과가 오기 전 목록이 스켈레톤으로 떨어졌다가(보드는 컬럼마다 「이슈 없음」) 새 목록으로 바뀌었다.
// 이제 칩과 주소는 한 번에 바뀌고, 새 결과가 올 때까지 이전 목록을 흐리게(진행 막대) 두었다가 한 번에 바꾼다.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { SavedViewResponse } from '@/types/savedView'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { makeTaskType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { createMember, createProject } from '../../../e2e/factories/project.factory'

const KEY = 'WP'

function savedView(id: number, name: string, query: string): SavedViewResponse {
  return {
    id,
    name,
    query,
    visibility: 'PRIVATE',
    ownerId: 1,
    mine: true,
    pinned: false,
    createdAt: '2026-10-28T00:00:00Z',
    updatedAt: '2026-10-28T00:00:00Z',
  }
}

const VIEWS = [
  savedView(1, '높음만', 'priority=HIGH&group=none'),
  savedView(2, '낮음만', 'priority=LOW&group=none'),
  savedView(3, '보드', 'view=board&group=none'),
  savedView(4, '최저만', 'priority=LOWEST&group=none'),
  savedView(5, '보드 높음', 'view=board&group=none&priority=HIGH'),
]

const issue = (number: number, title: string) =>
  createIssue({ id: number, number, projectKey: KEY, title, type: makeTaskType() })

// 우선순위 조건별 결과 — 「전체」는 두 건, 「높음만」·「낮음만」은 한 건씩, 「최저만」은 0건.
const RESULTS: Record<string, ReturnType<typeof issue>[]> = {
  '': [issue(1, '전체 목록 이슈'), issue(2, '전체 목록 둘째 이슈')],
  HIGH: [issue(3, '높음 이슈')],
  LOW: [issue(4, '낮음 이슈')],
  LOWEST: [],
}

// 늦출 요청 — 우선순위 조건(또는 보드 컬럼 요청)이 이 값이면 release() 전까지 응답하지 않는다.
let gate: { match: (url: URL) => boolean; promise: Promise<void>; release: () => void } | null = null
function holdWhile(match: (url: URL) => boolean) {
  let release = () => {}
  const promise = new Promise<void>((r) => (release = r))
  gate = { match, promise, release }
  return () => release()
}
afterEach(() => {
  gate?.release()
  gate = null
})

const handlers = [
  http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY, type: 'TEAM', viewerIsMember: true }))),
  http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
  http.get(`/api/v1/projects/${KEY}/members`, () =>
    HttpResponse.json([createMember({ userId: 1, name: '테스트 사용자', username: 'testuser', role: 'OWNER' })]),
  ),
  http.get(`/api/v1/projects/${KEY}/saved-views`, () => HttpResponse.json(VIEWS)),
  http.get(`/api/v1/projects/${KEY}/issues`, async ({ request }) => {
    const url = new URL(request.url)
    if (gate?.match(url)) await gate.promise
    const priority = url.searchParams.get('priority') ?? ''
    return HttpResponse.json(createIssueSearchResponse(RESULTS[priority] ?? [], null))
  }),
]

// state·search 는 사이드바 고정 보기 링크처럼 router state 와 보기 쿼리를 붙여 들어오는 진입을 흉내 낼 때만 준다.
async function open(state?: unknown, search = '') {
  const view = renderPage(`/projects/${KEY}${search}`, { handlers, state })
  await screen.findAllByText('전체 목록 이슈', {}, { timeout: PAGE_LOAD_TIMEOUT })
  return view
}

describe('저장한 뷰 전환 — 중간 상태 없이 한 번에 바뀐다', () => {
  test('새 뷰의 결과가 오기 전에는 이전 목록을 흐리게 두고(스켈레톤 없음), 결과가 오면 한 번에 바꾼다', async () => {
    await open()
    // 스크롤 컨테이너는 그대로 남는다 — 새 결과가 들어온 때에만 맨 위로 올린다(흐린 동안 올리면 이전 목록이 튄다).
    const scrollTo = vi.spyOn(screen.getByTestId('issue-list-scroll'), 'scrollTo')
    const release = holdWhile((u) => u.searchParams.get('priority') === 'HIGH')
    fireEvent.click(screen.getByTestId('view-chip-1'))

    // 칩은 곧바로 새 뷰 — 목록은 이전 결과를 진행 막대와 함께 흐리게 둔다.
    expect(await screen.findByTestId('results-refreshing')).toBeInTheDocument()
    expect(screen.getByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('전체 목록 이슈')).toBeInTheDocument()
    expect(screen.queryByTestId('list-loading-skeleton')).not.toBeInTheDocument()
    // 흐린 이전 목록은 입력을 받지 않는다 — 지금 조건과 다른 이슈를 열거나 고르지 않게.
    expect(screen.getByTestId('issue-list-scroll').closest('[inert]')).not.toBeNull()
    expect(scrollTo).not.toHaveBeenCalled()

    release()
    expect(await screen.findByText('높음 이슈')).toBeInTheDocument()
    expect(screen.queryByText('전체 목록 이슈')).not.toBeInTheDocument()
    expect(screen.queryByTestId('results-refreshing')).not.toBeInTheDocument()
    expect(screen.getByTestId('issue-list-scroll').closest('[inert]')).toBeNull()
    expect(screen.getByTestId('issue-list-scroll')).toBe(scrollTo.mock.contexts[0])
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 })
  })

  // WP-2125: 검색어를 치고 300ms 안에 「전체」 칩·저장 보기를 골라도 대기 중이던 q 쓰기가 되살아나지 않는다.
  test('검색어를 치자마자 「전체」 칩·저장 보기를 골라도 300ms 뒤 q 가 되살아나지 않는다', async () => {
    const { user, location } = await open()
    const box = () => screen.getByRole('textbox', { name: '이슈 필터: 제목·키' })
    for (const chip of ['view-chip-all', 'view-chip-1']) {
      await user.click(box())
      await user.paste('결제')
      fireEvent.click(screen.getByTestId(chip))
      await new Promise((r) => setTimeout(r, 500))
      expect(new URL(location(), 'http://x').searchParams.has('q')).toBe(false)
    }
  })

  // WP-2125: 「필터 지우기」 이동의 state 가 이전 state 를 복사하면 고정 보기 링크의 savedViewId 가 남아 그 보기가 다시 골라진다.
  describe('고정 보기 링크로 들어온 뒤', () => {
    // 링크 보기(#3 보드)로 열려 칩이 켜진 상태에서 시작한다.
    const openLinked = async () => {
      const view = await open({ savedViewId: 3 }, '?view=board&group=none')
      await waitFor(() => expect(screen.getByTestId('view-chip-3')).toHaveAttribute('aria-pressed', 'true'))
      return view
    }

    test('「전체」 칩을 누르면 링크 보기로 되돌아가지 않는다', async () => {
      await openLinked()
      fireEvent.click(screen.getByTestId('view-chip-all'))
      await waitFor(() => expect(screen.getByTestId('view-chip-all')).toHaveAttribute('aria-pressed', 'true'))
      await new Promise((r) => setTimeout(r, 200))
      expect(screen.getByTestId('view-chip-all')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('view-chip-3')).toHaveAttribute('aria-pressed', 'false')
    })

    test('다른 저장 보기를 누르면 그 보기가 켜지고 링크 보기로 되돌아가지 않는다', async () => {
      await openLinked()
      fireEvent.click(screen.getByTestId('view-chip-1'))
      expect(await screen.findByText('높음 이슈')).toBeInTheDocument()
      await new Promise((r) => setTimeout(r, 200))
      expect(screen.getByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('view-chip-3')).toHaveAttribute('aria-pressed', 'false')
    })
  })

  test('칩을 오가도 화면에 칩 둘이 켜지거나 「수정됨」·뷰 업데이트가 비치는 순간이 없다', async () => {
    await open()
    // 커밋마다 칩 줄의 모양을 적는다 — 한 커밋의 DOM 변경은 같은 마이크로태스크에서 한 번에 보인다.
    const snapshots: string[] = []
    const bar = screen.getByTestId('view-chip-bar')
    const record = () => {
      const on = [...bar.querySelectorAll('[aria-pressed="true"]')].map((e) => e.getAttribute('data-testid'))
      const modified = bar.querySelectorAll('[data-testid^="view-chip-modified-"]').length
      snapshots.push(`${on.join(',')}${modified ? ' +수정됨' : ''}`)
    }
    const mo = new MutationObserver(record)
    mo.observe(bar, { subtree: true, attributes: true, childList: true, characterData: true })

    // act 밖에서 누른다 — fireEvent 의 act 는 클릭의 커밋과 주소(전환) 커밋을 한꺼번에 흘려 사이 화면을 볼 수 없다.
    // 브라우저처럼 클릭은 바로, 전환은 다음 작업으로 커밋돼야 둘이 따로 커밋되는 결함이 보인다.
    const click = (testId: string) => screen.getByTestId(testId).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    click('view-chip-1')
    expect(await screen.findByText('높음 이슈')).toBeInTheDocument()
    click('view-chip-2')
    expect(await screen.findByText('낮음 이슈')).toBeInTheDocument()
    click('view-chip-all')
    expect(await screen.findByText('전체 목록 이슈')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('view-chip-all')).toHaveAttribute('aria-pressed', 'true'))
    mo.disconnect()

    // 켜진 칩은 늘 하나이고 「수정됨」은 없다. 지나간 칩 순서도 고른 순서 그대로다.
    for (const s of snapshots) expect(s).toMatch(/^view-chip-[^,+ ]+$/)
    const order = snapshots.filter((s, i) => s !== snapshots[i - 1])
    expect(order).toEqual(['view-chip-1', 'view-chip-2', 'view-chip-all'])
  })

  test('결과가 0건인 뷰에서 바꾸면 빈 상태를 새 조건에 붙여 보이지 않고 스켈레톤을 보인다', async () => {
    await open()
    fireEvent.click(screen.getByTestId('view-chip-4'))
    expect(await screen.findByTestId('empty-filter')).toBeInTheDocument()

    // 아직 받지 않은 「높음만」 요청을 늦춘다 — 자리채움은 0건이라 둘 목록이 없다.
    const release = holdWhile((u) => u.searchParams.get('priority') === 'HIGH')
    fireEvent.click(screen.getByTestId('view-chip-1'))
    expect(await screen.findByTestId('list-loading-skeleton')).toBeInTheDocument()
    // 결과가 있는 조건에 이전 조건의 빈 상태(필터 빈 상태·「이슈가 없습니다 / 새 이슈 만들기」)가 비치지 않는다.
    expect(screen.queryByTestId('empty-no-issues')).not.toBeInTheDocument()
    expect(screen.queryByTestId('empty-create-issue')).not.toBeInTheDocument()
    expect(screen.queryByTestId('empty-filter')).not.toBeInTheDocument()

    release()
    expect(await screen.findByText('높음 이슈')).toBeInTheDocument()
    expect(screen.queryByTestId('list-loading-skeleton')).not.toBeInTheDocument()
  })

  test('보드에서 조건을 바꿔 받는 동안 컬럼 수는 이전 조건의 수 대신 비워 둔다', async () => {
    await open()
    fireEvent.click(screen.getByTestId('view-chip-3'))
    await waitFor(() => expect(screen.queryAllByTestId(/^board-col-pending-/)).toHaveLength(0))
    const counts = () => screen.getAllByTestId(/^board-col-count-/).map((e) => e.textContent)
    expect(counts()).toContain('2')

    const release = holdWhile((u) => u.searchParams.has('statusId') && u.searchParams.get('priority') === 'HIGH')
    fireEvent.click(screen.getByTestId('view-chip-5'))
    expect((await screen.findAllByTestId('results-refreshing')).length).toBeGreaterThan(0)
    // 흐린 이전 카드는 남지만 수는 비어 있다 — 「2」가 새 조건의 수처럼 또렷이 보이지 않는다.
    expect(screen.getAllByText('전체 목록 이슈').length).toBeGreaterThan(0)
    expect(counts().every((c) => c === '')).toBe(true)

    release()
    await waitFor(() => expect(screen.queryAllByTestId('results-refreshing')).toHaveLength(0))
    expect(counts()).toContain('1')
  })

  test('보드를 처음 열 때 컬럼은 결과가 오기 전까지 카드 자리만 보이고 「이슈 없음」을 그리지 않는다', async () => {
    await open()
    // 보드 컬럼 요청(상태 조건이 붙는다)만 늦춘다.
    const release = holdWhile((u) => u.searchParams.has('statusId'))
    fireEvent.click(screen.getByTestId('view-chip-3'))

    const pending = await screen.findAllByTestId(/^board-col-pending-/)
    expect(pending.length).toBeGreaterThan(0)
    expect(screen.queryAllByTestId(/^board-col-empty-/)).toHaveLength(0)

    release()
    await waitFor(() => expect(screen.queryAllByTestId(/^board-col-pending-/)).toHaveLength(0))
    expect(screen.getAllByText('전체 목록 이슈').length).toBeGreaterThan(0)
  })
})

