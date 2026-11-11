// 프로젝트 「노트」 탭(WP-1481) — 모바일 목록/상세 분리. 노트 앱처럼 pageId 없으면 트리 전체, 있으면 페이지 전체이고
// 첫 페이지로 자동 이동하지 않는다. 뷰포트는 파일 하나에 하나라 모바일 전용 파일로 둔다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { mobileWikiListClass } from '@/components/mobile/sidebarListClass'
import { projectScreen } from '@/test/kits/projects/projectScreens'
import { attachSilentCollab, editorSideHandlers } from '@/test/kits/wiki/testkit-b3-msw'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'
import type { WikiPageSummary } from '@/types/wiki'

import { createProject } from '../../../e2e/factories/project.factory'
import { wikiPageDetail, wikiPageSummary, wikiSpace } from '../../../e2e/factories/wiki.factory'

mockViewport()

const KEY = 'WP'
const SPACE_ID = 9
const TREE: WikiPageSummary[] = [
  wikiPageSummary({ id: 21, parentId: null, position: 0, title: '첫번째' }),
  wikiPageSummary({ id: 22, parentId: null, position: 1, title: '두번째' }),
]

function open(path: string, tree: WikiPageSummary[] = TREE) {
  attachSilentCollab()
  return renderPage(path, {
    handlers: [
      ...projectScreen(KEY, { project: createProject({ key: KEY, name: '워크플레이스' }) }).handlers,
      ...editorSideHandlers,
      http.get(`/api/v1/wiki/project-spaces/${KEY}`, () => HttpResponse.json({ id: SPACE_ID, name: '워크플레이스', projectKey: KEY })),
      http.get('/api/v1/wiki/spaces', () => HttpResponse.json([wikiSpace({ id: SPACE_ID, name: '워크플레이스', role: 'OWNER', projectKey: KEY })])),
      http.get('/api/v1/wiki/spaces/:id/pages', () => HttpResponse.json(tree)),
      http.get('/api/v1/wiki/spaces/:id/members', () => HttpResponse.json([])),
      http.get('/api/v1/wiki/pages/:id', ({ params }) =>
        HttpResponse.json(wikiPageDetail({ id: Number(params.id), spaceId: SPACE_ID, title: tree.find((p) => p.id === Number(params.id))?.title ?? '?', body: '' })),
      ),
      http.get('/api/v1/wiki/pages/:id/summary', () =>
        HttpResponse.json({ summary: null, status: 'TOO_SHORT', summaryVersion: null, pageVersion: 1, summarizedAt: null }),
      ),
    ],
  })
}

describe('프로젝트 노트 탭 — 모바일', () => {
  test('페이지 없이 들어오면 트리만 보이고 첫 페이지로 이동하지 않는다', async () => {
    const { location } = open(`/projects/${KEY}/notes`)
    expect(await screen.findByTestId('wiki-tree-row-21', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    // 페이지 화면이 아님 — 페이지 머리줄(wiki-page-header)이 없다.
    expect(screen.queryByTestId('wiki-page-header')).not.toBeInTheDocument()
    expect(screen.queryByTestId('wiki-empty-state')).not.toBeInTheDocument()
    // 자동 이동이 일어날 시간을 준 뒤에도 주소가 그대로다.
    await new Promise((r) => setTimeout(r, 200))
    expect(location()).toBe(`/projects/${KEY}/notes`)
  })

  test('행을 누르면 페이지만 보이고(트리 없음), 주소는 탭 안이다', async () => {
    const { user, location } = open(`/projects/${KEY}/notes`)
    await user.click(within(await screen.findByTestId('wiki-tree-row-22', {}, { timeout: PAGE_LOAD_TIMEOUT })).getByText('두번째'))
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}/notes/22`))
    expect(await screen.findByRole('heading', { name: '두번째' }, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(screen.queryByTestId('wiki-tree-nav')).not.toBeInTheDocument()
  })

  test('페이지 주소로 직접 들어와도 트리 없이 페이지만 보인다', async () => {
    open(`/projects/${KEY}/notes/21`)
    expect(await screen.findByRole('heading', { name: '첫번째' }, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(screen.queryByTestId('wiki-tree-nav')).not.toBeInTheDocument()
  })

  test('페이지가 하나도 없으면 새 페이지 만들기 안내만 보이고 공간 만들기는 없다', async () => {
    open(`/projects/${KEY}/notes`, [])
    expect(await screen.findByTestId('wiki-no-pages', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(screen.queryByTestId('wiki-no-spaces-create')).not.toBeInTheDocument()
  })

  test('페이지 화면은 머리줄이 하나(‹ 뒤로 하나)이고 ‹ 는 노트 목록으로 돌아간다', async () => {
    const { user, location } = open(`/projects/${KEY}/notes/21`)
    expect(await screen.findByRole('heading', { name: '첫번째' }, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    // 프로젝트 머리줄·탭 줄은 없고(페이지 전체 화면), 뒤로 단추는 페이지 머리줄의 하나뿐이다.
    expect(screen.getAllByTestId('mobile-back')).toHaveLength(1)
    expect(screen.queryByRole('navigation', { name: '프로젝트 탭' })).not.toBeInTheDocument()
    await user.click(screen.getByTestId('mobile-back'))
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}/notes`))
    expect(await screen.findByTestId('wiki-tree-row-21')).toBeInTheDocument()
  })

  test('목록 화면에는 새 페이지 만들기 단추가 보인다', async () => {
    open(`/projects/${KEY}/notes`)
    await screen.findByTestId('wiki-tree-row-21', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(screen.getByRole('button', { name: '새 페이지' })).toBeInTheDocument()
  })

  test('목록 래퍼는 노트 앱 모바일 목록과 같은 규격(mobileWikiListClass)이고, 탭 목록 래퍼에는 첫 줄 숨김 클래스가 없다', async () => {
    open(`/projects/${KEY}/notes`)
    await screen.findByTestId('wiki-tree-row-21', {}, { timeout: PAGE_LOAD_TIMEOUT })
    const wrapper = screen.getByTestId('mobile-module-list')
    expect(wrapper.className).toContain(mobileWikiListClass)
    // 첫 줄(도구줄)은 숨김 클래스가 없는 기본 규격을 써서 남긴다.
    expect(wrapper.className).not.toContain('first-child')
  })
})
