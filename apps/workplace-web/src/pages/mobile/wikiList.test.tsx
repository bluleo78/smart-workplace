// 모바일 노트 목록(WP-178·179·180) — 페이지 테스트(WP-981).
// 페이지를 열지 않고 고른 공간의 기억(localStorage)·사라진 공간이면 첫 공간으로 시작은 주소·조건부 렌더라
// e2e/pages/mobile/wiki-list.spec.ts 에서 옮겼다. 페이지 상세를 여는 시나리오는 본문이 동기화 서버(WebSocket)에 붙어 그 E2E(@platform)에 남는다.
// 「새로고침·앱 재실행」은 같은 테스트 안에서 화면을 내렸다 다시 띄우는 것으로 대신한다(localStorage 는 테스트가 끝날 때만 비운다).
// 앱 셸을 보지 않으므로 노트 모듈 레이아웃과 화면만 renderScreen 으로 띄운다(WP-1002).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { WikiModuleLayout } from '@/components/wiki/WikiModuleLayout'
import { renderMobileModule } from '@/test/kits/mobile/mobileScreen'
import { mockViewport } from '@/test/viewport'
import type { WikiPageSummary } from '@/types/wiki'

import { wikiPageSummary, wikiSpace } from '../../../e2e/factories/wiki.factory'
import { WikiPage } from '../wiki/WikiPage'

mockViewport()

/** 노트 모듈(레이아웃 + 공간·페이지 화면)을 path 로 띄운다 — /wiki 는 휴대폰에서 본문 없이 모듈 루트 목록만 그린다(App 의 DesktopOnly 와 같음). */
const renderWiki = (path: string, options: Parameters<typeof renderMobileModule>[2] = {}) =>
  renderMobileModule(
    <WikiModuleLayout />,
    [['/wiki', <></>], ['/wiki/spaces/:spaceId', <WikiPage />], ['/wiki/spaces/:spaceId/pages/:pageId', <WikiPage />]],
    { ...options, path },
  )

const PERSONAL = wikiSpace({ id: 1, type: 'PERSONAL', name: '내 위키', role: 'OWNER' })
const TEAM = wikiSpace({ id: 2, type: 'TEAM', name: '팀 위키', role: 'OWNER' })
const EMPTY = wikiSpace({ id: 3, type: 'TEAM', name: '빈 노트', role: 'OWNER' })

/**
 * 공간 3개·공간별 트리. state.hidden 에 넣은 공간은 목록에서 사라진다(삭제·권한 상실).
 */
function mockWiki() {
  const trees: Record<number, WikiPageSummary[]> = {
    1: [wikiPageSummary({ id: 101, title: '개인 메모' })],
    2: [wikiPageSummary({ id: 42, title: '팀 회의록' })],
    3: [],
  }
  const state = { hidden: [] as number[] }
  const handlers = [
    http.get('/api/v1/wiki/spaces', () => HttpResponse.json([PERSONAL, TEAM, EMPTY].filter((sp) => !state.hidden.includes(sp.id)))),
    http.get('/api/v1/wiki/spaces/:id/pages', ({ params }) => HttpResponse.json(trees[Number(params.id)] ?? [])),
    http.get('/api/v1/wiki/spaces/:id/members', () => HttpResponse.json([])),
  ]
  return { state, handlers }
}

const listRow = async (id: number) =>
  within(await screen.findByTestId('mobile-module-list')).findByTestId(`wiki-tree-row-${id}`)

/** 공간 선택 상자에서 공간을 고른다(Radix Select). */
async function pickSpace(user: ReturnType<typeof renderWiki>['user'], name: string) {
  await user.click(within(screen.getByTestId('mobile-module-list')).getByRole('combobox'))
  await user.click(await screen.findByRole('option', { name }))
}

test('페이지를 열지 않고 공간만 바꿔도 다음 노트 진입은 그 공간 목록에서 시작한다(WP-180)', async () => {
  const wiki = mockWiki()
  const first = renderWiki('/wiki', { handlers: wiki.handlers })
  await listRow(101)
  await pickSpace(first.user, '팀 위키')
  await waitFor(() => expect(first.location()).toBe('/wiki/spaces/2'))
  await waitFor(() =>
    expect(Object.entries(localStorage).find(([k]) => k.startsWith('wiki.lastVisitedSpace:'))?.[1]).toBe('2'),
  )
  first.unmount()

  const { location } = renderWiki('/wiki', { handlers: wiki.handlers })
  await listRow(42)
  await waitFor(() => expect(location()).toBe('/wiki/spaces/2'))
})

test('기억한 공간이 삭제·권한 상실로 사라졌으면 첫 공간 목록에서 시작한다(WP-180)', async () => {
  const wiki = mockWiki()
  const first = renderWiki('/wiki/spaces/2', { handlers: wiki.handlers })
  await listRow(42)
  await waitFor(() =>
    expect(Object.entries(localStorage).find(([k]) => k.startsWith('wiki.lastVisitedSpace:'))?.[1]).toBe('2'),
  )
  first.unmount()

  wiki.state.hidden = [TEAM.id]
  const { location } = renderWiki('/wiki', { handlers: wiki.handlers })
  await listRow(101)
  await waitFor(() => expect(location()).toBe('/wiki/spaces/1'))
})
