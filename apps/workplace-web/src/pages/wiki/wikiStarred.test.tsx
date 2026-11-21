// 노트 「즐겨찾기」(WP-1765) — 화면 컴포넌트 테스트(renderScreen + MSW). wikiRecent.test.tsx 를 본뜸.
// 즐겨찾기한 순서·공간 경로·제목 링크, 빈·오류(다시 시도) 상태, 별을 눌러 뺀 뒤 재조회로 줄이 사라지는 흐름을 본다.
// 별 토글 뒤 id 다시 받기(받는 중·실패 상태에서도 다른 행이 안 사라짐), 연타 시 한 번만 다시 받기,
// 받아 둔 행이 비거나 첫 쪽이 비어도 다음 쪽이 남으면 빈 상태가 아니고 다음 쪽 행이 이어 보이는 경우를 본다.
import type { QueryClient } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { afterEach, describe, expect, onTestFinished, test } from 'vitest'

import { controlIntersection } from '@/test/kits/layout'
import { clickRetryAndExpectErrorKept, gate } from '@/test/loadErrorRetry'
import { renderScreen } from '@/test/renderScreen'
import type { WikiStarredItem } from '@/types/wiki'

import { WikiStarredView } from './WikiStarredView'

function item(id: number, patch: Partial<WikiStarredItem> = {}): WikiStarredItem {
  return {
    pageId: id, title: `노트${id}`, spaceId: 7, spaceName: '제품팀', ancestorTitles: ['회의록'],
    starredAt: new Date(Date.now() - 5_000).toISOString(), url: `http://localhost/wiki/spaces/7/pages/${id}`, ...patch,
  }
}

const starredHandler = (items: WikiStarredItem[]) =>
  http.get('/api/v1/wiki/starred', () => HttpResponse.json({ items, nextCursor: null }))

// 목록은 id 집합으로 거르므로 집합 응답도 목록과 맞춰 준다.
const idsHandler = (ids: number[]) => http.get('/api/v1/wiki/starred/ids', () => HttpResponse.json({ pageIds: ids }))

/**
 * 행이 한순간이라도 사라지는지 지켜본다 — DOM 이 바뀔 때마다 확인하는 감시자. 반환 함수가 사라진 적 있으면 true.
 * waitFor 폴링은 중간 상태를 놓칠 수 있어, 「한순간도 안 사라진다」 단언은 이 감시자로 한다.
 */
const observers: MutationObserver[] = []
// 단언이 중간에 실패해도 감시자가 남지 않게 매 테스트 뒤 모두 끊는다.
afterEach(() => {
  observers.splice(0).forEach((o) => o.disconnect())
})

function watchRowGone(testId: string) {
  let gone = false
  const check = () => {
    if (!screen.queryByTestId(testId)) gone = true
  }
  const observer = new MutationObserver(check)
  observer.observe(document.body, { childList: true, subtree: true })
  observers.push(observer)
  return () => {
    observer.disconnect()
    return gone
  }
}

/** 진행 중인 뮤테이션과 요청이 모두 끝날 때까지 기다린다 — 토글 뒤 다시 받기까지 마친 상태를 본다. */
const settle = (queryClient: QueryClient) =>
  waitFor(() => {
    expect(queryClient.isMutating()).toBe(0)
    expect(queryClient.isFetching()).toBe(0)
  })

/**
 * 「토글이 서버에 닿기 전까지 id 받기는 계속 500」 핸들러 세트 — 마운트 재시도가 결과를 가리지 않게 한다.
 * 닿은 뒤(PUT 응답 직전)엔 pageIds 를 준다. counts 로 id 받기·PUT 호출 수를 센다.
 */
function idsFailUntilToggle({
  putStatus = 204,
  putDelay = 0,
  putGate,
  pageIds = [1, 2],
}: { putStatus?: number; putDelay?: number; putGate?: Promise<void>; pageIds?: number[] } = {}) {
  const counts = { ids: 0, puts: 0 }
  let toggled = false
  const handlers = [
    http.get('/api/v1/wiki/starred/ids', () => {
      counts.ids += 1
      return toggled ? HttpResponse.json({ pageIds }) : HttpResponse.json({ message: 'x' }, { status: 500 })
    }),
    http.put('/api/v1/wiki/pages/:id/star', async () => {
      counts.puts += 1
      if (putDelay) await delay(putDelay)
      // putGate 가 있으면 풀릴 때까지 PUT 을 붙든다 — 고정 지연과 달리 부하와 무관하게 「첫 PUT 이 끝나기 전」 구간을 보장한다.
      if (putGate) await putGate
      toggled = true
      return putStatus === 204 ? new HttpResponse(null, { status: 204 }) : HttpResponse.json({ message: 'x' }, { status: putStatus })
    }),
  ]
  return { handlers, counts }
}

