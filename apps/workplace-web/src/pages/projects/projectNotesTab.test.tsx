// 프로젝트 「노트」 탭(WP-1481) — 페이지 테스트. renderPage 로 실제 라우트 트리를 띄운다.
// 탭 보이기(공간 200/404/500), 탭 클릭 → 첫 최상위 페이지로 replace, 트리·삭제 뒤 주소가 탭 안에 머무름,
// 다른 공간 백링크는 노트 앱 주소로, 잘못된 페이지 주소 안내를 본다.
import { screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test } from 'vitest'

import { wikiKeys } from '@/hooks/queries/wikiKeys'
import { projectScreen } from '@/test/kits/projects/projectScreens'
import { attachSilentCollab, editorSideHandlers } from '@/test/kits/wiki/testkit-b3-msw'
import { rememberProjectTab } from '@/test/projectTabMemory'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { WikiPageDetail, WikiPageSummary } from '@/types/wiki'

import { createProject } from '../../../e2e/factories/project.factory'
import { createProjectOverview } from '../../../e2e/factories/projectOverview.factory'
import { wikiPageDetail, wikiPageSummary, wikiSpace } from '../../../e2e/factories/wiki.factory'

const KEY = 'WP'
const SPACE_ID = 9
const SPACE_API = `/api/v1/wiki/project-spaces/${KEY}`
const TREE: WikiPageSummary[] = [
  wikiPageSummary({ id: 22, parentId: null, position: 1, title: '두번째' }),
  wikiPageSummary({ id: 21, parentId: null, position: 0, title: '첫번째' }),
  wikiPageSummary({ id: 23, parentId: 21, position: 0, title: '하위' }),
]
const detail = (id: number): WikiPageDetail =>
  wikiPageDetail({ id, spaceId: SPACE_ID, title: TREE.find((p) => p.id === id)?.title ?? '?', body: '' })

/** 프로젝트·노트 공간(space 응답을 고른다) 핸들러 묶음. */
function open(path: string, space: () => Response, extra: RequestHandler[] = []) {
  attachSilentCollab()
  return renderPage(path, {
    handlers: [
      ...extra,
      // 기억한 노트 탭을 못 쓰면 기본 탭(개요)으로 내려앉는다(WP-1478) — 그때 개요가 부르는 조회.
      http.get(`/api/v1/projects/${KEY}/overview`, () => HttpResponse.json(createProjectOverview())),
      ...projectScreen(KEY, { project: createProject({ key: KEY, name: '워크플레이스' }) }).handlers,
      ...editorSideHandlers,
      http.get(SPACE_API, () => space()),
      http.get('/api/v1/wiki/spaces', () => HttpResponse.json([wikiSpace({ id: SPACE_ID, name: '워크플레이스', role: 'OWNER', projectKey: KEY })])),
      http.get('/api/v1/wiki/spaces/:id/pages', () => HttpResponse.json(TREE)),
      http.get('/api/v1/wiki/spaces/:id/members', () => HttpResponse.json([])),
      http.get('/api/v1/wiki/pages/:id', ({ params }) => HttpResponse.json(detail(Number(params.id)))),
      http.get('/api/v1/wiki/pages/:id/summary', () =>
        HttpResponse.json({ summary: null, status: 'TOO_SHORT', summaryVersion: null, pageVersion: 1, summarizedAt: null }),
      ),
    ],
  })
}

const ok = () => HttpResponse.json({ id: SPACE_ID, name: '워크플레이스', projectKey: KEY })
const notFound = () => HttpResponse.json({ message: '없음' }, { status: 404 })
const serverError = () => HttpResponse.json({ message: '오류' }, { status: 500 })
const storedTab = () => window.localStorage.getItem(`project-tab:${KEY}:1:-`)
const tabNav = () => screen.getByRole('navigation', { name: '프로젝트 탭' })
const OVERVIEW_PATH = `/projects/${KEY}/overview`

