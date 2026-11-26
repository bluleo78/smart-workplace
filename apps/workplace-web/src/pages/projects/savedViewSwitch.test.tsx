// 저장한 뷰를 바꿀 때 중간 상태가 비치지 않는다(WP-1049) — 페이지 테스트(WP-971).
// 예전에는 칩을 누르면 ① 고른 뷰 상태가 주소보다 먼저 커밋돼 칩 둘이 켜지고 「수정됨」이 한 프레임 비쳤고,
// ② 새 결과가 오기 전 목록이 스켈레톤으로 떨어졌다가(보드는 컬럼마다 「이슈 없음」) 새 목록으로 바뀌었다.
// 이제 칩과 주소는 한 번에 바뀌고, 새 결과가 올 때까지 이전 목록을 흐리게(진행 막대) 두었다가 한 번에 바꾼다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
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

  // WP-2125 리뷰 후속: 칩 적용은 startTransition 안이라 보기의 결과(/issues)가 늦으면 전환이 보류되어 지우기 신호가 커밋되지 않는다 —
  // 그 사이 300ms debounce 가 돌아도 q 가 보기 쿼리를 덮지 않게 클릭 순간 대기 중 쓰기를 동기로 접는다.
  test('보기의 결과 응답이 debounce 보다 늦어도 검색어를 치자마자 칩을 누르면 q 가 되살아나지 않는다', async () => {
    const { user, location } = await open()
    const release = holdWhile((u) => u.searchParams.get('priority') === 'HIGH')
    await user.click(screen.getByRole('textbox', { name: '이슈 필터: 제목·키' }))
    await user.paste('결제')
    fireEvent.click(screen.getByTestId('view-chip-1'))
    // 응답이 막힌 채 debounce(300ms)보다 오래 기다린다 — 전환이 보류된 동안에도 q 가 URL 에 쓰이면 안 된다.
    await new Promise((r) => setTimeout(r, 600))
    release()
    expect(await screen.findByText('높음 이슈')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 400))
    const search = new URL(location(), 'http://x').searchParams
    expect(search.has('q')).toBe(false)
    expect(search.get('priority')).toBe('HIGH')
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

// WP-2148: 칩 적용(startTransition)이 렌더에 닿기 전, 필터 바의 다른 조건 쓰기도 렌더 시점의 옛 값이 아니라 쓰는 순간의 라이브 주소 위에 얹힌다.
// 「높음만」(priority=HIGH&group=none) 결과를 늦춰 전환을 보류시키고, 그 사이 조작한 키만 바뀌고 priority 는 살아 있어야 한다.
// 「필터 지우기」(reset)는 뺀다 — 보류 중에는 렌더가 아직 필터 없는 전체 목록이라 hasActiveFilters 가 거짓이고 단추가 화면에 없다(사용자가 누를 수 없다).
describe('저장 보기 전환이 보류된 동안의 다른 조건 쓰기(WP-2148)', () => {
  // 한 act 안에서 두 번 클릭 — 렌더가 끼지 않아 두 번째 호출이 첫 클릭의 렌더 반영 전에 일어난다.
  const clickTwice = (el: HTMLElement) =>
    act(() => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

  const params = (location: () => string) => new URL(location(), 'http://x').searchParams

  // 전환 보류 상태 — apply() 가 history 만 먼저 바꾸고 렌더는 아직 옛 값인 순간을 replaceState 로 흉내 낸다(WP-2141 의 issueSearchSavedViewRace 와 같은 방식).
  // 칩 클릭 경로는 jsdom 에서 transition 이 곧바로 렌더에 닿아(결과 대기는 keepPreviousData) 렌더가 앞서므로 경합이 재현되지 않아, 마지막 테스트가 그 경로를 따로 본다.
  const openPending = async (query = '?priority=HIGH&group=none') => {
    const view = await open()
    window.history.replaceState(window.history.state, '', `/projects/${KEY}/issues${query}`)
    return view
  }

  test('(a) 그룹 기준을 바꿔도 보류 중인 우선순위 조건이 남는다', async () => {
    const { user, location } = await openPending()
    await user.click(screen.getByTestId('group-by-trigger'))
    await user.click(await screen.findByTestId('group-by-status'))
    await waitFor(() => expect(params(location).get('group')).toBe('status'))
    expect(params(location).get('priority')).toBe('HIGH')
  })

  test('(b) 다른 facet(유형)을 골라도 보류 중인 우선순위 조건이 남는다', async () => {
    const { user, location } = await openPending()
    await user.click(await screen.findByTestId('quick-filter-type-trigger'))
    const options = await screen.findAllByTestId(/^facet-value-type-/)
    await user.click(options[0])
    await waitFor(() => expect(params(location).has('type')).toBe(true))
    expect(params(location).get('priority')).toBe('HIGH')
  })

  test('(c) 보기를 보드로 바꿔도 보류 중인 우선순위 조건이 남는다', async () => {
    const { user, location } = await openPending()
    await user.click(within(screen.getByRole('group', { name: '뷰 전환' })).getByRole('button', { name: '보드' }))
    await waitFor(() => expect(params(location).get('view')).toBe('board'))
    expect(params(location).get('priority')).toBe('HIGH')
  })

  test('(d) 「완료 모두 보기」를 눌러도 보류 중인 우선순위 조건이 남는다', async () => {
    const { user, location } = await openPending()
    await user.click(screen.getByTestId('show-all-closed-toggle'))
    await waitFor(() => expect(params(location).get('closed')).toBe('all'))
    expect(params(location).get('priority')).toBe('HIGH')
  })

  test('(i) 보류 중 보기가 closed=all 을 걸었어도 「완료 모두 보기」를 누르면 켜진 채 남고 우선순위도 남는다', async () => {
    const { user, location } = await openPending('?priority=HIGH&group=none&closed=all')
    await user.click(screen.getByTestId('show-all-closed-toggle'))
    // 단추는 렌더 값(꺼짐)을 보였으므로 누르면 켜짐이 목표다 — 라이브 값을 뒤집으면 closed 가 사라진다.
    await waitFor(() => expect(params(location).get('closed')).toBe('all'))
    expect(params(location).get('priority')).toBe('HIGH')
  })

  test('(j) 보류 중 보기가 건 priority=HIGH 에 같은 facet 에서 낮음을 더해도 HIGH 가 남는다', async () => {
    const { user, location } = await openPending()
    await user.click(await screen.findByTestId('quick-filter-priority-trigger'))
    await user.click(await screen.findByTestId('facet-value-priority-LOW'))
    await waitFor(() => expect(params(location).get('priority')).toContain('LOW'))
    expect(params(location).get('priority')).toContain('HIGH')
  })

  test('(l) 렌더 전 같은 값을 켰다 끄면 주소에 그 값이 남지 않는다(마지막으로 보낸 값 기준)', async () => {
    const { user, location } = await open()
    await user.click(await screen.findByTestId('quick-filter-priority-trigger'))
    const opt = await screen.findByTestId('facet-value-priority-LOW')
    // 한 act 안에서 두 번 — 렌더가 끼지 않아 두 번째 호출이 첫 클릭의 렌더 반영 전에 일어난다.
    clickTwice(opt)
    await waitFor(() => expect(params(location).has('priority')).toBe(false))
  })

  test('(m) 렌더 [HIGH,LOW] 에서 HIGH 를 껐다 켜면 주소에 HIGH·LOW 가 모두 있다', async () => {
    const { user, location } = await open()
    await user.click(await screen.findByTestId('quick-filter-priority-trigger'))
    await user.click(await screen.findByTestId('facet-value-priority-HIGH'))
    await user.click(await screen.findByTestId('facet-value-priority-LOW'))
    await waitFor(() => expect(params(location).get('priority')).toContain('LOW'))
    const high = await screen.findByTestId('facet-value-priority-HIGH')
    clickTwice(high)
    await waitFor(() => expect(params(location).get('priority')).toContain('HIGH'))
    expect(params(location).get('priority')).toContain('LOW')
  })

  test('(n) 보류 중 보기가 건 priority=HIGH 에서 우선순위 facet 을 「선택 해제」하면 HIGH 도 비운다', async () => {
    const { user, location } = await openPending()
    await user.click(await screen.findByTestId('quick-filter-priority-trigger'))
    await user.click(await screen.findByTestId('facet-value-priority-LOW'))
    await waitFor(() => expect(params(location).get('priority')).toContain('LOW'))
    // 렌더 값 [HIGH,LOW] 에서 비우기 → next 가 빈 배열 — 보류 보기의 HIGH 도 남기지 않는다.
    await user.click(await screen.findByTestId('quick-filter-clear-priority'))
    await waitFor(() => expect(params(location).has('priority')).toBe(false))
  })

  test('(p) 보류 중 우선순위 LOW 를 켰다가 마지막 값 LOW 를 끄면 보류 보기의 HIGH 는 남는다(선택 해제와 구분)', async () => {
    const { user, location } = await openPending()
    await user.click(await screen.findByTestId('quick-filter-priority-trigger'))
    const low = await screen.findByTestId('facet-value-priority-LOW')
    // 한 act 안에서 켜고 끈다 — 렌더가 끼지 않아 토글이 [] 를 보내지만 선택 해제 단추가 아니라 LOW 만 뺀다.
    clickTwice(low)
    await waitFor(() => expect(params(location).get('priority')).toBe('HIGH'))
  })

  test('(o) 다른 화면 이동이 보류된 사이 「필터 지우기」는 주소도 지우기 신호(history state)도 내지 않는다', async () => {
    const { user } = await open()
    await user.click(await screen.findByTestId('quick-filter-priority-trigger'))
    await user.click(await screen.findByTestId('facet-value-priority-LOW'))
    await user.keyboard('{Escape}')
    const clearAll = await screen.findByTestId('quick-filter-clear-all')
    window.history.replaceState(window.history.state, '', '/projects/OTHER?x=1')
    const before = JSON.stringify(window.history.state)
    await user.click(clearAll)
    expect(window.location.pathname + window.location.search).toBe('/projects/OTHER?x=1')
    expect(JSON.stringify(window.history.state)).toBe(before)
  })

  test('(k) 보류 없이 우선순위 하나를 고르고 다시 해제하면 기존과 같다(대조군)', async () => {
    const { user, location } = await open()
    await user.click(await screen.findByTestId('quick-filter-priority-trigger'))
    await user.click(await screen.findByTestId('facet-value-priority-LOW'))
    await waitFor(() => expect(params(location).get('priority')).toBe('LOW'))
    await user.click(await screen.findByTestId('facet-value-priority-LOW'))
    await waitFor(() => expect(params(location).has('priority')).toBe(false))
  })

  test('(f) 다른 화면으로 이동이 보류된 사이(라이브 pathname 이 다름)에는 검색어를 이 화면 조건으로 쓰지 않는다', async () => {
    const { user } = await open()
    // 다른 화면으로 옮겨 가는 전환이 아직 렌더에 닿지 않은 순간 — 브라우저 주소만 먼저 바뀐 상태를 흉내 낸다.
    window.history.replaceState(window.history.state, '', '/projects/OTHER?x=1')
    await user.click(screen.getByRole('textbox', { name: '이슈 필터: 제목·키' }))
    await user.paste('결제')
    // debounce(300ms)보다 오래 기다려 쓰기가 일어날 기회를 준다 — 일어나지 않아야 하는 부재 확인이라 고정 대기.
    await new Promise((r) => setTimeout(r, 600))
    expect(window.location.pathname + window.location.search).toBe('/projects/OTHER?x=1')
  })

  test('(h) 다른 화면으로 이동이 보류된 사이(라이브 pathname 이 다름)에는 정렬을 이 화면 조건으로 쓰지 않는다', async () => {
    const { user } = await open()
    // 다른 화면으로 옮겨 가는 전환이 아직 렌더에 닿지 않은 순간 — 브라우저 주소만 먼저 바뀐 상태를 흉내 낸다((f)와 같은 모양).
    window.history.replaceState(window.history.state, '', '/projects/OTHER?x=1')
    await user.click(screen.getByTestId('issue-sort-chip'))
    await user.click(await screen.findByTestId('issue-sort-menu').then((m) => within(m).getAllByRole('menuitemradio')[1]))
    // 쓰기가 일어나지 않아야 하는 부재 확인이라 고정 대기.
    await new Promise((r) => setTimeout(r, 300))
    expect(window.location.pathname + window.location.search).toBe('/projects/OTHER?x=1')
  })

  test('(e) 정렬 칩으로 정렬을 바꿔도 보류 중인 우선순위 조건이 남는다', async () => {
    const { user, location } = await openPending()
    await user.click(screen.getByTestId('issue-sort-chip'))
    await user.click(await screen.findByTestId('issue-sort-menu').then((m) => within(m).getAllByRole('menuitemradio')[1]))
    await waitFor(() => expect(params(location).has('sort')).toBe(true))
    expect(params(location).get('priority')).toBe('HIGH')
  })

  test('(g) 보류 없이 그룹을 바꾸면 결과는 그대로다(대조군)', async () => {
    const { user, location } = await open()
    await user.click(screen.getByTestId('group-by-trigger'))
    await user.click(await screen.findByTestId('group-by-status'))
    await waitFor(() => expect(params(location).get('group')).toBe('status'))
    expect(params(location).has('priority')).toBe(false)
  })

  // 실제 apply 경로(칩 클릭 → startTransition) 위에서 검색어를 치고 debounce 가 지난 뒤 전환이 끝나도 q 와 보기 조건이 함께 있다.
  // 실제 apply 경로를 지나는지 보는 확인이며 jsdom 에서는 전환이 곧바로 커밋돼 base 코드에서도 통과한다 — WP-2148 회귀는 (a)~(f)가 지킨다.
  test('칩 클릭 → 보류 중 검색어 → debounce 경과 → 전환 완료 뒤 priority 와 q 가 함께 있다', async () => {
    const { user, location } = await open()
    const release = holdWhile((u) => u.searchParams.get('priority') === 'HIGH')
    fireEvent.click(screen.getByTestId('view-chip-1'))
    await user.click(screen.getByRole('textbox', { name: '이슈 필터: 제목·키' }))
    await user.paste('결제')
    await new Promise((r) => setTimeout(r, 600))
    release()
    expect(await screen.findByText('높음 이슈')).toBeInTheDocument()
    await waitFor(() => expect(params(location).get('q')).toBe('결제'))
    expect(params(location).get('priority')).toBe('HIGH')
  })
})