describe('노트 즐겨찾기 화면', () => {
  test('listsStarredNewestFirst — 응답 순서대로 제목·경로, 제목 링크는 페이지 주소', async () => {
    renderScreen(<WikiStarredView />, {
      path: '/wiki/starred',
      handlers: [starredHandler([item(2, { spaceId: 3, ancestorTitles: [] }), item(1)]), idsHandler([2, 1])],
    })
    const list = await screen.findByTestId('wiki-starred-list')
    const rows = within(list).getAllByTestId(/^wiki-starred-row-/)
    expect(rows.map((r) => r.dataset.testid)).toEqual(['wiki-starred-row-2', 'wiki-starred-row-1'])
    expect(screen.getByTestId('wiki-starred-path-1')).toHaveTextContent('제품팀 › 회의록')
    expect(screen.getByTestId('wiki-starred-path-2')).toHaveTextContent('제품팀')
    expect(within(rows[0]).getByRole('link', { name: '노트2' })).toHaveAttribute('href', '/wiki/spaces/3/pages/2')
  })

  test('showsEmpty — 「즐겨찾기 없음」', async () => {
    renderScreen(<WikiStarredView />, { path: '/wiki/starred', handlers: [starredHandler([])] })
    const empty = await screen.findByTestId('wiki-starred-empty')
    expect(empty).toHaveTextContent('즐겨찾기 없음')
    // WP-1924: 빈 상태 규격(제목 14px 500, 600 아님).
    const title = within(empty).getByText('즐겨찾기 없음')
    expect(title).toHaveClass('text-sm', 'font-medium')
    expect(title).not.toHaveClass('font-semibold')
  })

  test('showsErrorWithRetry — 500 이면 오류 안내, 다시 시도로 재요청', async () => {
    let calls = 0
    const { user } = renderScreen(<WikiStarredView />, {
      path: '/wiki/starred',
      handlers: [
        idsHandler([1]),
        http.get('/api/v1/wiki/starred', () => {
          calls += 1
          return calls === 1 ? HttpResponse.json({ message: 'x' }, { status: 500 }) : HttpResponse.json({ items: [item(1)], nextCursor: null })
        }),
      ],
    })
    const error = await screen.findByTestId('wiki-starred-error')
    expect(error).toHaveTextContent('즐겨찾기를 불러오지 못했습니다')
    await user.click(within(error).getByRole('button', { name: /다시 시도/ }))
    expect(await screen.findByTestId('wiki-starred-row-1')).toBeInTheDocument()
    expect(calls).toBe(2)
  })

  test('unstarRemovesRowAndShowsEmpty — 별을 누르면 DELETE, 재조회된 빈 목록에 「즐겨찾기 없음」', async () => {
    const server = [item(1)]
    const calls: string[] = []
    const { user } = renderScreen(<WikiStarredView />, {
      path: '/wiki/starred',
      handlers: [
        http.get('/api/v1/wiki/starred', () => HttpResponse.json({ items: server, nextCursor: null })),
        http.get('/api/v1/wiki/starred/ids', () => HttpResponse.json({ pageIds: server.map((s) => s.pageId) })),
        http.delete('/api/v1/wiki/pages/:id/star', ({ params }) => {
          calls.push(`DELETE ${params.id}`)
          server.length = 0
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    })
    const row = await screen.findByTestId('wiki-starred-row-1')
    await user.click(await within(row).findByRole('button', { name: /즐겨찾기 빼기/ }))
    expect(await screen.findByTestId('wiki-starred-empty')).toBeInTheDocument()
    expect(calls).toEqual(['DELETE 1'])
  })

  test('unstarRemovesRowAtOnce — 별을 누르면 목록 재조회가 끝나기 전에 행이 사라진다', async () => {
    const server = [item(1), item(2)]
    let gets = 0
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { user } = renderScreen(<WikiStarredView />, {
      path: '/wiki/starred',
      handlers: [
        http.get('/api/v1/wiki/starred', async () => {
          gets += 1
          // 첫 조회는 즉시, 이후(무효화 재조회)는 붙들어 낙관적 제거만 보이게 한다.
          if (gets > 1) await gate
          return HttpResponse.json({ items: server, nextCursor: null })
        }),
        http.get('/api/v1/wiki/starred/ids', () => HttpResponse.json({ pageIds: server.map((s) => s.pageId) })),
        http.delete('/api/v1/wiki/pages/:id/star', ({ params }) => {
          const i = server.findIndex((s) => s.pageId === Number(params.id))
          if (i >= 0) server.splice(i, 1)
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    })
    const row = await screen.findByTestId('wiki-starred-row-1')
    await user.click(await within(row).findByRole('button', { name: /즐겨찾기 빼기/ }))
    await waitFor(() => expect(screen.queryByTestId('wiki-starred-row-1')).not.toBeInTheDocument())
    expect(screen.getByTestId('wiki-starred-row-2')).toBeInTheDocument()
    release()
  })
  // 별 토글 뒤 id 목록 다시 받기 — 낙관 갱신이 받는 중/실패한 캐시 위에 얹혀도 끝나면 서버 기준으로 맞춰야 한다(WP-1765 리뷰 후속).
  test('refetchesIdsAfterToggleWhileIdsLoading — id 목록을 받는 중 별을 눌러도 끝나면 다른 페이지 별이 채워진다', async () => {
    let idsCalls = 0
    // 첫 id 응답을 게이트로 붙든다. 고정 지연(300ms)은 부하로 클릭이 늦으면 id 가 먼저 도착해
    // 「받는 중」 전제가 깨지고 PUT 대신 DELETE 가 나간다(WP-1944).
    const { promise: firstIds, release } = gate()
    // 단언에 실패해도 붙든 요청이 남지 않게 테스트가 끝나면 푼다. 단언 전에 풀면 첫 응답만으로 별이 채워져 다시 받기를 확인하지 못한다.
    onTestFinished(release)
    const { user } = renderScreen(<WikiStarredView />, {
      path: '/wiki/starred',
      handlers: [
        starredHandler([item(1), item(2)]),
        http.get('/api/v1/wiki/starred/ids', async () => {
          idsCalls += 1
          if (idsCalls === 1) await firstIds
          return HttpResponse.json({ pageIds: [1, 2] })
        }),
        http.put('/api/v1/wiki/pages/:id/star', async () => {
          // 현실적 왕복 지연 — 낙관값만 있는 구간이 길어도 다른 행이 사라지면 안 된다.
          await delay(50)
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    })
    const row1 = await screen.findByTestId('wiki-starred-row-1')
    // 첫 id 요청이 나가 붙들린 상태에서만 누른다.
    await waitFor(() => expect(idsCalls).toBeGreaterThanOrEqual(1))
    const wasGone = watchRowGone('wiki-starred-row-2')
    await user.click(within(row1).getByRole('button', { name: '즐겨찾기' }))
    const row2 = screen.getByTestId('wiki-starred-row-2')
    await waitFor(() => expect(within(row2).getByTestId('wiki-star-button')).toHaveAttribute('aria-pressed', 'true'))
    expect(idsCalls).toBeGreaterThanOrEqual(2)
    // 누른 뒤부터 끝날 때까지 다른 행이 한순간도 사라지지 않았다.
    expect(wasGone()).toBe(false)
  })

  test('refetchesIdsAfterToggleWhenIdsFailed — id 받기가 실패한 뒤 토글하면 다시 받는다', async () => {
    const { handlers, counts } = idsFailUntilToggle({ putDelay: 50 })
    const { user } = renderScreen(<WikiStarredView />, {
      path: '/wiki/starred',
      handlers: [starredHandler([item(1), item(2)]), ...handlers],
    })
    const row1 = await screen.findByTestId('wiki-starred-row-1')
    await waitFor(() => expect(counts.ids).toBeGreaterThanOrEqual(1))
    const wasGone = watchRowGone('wiki-starred-row-2')
    await user.click(within(row1).getByRole('button', { name: '즐겨찾기' }))
    const row2 = screen.getByTestId('wiki-starred-row-2')
    await waitFor(() => expect(within(row2).getByTestId('wiki-star-button')).toHaveAttribute('aria-pressed', 'true'))
    expect(counts.ids).toBeGreaterThanOrEqual(2)
    // ids 받기가 실패한 상태에서도 다른 행은 끝까지 보인다(왕복 중 포함).
    expect(wasGone()).toBe(false)
  })

  test('burstTogglesRefetchIdsOnce — id 를 받은 적 없을 때 연타하면 id 목록은 마지막 뒤 한 번만 다시 받는다', async () => {
    // 서버 값을 받은 적 없는 상태에서 눌러 「다시 받기」 표지가 켜지게 한다.
    // 첫 PUT 을 게이트로 붙들어, 부하로 두 번째 클릭이 늦어도 첫 PUT 이 먼저 끝나지 않게 한다(WP-1944).
    const { promise: putGate, release } = gate()
    // 클릭이 실패해도 붙든 PUT 이 남지 않게 테스트가 끝나면 푼다(두 클릭 뒤에도 바로 푼다 — 두 번 풀어도 무해).
    onTestFinished(release)
    const { handlers, counts } = idsFailUntilToggle({ putGate })
    const { user, queryClient } = renderScreen(<WikiStarredView />, {
      path: '/wiki/starred',
      handlers: [starredHandler([item(1), item(2)]), ...handlers],
    })
    const row1 = await screen.findByTestId('wiki-starred-row-1')
    const row2 = screen.getByTestId('wiki-starred-row-2')
    await settle(queryClient)
    // 클릭 뒤 생긴 ids 요청만 센다 — 준비가 끝난 뒤 카운터를 0 으로 되돌린다.
    counts.ids = 0
    await user.click(within(row2).getByRole('button', { name: '즐겨찾기' }))
    await user.click(within(row1).getByRole('button', { name: '즐겨찾기' }))
    release()
    await waitFor(() => expect(counts.puts).toBe(2))
    await settle(queryClient)
    expect(counts.ids).toBe(1)
  })

  test('noIdsRefetchWhenServerCacheFresh — id 가 이미 서버 값이면 성공한 토글 뒤 id 를 다시 받지 않는다', async () => {
    let idsCalls = 0
    const { user, queryClient } = renderScreen(<WikiStarredView />, {
      path: '/wiki/starred',
      handlers: [
        starredHandler([item(1), item(2)]),
        http.get('/api/v1/wiki/starred/ids', () => {
          idsCalls += 1
          return HttpResponse.json({ pageIds: [1, 2] })
        }),
        http.delete('/api/v1/wiki/pages/:id/star', () => new HttpResponse(null, { status: 204 })),
      ],
    })
    const row1 = await screen.findByTestId('wiki-starred-row-1')
    await waitFor(() => expect(within(row1).getByTestId('wiki-star-button')).toHaveAttribute('aria-pressed', 'true'))
    await settle(queryClient)
    idsCalls = 0
    await user.click(within(row1).getByRole('button', { name: '즐겨찾기 빼기' }))
    await waitFor(() => expect(screen.queryByTestId('wiki-starred-row-1')).not.toBeInTheDocument())
    await settle(queryClient)
    expect(idsCalls).toBe(0)
  })

  test('failedToggleWithoutServerIdsDoesNotRollbackWrongly — id 를 받기 전 실패한 토글은 캐시를 잘못 되돌리지 않는다', async () => {
    // 바꾸기가 실패 응답을 받기 전까지 id 받기는 계속 실패한다.
    const { handlers } = idsFailUntilToggle({ putStatus: 500, pageIds: [1] })
    const { user, queryClient } = renderScreen(<WikiStarredView />, {
      path: '/wiki/starred',
      handlers: [starredHandler([item(1)]), ...handlers],
    })
    const row1 = await screen.findByTestId('wiki-starred-row-1')
    await settle(queryClient)
    await user.click(within(row1).getByRole('button', { name: '즐겨찾기' }))
    await settle(queryClient)
    // 서버 값은 [1] — 실패한 토글이 없던 값을 [] 로 되돌려 별이 꺼진 채 남으면 안 된다.
    await waitFor(() => expect(within(screen.getByTestId('wiki-starred-row-1')).getByTestId('wiki-star-button')).toHaveAttribute('aria-pressed', 'true'))
  })

  test('keepsLoadMoreWhenPageEmptiedButNextExists — 받아 둔 행을 모두 빼도 다음 쪽이 있으면 빈 상태가 아니다', async () => {
    // 서버도 빼기를 반영한다 — 재조회한 첫 쪽은 비었지만 다음 쪽 cursor 는 남는다.
    let removed = false
    const { user } = renderScreen(<WikiStarredView />, {
      path: '/wiki/starred',
      handlers: [
        http.get('/api/v1/wiki/starred', ({ request }) => {
          const cursor = new URL(request.url).searchParams.get('cursor')
          return HttpResponse.json(cursor ? { items: [], nextCursor: null } : { items: removed ? [] : [item(1)], nextCursor: 'c2' })
        }),
        http.get('/api/v1/wiki/starred/ids', () => HttpResponse.json({ pageIds: removed ? [] : [1] })),
        http.delete('/api/v1/wiki/pages/:id/star', () => {
          removed = true
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    })
    const row = await screen.findByTestId('wiki-starred-row-1')
    await user.click(await within(row).findByRole('button', { name: /즐겨찾기 빼기/ }))
    await waitFor(() => expect(screen.queryByTestId('wiki-starred-row-1')).not.toBeInTheDocument())
    expect(screen.queryByTestId('wiki-starred-empty')).not.toBeInTheDocument()
    expect(screen.getByTestId('wiki-starred-more')).toBeInTheDocument()
  })

  test('emptyFirstPageWithCursorIsNotEmptyState — 빈 쪽에 nextCursor 가 와도 빈 상태가 아니고 다음 쪽 행이 이어 보인다', async () => {
    const io = controlIntersection()
    renderScreen(<WikiStarredView />, {
      path: '/wiki/starred',
      handlers: [
        http.get('/api/v1/wiki/starred', ({ request }) => {
          const cursor = new URL(request.url).searchParams.get('cursor')
          return HttpResponse.json(cursor ? { items: [item(5)], nextCursor: null } : { items: [], nextCursor: 'c2' })
        }),
        idsHandler([5]),
      ],
    })
    // 센티널이 보이는 것으로 취급해 다음 쪽(행 5)을 받아 오게 한다 — 빈 상태가 아니라 목록 + 더 보기 흐름이어야 한다.
    await screen.findByTestId('wiki-starred-more')
    io.set(() => true)
    expect(await screen.findByTestId('wiki-starred-row-5')).toBeInTheDocument()
    expect(screen.queryByTestId('wiki-starred-empty')).not.toBeInTheDocument()
  })
})

// WP-1788: 실패 뒤 다시 시도하면 status 가 pending 으로 되돌아간다 — 그 동안에도 오류 안내·초점이 남아야 한다.
describe('노트 즐겨찾기 화면 — 실패 뒤 다시 시도하는 동안 안내와 초점이 남는다(WP-1788)', () => {
  test('WP-1788 다시 시도 성공 — 응답 전에도 안내·초점 유지, 응답 뒤 목록', async () => {
    let calls = 0
    const { promise, release } = gate()
    const { user } = renderScreen(<WikiStarredView />, {
      path: '/wiki/starred',
      handlers: [
        idsHandler([1]),
        http.get('/api/v1/wiki/starred', async () => {
          calls += 1
          if (calls === 1) return HttpResponse.json({ message: 'x' }, { status: 500 })
          await promise
          return HttpResponse.json({ items: [item(1)], nextCursor: null })
        }),
      ],
    })
    await clickRetryAndExpectErrorKept(user, 'wiki-starred-error', () => calls)
    await act(async () => { release() })
    expect(await screen.findByTestId('wiki-starred-row-1')).toBeInTheDocument()
    expect(screen.queryByTestId('wiki-starred-error')).toBeNull()
  })

  test('WP-1788 첫 진입 로딩 — 실패 전 첫 조회 중에는 「불러오는 중…」', async () => {
    const { promise, release } = gate()
    renderScreen(<WikiStarredView />, {
      path: '/wiki/starred',
      handlers: [
        idsHandler([]),
        http.get('/api/v1/wiki/starred', async () => { await promise; return HttpResponse.json({ items: [], nextCursor: null }) }),
      ],
    })
    expect(await screen.findByText('불러오는 중…')).toBeInTheDocument()
    await act(async () => { release() })
    expect(await screen.findByTestId('wiki-starred-empty')).toBeInTheDocument()
  })
})
