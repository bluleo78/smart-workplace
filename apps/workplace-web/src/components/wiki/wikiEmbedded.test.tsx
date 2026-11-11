// 노트 사이드바·페이지를 공간을 지정해 프로젝트 「노트」 탭 안에 띄우는 모드(WP-1481).
// embedded 면 앱 제목·공간 선택 상자·공간 삭제를 숨기고, 주소는 WikiRoutesProvider 가 정한 탭 주소로 간다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { attachSilentCollab, editorSideHandlers } from '@/test/kits/wiki/testkit-b3-msw'
import { renderScreen } from '@/test/renderScreen'

import { wikiPageDetail, wikiPageSummary, wikiSpace } from '../../../e2e/factories/wiki.factory'
import { WikiPageView } from './WikiPageView'
import { projectWikiRoutes, WikiRoutesProvider } from './WikiRoutesContext'
import { WikiSidebar } from './WikiSidebar'

const BASE = '/projects/WP/notes'
const SPACE = wikiSpace({ id: 7, type: 'TEAM', name: '프로젝트 공간', role: 'OWNER', projectKey: 'WP' })

const spaceHandlers = [
  http.get('/api/v1/wiki/spaces', () => HttpResponse.json([SPACE])),
  http.get('/api/v1/wiki/spaces/:id/pages', () => HttpResponse.json([wikiPageSummary({ id: 31, title: '첫 노트' })])),
]

test('embedded 사이드바는 앱 제목·공간 선택 상자·공간 삭제가 없고, 행 클릭·새 노트는 탭 주소로 간다', async () => {
  const { user, location } = renderScreen(
    <WikiRoutesProvider value={projectWikiRoutes(7, BASE)}>
      <WikiSidebar spaceId={7} activePageId={null} embedded />
    </WikiRoutesProvider>,
    {
      path: BASE,
      handlers: [
        ...spaceHandlers,
        http.post('/api/v1/wiki/spaces/7/pages', () => HttpResponse.json(wikiPageDetail({ id: 99, spaceId: 7 }))),
        http.put('/api/v1/wiki/pages/:id/*', () => HttpResponse.json({})),
        ...editorSideHandlers,
      ],
    },
  )
  const row = await screen.findByTestId('wiki-tree-row-31')
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.queryByText('노트', { exact: true })).not.toBeInTheDocument()
  // 공간 삭제는 메뉴에서도 빠진다 — 메뉴는 남는다.
  await user.click(await screen.findByTestId('wiki-space-menu'))
  expect(await screen.findByTestId('wiki-space-shared-pages')).toBeInTheDocument()
  expect(screen.queryByTestId('wiki-space-delete')).not.toBeInTheDocument()
  await user.keyboard('{Escape}')

  await user.click(within(row).getByText('첫 노트'))
  await waitFor(() => expect(location()).toBe(`${BASE}/31`))
})

test('embedded 사이드바의 새 노트는 만든 페이지의 탭 주소로 이동한다', async () => {
  const { user, location } = renderScreen(
    <WikiRoutesProvider value={projectWikiRoutes(7, BASE)}>
      <WikiSidebar spaceId={7} activePageId={null} embedded />
    </WikiRoutesProvider>,
    {
      path: BASE,
      handlers: [
        ...spaceHandlers,
        http.post('/api/v1/wiki/spaces/7/pages', () => HttpResponse.json(wikiPageDetail({ id: 99, spaceId: 7 }))),
        ...editorSideHandlers,
      ],
    },
  )
  await screen.findByTestId('wiki-tree-row-31')
  await user.click(await screen.findByRole('button', { name: '새 페이지' }))
  await waitFor(() => expect(location()).toBe(`${BASE}/99`))
})

test('recordLastVisited=false 면 마지막으로 본 노트를 저장하지 않고, 기본은 저장한다', async () => {
  attachSilentCollab()
  const handlers = [
    ...editorSideHandlers,
    ...spaceHandlers,
    http.get('/api/v1/wiki/pages/:id/summary', () =>
      HttpResponse.json({ summary: null, status: 'TOO_SHORT', summaryVersion: null, pageVersion: 1, summarizedAt: null }),
    ),
    http.get('/api/v1/wiki/pages/:id', ({ params }) => HttpResponse.json(wikiPageDetail({ id: Number(params.id), spaceId: 7 }))),
  ]
  localStorage.clear()
  const off = renderScreen(<WikiPageView pageId={31} spaceId={7} recordLastVisited={false} />, { path: BASE, handlers })
  // 불러오기·effect 가 끝날 시간을 준다(부재 확인이라 고정 대기 — 아래 기본 모드가 같은 조건에서 저장됨을 보인다).
  await new Promise((r) => setTimeout(r, 500))
  expect(localStorage.length).toBe(0)
  off.unmount()

  renderScreen(<WikiPageView pageId={31} spaceId={7} />, { path: BASE, handlers })
  await waitFor(() => expect(localStorage.length).toBeGreaterThan(0))
})

test('embedded 에 공간 id 가 주어지면 공간 목록이 비어 있어도(stale) 빈 공간 안내 없이 그 공간 트리를 그린다', async () => {
  renderScreen(
    <WikiRoutesProvider value={projectWikiRoutes(9, BASE)}>
      <WikiSidebar spaceId={9} activePageId={null} embedded />
    </WikiRoutesProvider>,
    {
      path: BASE,
      handlers: [
        http.get('/api/v1/wiki/spaces', () => HttpResponse.json([])),
        http.get('/api/v1/wiki/spaces/:id/pages', () => HttpResponse.json([wikiPageSummary({ id: 31, title: '첫 노트' })])),
      ],
    },
  )
  expect(await screen.findByTestId('wiki-tree-row-31')).toBeInTheDocument()
  expect(screen.queryByTestId('wiki-no-spaces')).not.toBeInTheDocument()
})
