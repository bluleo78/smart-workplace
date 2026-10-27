// 노트를 다른 스페이스로 옮기기(WP-988) — 「이동…」에서 스페이스를 골라 옮기면 대상 스페이스 id 와 함께 PATCH 하고 새 주소로 따라간다.
// 옮겨진 노트의 예전 주소는 그 노트의 실제 스페이스 주소로 연결된다. 대화상자 안의 경고·선택은 WikiMovePageDialog.test.tsx.
import { screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { beforeAll, expect, test, vi } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { wikiPageDetail, wikiPageSummary, wikiSpace } from '../../../e2e/factories/wiki.factory'

// 에디터는 동기화 서버(WebSocket)에 붙는다 — 이 파일은 주소·요청만 본다.
vi.mock('../../components/wiki/WikiEditor', () => ({ WikiEditor: () => null }))

const spaces = [wikiSpace({ id: 1, type: 'TEAM', name: '제품팀', role: 'OWNER' }), wikiSpace({ id: 2, type: 'TEAM', name: '디자인팀', role: 'EDITOR' })]
const tree1 = [wikiPageSummary({ id: 10, parentId: null, position: 0, title: '옮길 문서' })]
const tree2 = [wikiPageSummary({ id: 20, parentId: null, position: 0, title: '디자인 가이드' })]

// Radix Select 가 부르는 jsdom 에 없는 API.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

const baseHandlers = (moves: unknown[] = [], pageSpaceId = 1) => [
  http.get('/api/v1/wiki/spaces', () => HttpResponse.json(spaces)),
  http.get('/api/v1/wiki/spaces/1/pages', () => HttpResponse.json(tree1)),
  http.get('/api/v1/wiki/spaces/2/pages', () => HttpResponse.json(tree2)),
  http.get('/api/v1/wiki/pages/10', () => HttpResponse.json(wikiPageDetail({ id: 10, spaceId: pageSpaceId, title: '옮길 문서' }))),
  http.get('/api/v1/wiki/pages/:id/backlinks', () => HttpResponse.json([])),
  http.get('/api/v1/wiki/pages/:id/mentions', () => HttpResponse.json([])),
  http.get('/api/v1/wiki/pages/10/move-preview', () =>
    HttpResponse.json({ pageCount: 1, lostMemberCount: 0, gainedMemberCount: 0, keptShares: [], revokedShares: [] }),
  ),
  http.patch('/api/v1/wiki/pages/10/move', async ({ request }) => {
    moves.push(await request.json())
    return new HttpResponse(null, { status: 204 })
  }),
]

test('「이동…」에서 다른 스페이스의 페이지 아래를 고르면 targetSpaceId 와 함께 옮기고 새 주소로 간다', async () => {
  const moves: unknown[] = []
  const view = renderPage('/wiki/spaces/1', { handlers: baseHandlers(moves) })
  const row = await screen.findByTestId('wiki-tree-row-10', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await view.user.click(within(row).getByRole('button', { name: /페이지 메뉴/ }))
  await view.user.click(await screen.findByRole('menuitem', { name: '이동…' }))
  await screen.findByTestId('wiki-move-dialog')
  await view.user.click(screen.getByTestId('wiki-move-space'))
  await view.user.click(await screen.findByRole('option', { name: '디자인팀' }))
  await view.user.click(await screen.findByTestId('wiki-move-option-20'))
  await waitFor(() => expect(screen.getByTestId('wiki-move-confirm')).toBeEnabled())
  await view.user.click(screen.getByTestId('wiki-move-confirm'))

  await waitFor(() => expect(moves).toEqual([{ parentId: 20, position: 1_000_000, targetSpaceId: 2 }]))
  await waitFor(() => expect(view.location()).toBe('/wiki/spaces/2/pages/10'))
})

test('옮겨진 노트의 예전 스페이스 주소를 열면 노트의 실제 스페이스 주소로 연결된다', async () => {
  const view = renderPage('/wiki/spaces/1/pages/10', { handlers: baseHandlers([], 2) })
  await waitFor(() => expect(view.location()).toBe('/wiki/spaces/2/pages/10'), { timeout: PAGE_LOAD_TIMEOUT })
})

test('보던 노트를 다른 스페이스로 옮기면 낡은 상세 캐시 때문에 옛 스페이스 주소로 되돌아가지 않는다', async () => {
  const moves: unknown[] = []
  // 옮긴 뒤의 상세 재조회는 늦게 온다 — 그동안 화면은 캐시만 본다(캐시가 옛 spaceId 면 옛 주소로 튄다).
  // 앞에 둔 핸들러가 먼저 맞는다 — 기본 상세 핸들러(늘 스페이스 1)보다 앞에 둔다.
  const handlers = [
    http.get('/api/v1/wiki/pages/10', async () => {
      if (moves.length === 0) return HttpResponse.json(wikiPageDetail({ id: 10, spaceId: 1, title: '옮길 문서' }))
      await delay(800)
      return HttpResponse.json(wikiPageDetail({ id: 10, spaceId: 2, title: '옮길 문서' }))
    }),
    ...baseHandlers(moves),
  ]
  const view = renderPage('/wiki/spaces/1/pages/10', { handlers })
  const row = await screen.findByTestId('wiki-tree-row-10', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await view.user.click(within(row).getByRole('button', { name: /페이지 메뉴/ }))
  await view.user.click(await screen.findByRole('menuitem', { name: '이동…' }))
  await view.user.click(screen.getByTestId('wiki-move-space'))
  await view.user.click(await screen.findByRole('option', { name: '디자인팀' }))
  await view.user.click(await screen.findByTestId('wiki-move-option-20'))
  await waitFor(() => expect(screen.getByTestId('wiki-move-confirm')).toBeEnabled())
  await view.user.click(screen.getByTestId('wiki-move-confirm'))

  await waitFor(() => expect(view.location()).toBe('/wiki/spaces/2/pages/10'))
  // 재조회가 오기 전(800ms) 동안 새 주소에 머문다.
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 100))
    expect(view.location()).toBe('/wiki/spaces/2/pages/10')
  }
})
