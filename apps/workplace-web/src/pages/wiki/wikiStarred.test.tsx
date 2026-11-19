// 노트 「즐겨찾기」(WP-1765) — 화면 컴포넌트 테스트(renderScreen + MSW). wikiRecent.test.tsx 를 본뜸.
// 즐겨찾기한 순서·공간 경로·제목 링크, 빈·오류(다시 시도) 상태, 별을 눌러 뺀 뒤 재조회로 줄이 사라지는 흐름을 본다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

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
    expect(await screen.findByTestId('wiki-starred-empty')).toHaveTextContent('즐겨찾기 없음')
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
})
