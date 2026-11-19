// 노트 즐겨찾기 별(WP-1765) — 머리줄 별 단추 토글·초기 채움·트리 ⋯ 메뉴·최근 행 별·실패 되돌림을 본다(renderScreen + MSW).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test } from 'vitest'

import { attachSilentCollab, editorSideHandlers } from '@/test/kits/wiki/testkit-b3-msw'
import { renderScreen } from '@/test/renderScreen'
import type { WikiRecentItem } from '@/types/wiki'

import { wikiPageDetail, wikiPageSummary, wikiSpace } from '../../../e2e/factories/wiki.factory'
import { WikiModuleRoutes } from './testkit-b3'
import { WikiRecentView } from './WikiRecentView'

const PERSONAL = wikiSpace({ id: 1, type: 'PERSONAL', name: '내 위키', role: 'OWNER' })
const PAGE = 101

/** 노트 모듈을 페이지 101 로 띄운다 — ids 응답과 star 호출 기록을 받는다. */
function openPage(opts: { starredIds?: number[]; handlers?: RequestHandler[] } = {}) {
  const calls: string[] = []
  // 서버 상태를 흉내 낸다 — 넣기·빼기 뒤 재조회(onSettled)가 낙관값을 낡은 응답으로 덮지 않게.
  const server = new Set(opts.starredIds ?? [])
  attachSilentCollab()
  const view = renderScreen(<WikiModuleRoutes />, {
    path: `/wiki/spaces/1/pages/${PAGE}`,
    handlers: [
      ...(opts.handlers ?? []),
      ...editorSideHandlers,
      http.get('/api/v1/wiki/starred/ids', () => HttpResponse.json({ pageIds: [...server] })),
      http.put('/api/v1/wiki/pages/:id/star', ({ params }) => {
        calls.push(`PUT ${params.id}`)
        server.add(Number(params.id))
        return new HttpResponse(null, { status: 204 })
      }),
      http.delete('/api/v1/wiki/pages/:id/star', ({ params }) => {
        calls.push(`DELETE ${params.id}`)
        server.delete(Number(params.id))
        return new HttpResponse(null, { status: 204 })
      }),
      http.post('/api/v1/wiki/pages/:id/open', () => new HttpResponse(null, { status: 204 })),
      http.get('/api/v1/wiki/spaces', () => HttpResponse.json([PERSONAL])),
      http.get('/api/v1/wiki/spaces/:id/pages', () => HttpResponse.json([wikiPageSummary({ id: PAGE })])),
      http.get('/api/v1/wiki/spaces/:id/members', () => HttpResponse.json([])),
      http.get('/api/v1/wiki/pages/:id', () => HttpResponse.json(wikiPageDetail({ id: PAGE, spaceId: 1 }))),
      http.get('/api/v1/wiki/pages/:id/summary', () =>
        HttpResponse.json({ summary: null, status: 'TOO_SHORT', summaryVersion: null, pageVersion: 1, summarizedAt: null }),
      ),
    ],
  })
  return { ...view, calls }
}

/** 머리줄 별 단추. */
async function headerStar() {
  const header = await screen.findByTestId('wiki-page-header')
  return within(header).findByTestId('wiki-star-button')
}