describe('프로젝트 노트 탭', () => {
  test('공간이 있으면 탭 줄에 「노트」가 보이고, 누르면 첫 최상위 페이지(position 순)로 replace 이동한다', async () => {
    const { user, location } = open(`/projects/${KEY}`, ok)
    const link = await within(await screen.findByRole('navigation', { name: '프로젝트 탭' }, { timeout: PAGE_LOAD_TIMEOUT })).findByRole('link', { name: '노트' })
    await user.click(link)
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}/notes/21`))
    expect(await screen.findByTestId('wiki-tree-row-21')).toBeInTheDocument()
    expect(within(tabNav()).getByRole('link', { name: '노트' })).toHaveAttribute('aria-current', 'page')
  })

  test('트리 행을 누르면 탭 주소로 가고, 페이지를 지우면 탭 안에 머문다', async () => {
    // 삭제 뒤 트리 응답에서는 22 가 빠진다(서버가 하는 일을 흉내).
    let deleted = false
    const { user, location } = open(`/projects/${KEY}/notes/21`, ok, [
      http.delete('/api/v1/wiki/pages/:id', () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
      http.get('/api/v1/wiki/spaces/:id/pages', () => HttpResponse.json(deleted ? TREE.filter((p) => p.id !== 22) : TREE)),
    ])
    await user.click(within(await screen.findByTestId('wiki-tree-row-22', {}, { timeout: PAGE_LOAD_TIMEOUT })).getByText('두번째'))
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}/notes/22`))
    await user.click(await screen.findByRole('button', { name: '페이지 메뉴' }))
    await user.click(await screen.findByRole('menuitem', { name: '페이지 삭제' }))
    await user.click(within(await screen.findByTestId('wiki-delete-dialog')).getByRole('button', { name: '삭제' }))
    // 삭제 → 공간 주소 → 첫 최상위 페이지(21) — /wiki 가 아니라 탭 안의 정확한 주소여야 한다.
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}/notes/21`))
    expect(await screen.findByTestId('wiki-tree-row-21')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('wiki-tree-row-22')).not.toBeInTheDocument())
  })

  test('다른 공간을 가리키는 백링크는 노트 앱 주소로 간다', async () => {
    open(`/projects/${KEY}/notes/21`, ok, [
      http.get('/api/v1/wiki/pages/21/backlinks', () =>
        HttpResponse.json({ items: [{ pageId: 501, spaceId: 2, spaceName: '다른', title: '참조', updatedAt: '2026-06-10T00:00:00Z' }] }),
      ),
    ])
    const link = await screen.findByTestId('wiki-backlink-501', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(link.closest('a') ?? link).toHaveAttribute('href', '/wiki/spaces/2/pages/501')
  })

  test('공간이 없으면(404) 탭 줄에 「노트」가 없고, 주소로 직접 들어오면 프로젝트 이슈 탭으로 간다', async () => {
    const { location } = open(`/projects/${KEY}/notes`, notFound)
    await screen.findByRole('navigation', { name: '프로젝트 탭' }, { timeout: PAGE_LOAD_TIMEOUT })
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}`))
    expect(within(tabNav()).queryByRole('link', { name: '노트' })).not.toBeInTheDocument()
  })

  test('공간 조회가 500 이면 탭은 숨기고 오류 안내를 보이며 주소는 그대로다', async () => {
    const { location } = open(`/projects/${KEY}/notes`, serverError)
    expect(await screen.findByTestId('project-notes-error', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(within(tabNav()).queryByRole('link', { name: '노트' })).not.toBeInTheDocument()
    expect(location()).toBe(`/projects/${KEY}/notes`)
  })

  test('페이지 주소가 숫자가 아니면 페이지 없음 안내를 보인다', async () => {
    open(`/projects/${KEY}/notes/abc`, ok)
    expect(await screen.findByTestId('wiki-page-unavailable', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  })

  test('기억한 탭이 노트면 /projects/WP 에서 공간 응답을 기다린 뒤 첫 노트 페이지로 열고, 기억은 지켜진다', async () => {
    rememberProjectTab(KEY, 'notes')
    const { location } = open(`/projects/${KEY}`, ok, [
      // 공간 응답을 늦춰 판정 대기 구간을 만든다(그동안 이슈 목록을 그리지 않는다).
      http.get(SPACE_API, async () => {
        await delay(150)
        return ok()
      }),
    ])
    expect(await screen.findByText('로딩 중…')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '태스크' })).not.toBeInTheDocument()
    // 기다리는 동안 기억을 이슈로 덮어쓰지 않는다.
    expect(storedTab()).toBe('notes')
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}/notes/21`), { timeout: PAGE_LOAD_TIMEOUT })
    expect(await screen.findByTestId('wiki-tree-row-21')).toBeInTheDocument()
    expect(storedTab()).toBe('notes')
  })

  test('기억한 탭이 노트여도 공간이 404 면 기본 탭(개요)으로 간다', async () => {
    rememberProjectTab(KEY, 'notes')
    const { location } = open(`/projects/${KEY}`, notFound)
    await waitFor(() => expect(location()).toBe(OVERVIEW_PATH), { timeout: PAGE_LOAD_TIMEOUT })
    expect(await screen.findByTestId('project-tab-overview')).toHaveAttribute('aria-current', 'page')
    expect(within(tabNav()).queryByRole('link', { name: '노트' })).not.toBeInTheDocument()
  })
  test('공간을 한 번 받은 뒤 재조회가 500 이어도 페이지·노트 탭이 그대로 보이고 주소도 그대로다', async () => {
    let fail = false
    const { location, queryClient } = open(`/projects/${KEY}/notes/21`, () => (fail ? serverError() : ok()))
    expect(await screen.findByTestId('wiki-tree-row-21', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    // 백그라운드 재조회를 500 으로 실패시킨다 — 캐시 데이터는 남고 isError 만 켜진다.
    fail = true
    await queryClient.invalidateQueries({ queryKey: wikiKeys.projectSpace(KEY) })
    await waitFor(() => expect(queryClient.getQueryState(wikiKeys.projectSpace(KEY))?.status).toBe('error'))
    expect(screen.queryByTestId('project-notes-error')).not.toBeInTheDocument()
    expect(screen.getByTestId('wiki-tree-row-21')).toBeInTheDocument()
    expect(within(tabNav()).getByRole('link', { name: '노트' })).toBeInTheDocument()
    expect(location()).toBe(`/projects/${KEY}/notes/21`)
  })

  test('공간 재조회가 404 로 실패해도 이미 받은 노트 화면에서 이슈 탭으로 튕기지 않는다', async () => {
    let status: 'ok' | 'gone' = 'ok'
    const { location, queryClient } = open(`/projects/${KEY}/notes/21`, () => (status === 'ok' ? ok() : notFound()))
    expect(await screen.findByTestId('wiki-tree-row-21', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    status = 'gone'
    await queryClient.invalidateQueries({ queryKey: wikiKeys.projectSpace(KEY) })
    await waitFor(() => expect(queryClient.getQueryState(wikiKeys.projectSpace(KEY))?.status).toBe('error'))
    expect(screen.getByTestId('wiki-tree-row-21')).toBeInTheDocument()
    expect(location()).toBe(`/projects/${KEY}/notes/21`)
  })

  test('기억한 탭이 노트이고 공간 첫 조회가 500 이면 기본 탭(개요)에 내려앉고, 재조회가 성공해도 노트로 끌려가지 않는다', async () => {
    rememberProjectTab(KEY, 'notes')
    let fail = true
    const { location, queryClient } = open(`/projects/${KEY}`, () => (fail ? serverError() : ok()))
    await waitFor(() => expect(location()).toBe(OVERVIEW_PATH), { timeout: PAGE_LOAD_TIMEOUT })
    fail = false
    await queryClient.invalidateQueries({ queryKey: wikiKeys.projectSpace(KEY) })
    // 노트 탭이 나타날 만큼 성공했음을 확인한 뒤에도 주소는 그대로.
    expect(await within(tabNav()).findByRole('link', { name: '노트' })).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 200))
    expect(location()).toBe(OVERVIEW_PATH)
    expect(screen.getByTestId('project-tab-overview')).toHaveAttribute('aria-current', 'page')
  })

  test('트리 조회가 500 이면 /notes 에서 빈 상태(새 페이지 만들기) 대신 다시 시도할 수 있는 오류를 보인다', async () => {
    open(`/projects/${KEY}/notes`, ok, [http.get('/api/v1/wiki/spaces/:id/pages', () => serverError())])
    expect(await screen.findByTestId('project-notes-tree-error', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /새 페이지 만들기/ })).not.toBeInTheDocument()
  })
})