describe('노트 즐겨찾기 별', () => {
  test('headerStarToggles — 누르면 PUT 후 눌림·「즐겨찾기 빼기」, 다시 누르면 DELETE', async () => {
    const { user, calls } = openPage()
    const star = await headerStar()
    expect(star).toHaveAttribute('aria-pressed', 'false')
    expect(star).toHaveAccessibleName('즐겨찾기')
    await user.click(star)
    await waitFor(() => expect(star).toHaveAttribute('aria-pressed', 'true'))
    expect(star).toHaveAccessibleName('즐겨찾기 빼기')
    await waitFor(() => expect(calls).toEqual([`PUT ${PAGE}`]))
    await user.click(star)
    await waitFor(() => expect(star).toHaveAttribute('aria-pressed', 'false'))
    await waitFor(() => expect(calls).toEqual([`PUT ${PAGE}`, `DELETE ${PAGE}`]))
  })

  test('startsFilledWhenIdIncluded — ids 에 있으면 처음부터 눌림', async () => {
    openPage({ starredIds: [PAGE] })
    const star = await headerStar()
    await waitFor(() => expect(star).toHaveAttribute('aria-pressed', 'true'))
  })

  test('treeMenuStars — 트리 행 ⋯ 「즐겨찾기」 → PUT', async () => {
    const { user, calls } = openPage()
    const row = await screen.findByTestId(`wiki-tree-row-${PAGE}`)
    await user.click(within(row).getByRole('button', { name: /페이지 메뉴/ }))
    await user.click(await screen.findByTestId(`wiki-tree-star-${PAGE}`))
    await waitFor(() => expect(calls).toEqual([`PUT ${PAGE}`]))
  })

  test('treeMenuUnstars — ids 에 있으면 문구가 「즐겨찾기 빼기」이고 DELETE', async () => {
    const { user, calls } = openPage({ starredIds: [PAGE] })
    const row = await screen.findByTestId(`wiki-tree-row-${PAGE}`)
    await user.click(within(row).getByRole('button', { name: /페이지 메뉴/ }))
    const item = await screen.findByTestId(`wiki-tree-star-${PAGE}`)
    await waitFor(() => expect(item).toHaveTextContent('즐겨찾기 빼기'))
    await user.click(item)
    await waitFor(() => expect(calls).toEqual([`DELETE ${PAGE}`]))
  })

  test('rollsBackOnFailure — PUT 500 이면 먼저 눌림(낙관)이 보이다가 풀리고 토스트', async () => {
    // 응답을 붙들어 두어 실패 전의 낙관 상태를 볼 수 있게 한다.
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { user } = openPage({
      handlers: [
        http.put('/api/v1/wiki/pages/:id/star', async () => {
          await gate
          return HttpResponse.json({ message: 'x' }, { status: 500 })
        }),
      ],
    })
    const star = await headerStar()
    await user.click(star)
    await waitFor(() => expect(star).toHaveAttribute('aria-pressed', 'true'))
    release()
    expect(await screen.findByText('즐겨찾기를 바꾸지 못했어요')).toBeInTheDocument()
    await waitFor(() => expect(star).toHaveAttribute('aria-pressed', 'false'))
  })

  test('failureKeepsLaterToggle — 두 페이지를 연달아 눌러 첫 PUT 이 실패해도 둘째 별은 채워진 채', async () => {
    const mk = (id: number): WikiRecentItem => ({
      pageId: id, title: `노트${id}`, spaceId: 7, spaceName: '제품팀', ancestorTitles: [], lastAction: 'OPEN',
      lastAt: new Date().toISOString(), url: `http://localhost/wiki/spaces/7/pages/${id}`,
    })
    const server = new Set<number>()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { user } = renderScreen(<WikiRecentView />, {
      path: '/wiki/recent',
      handlers: [
        http.get('/api/v1/wiki/recent', () => HttpResponse.json({ items: [mk(5), mk(6)], nextCursor: null })),
        http.get('/api/v1/wiki/starred/ids', () => HttpResponse.json({ pageIds: [...server] })),
        http.put('/api/v1/wiki/pages/:id/star', async ({ params }) => {
          if (params.id === '5') return HttpResponse.json({ message: 'x' }, { status: 500 })
          // 둘째 요청은 붙들어 둔다 — 첫 실패 직후에도 아직 서버엔 없는 상태.
          await gate
          server.add(Number(params.id))
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    })
    const star5 = within(await screen.findByTestId('wiki-recent-row-5')).getByTestId('wiki-star-button')
    const star6 = within(await screen.findByTestId('wiki-recent-row-6')).getByTestId('wiki-star-button')
    await user.click(star5)
    await user.click(star6)
    expect(await screen.findByText('즐겨찾기를 바꾸지 못했어요')).toBeInTheDocument()
    await waitFor(() => expect(star5).toHaveAttribute('aria-pressed', 'false'))
    // 첫 실패의 되돌림·재조회가 둘째 낙관값을 지우지 않는다.
    expect(star6).toHaveAttribute('aria-pressed', 'true')
    release()
    await waitFor(() => expect(server.has(6)).toBe(true))
    await waitFor(() => expect(star6).toHaveAttribute('aria-pressed', 'true'))
  })

  test('recentRowStar — 최근 행의 별 단추 → PUT', async () => {
    const calls: string[] = []
    const item: WikiRecentItem = {
      pageId: 5, title: '노트5', spaceId: 7, spaceName: '제품팀', ancestorTitles: [], lastAction: 'OPEN',
      lastAt: new Date().toISOString(), url: 'http://localhost/wiki/spaces/7/pages/5',
    }
    const { user } = renderScreen(<WikiRecentView />, {
      path: '/wiki/recent',
      handlers: [
        http.get('/api/v1/wiki/recent', () => HttpResponse.json({ items: [item], nextCursor: null })),
        http.get('/api/v1/wiki/starred/ids', () => HttpResponse.json({ pageIds: [] })),
        http.put('/api/v1/wiki/pages/:id/star', ({ params }) => {
          calls.push(`PUT ${params.id}`)
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    })
    const row = await screen.findByTestId('wiki-recent-row-5')
    await user.click(within(row).getByTestId('wiki-star-button'))
    await waitFor(() => expect(calls).toEqual(['PUT 5']))
  })
})
