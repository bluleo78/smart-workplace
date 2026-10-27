// 노트 휴대폰 화면 — 없는 공간·잘못된 주소 안내, ⋯ 메뉴의 공유 창, 받는 사람 공유 화면의 「공유된 페이지」 선택 상자(WP-971, WP-995, WP-983).
// 휴대폰 분기(useIsMobile)의 조건부 렌더·이동은 브라우저 없이 판정되므로 wiki-space-unavailable(모바일) · wiki-share-owner(휴대폰 ⋯) ·
// wiki-share-view(휴대폰 선택 상자) 에서 옮겼다. 표식이 헤더 폭 안에 드는지(@layout)는 E2E 에 남는다.
// matchMedia 결과가 파일 안에서 캐시되므로 휴대폰 뷰포트 판정만 이 파일에 모은다. 노트 모듈(레이아웃 + 페이지)은 AppLayout 의 상태
// Provider(모바일 크롬·AI)만 감싸 renderScreen 으로 띄운다 — 탭바·AI 시트·인증 부팅은 건너뛴다(WP-1002). 받는 사람 공유 화면은 앱 셸 밖이라 그대로 띄운다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'

import { withAppProviders } from '@/test/kits/appProviders'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'
import { mockViewport } from '@/test/viewport'
import type { WikiPageShare, WikiPageShareState, WikiShareResolved } from '@/types/wiki'

import { wikiPageDetail, wikiPageSummary, wikiSpace } from '../../../e2e/factories/wiki.factory'
import { WikiModuleRoutes } from './testkit-b3'
import { attachSilentCollab,editorSideHandlers } from './testkit-b3-msw'
import { WikiSharePage } from './WikiSharePage'

mockViewport()

const MINE = wikiSpace({ id: 1, type: 'PERSONAL', name: '내 노트', role: 'OWNER' })

/** 노트 모듈(레이아웃 + 페이지)을 앱 상태 Provider 와 띄운다 — 모바일 헤더가 부르는 부가 조회는 shellHandlers 가 받는다. */
const renderModule = (path: string, handlers: RequestHandler[]) =>
  renderScreen(withAppProviders(<WikiModuleRoutes />), { path, handlers: [...handlers, ...shellHandlers] })

/** 노트 모듈(휴대폰) — 내 공간은 1번 하나, 8번 공간 트리는 서버처럼 404. */
function openModule(path: string) {
  attachSilentCollab()
  return renderModule(path, [
      ...editorSideHandlers,
      http.get('/api/v1/wiki/spaces', () => HttpResponse.json([MINE])),
      http.get('/api/v1/wiki/spaces/8/pages', () => HttpResponse.json({ message: '위키 공간을 찾을 수 없습니다: 8' }, { status: 404 })),
      http.get('/api/v1/wiki/spaces/:id/pages', () => HttpResponse.json([])),
  ])
}

describe('휴대폰 — 없는 공간·잘못된 주소', () => {
  test('볼 수 없는 공간 주소는 만들기 대신 안내와 「노트 목록으로」를 보이고, 누르면 내 공간으로 간다(WP-559)', async () => {
    const { user, location } = openModule('/wiki/spaces/8')
    const notice = await screen.findByTestId('wiki-space-unavailable')
    expect(notice).toHaveTextContent('노트 공간을 찾을 수 없습니다')
    expect(screen.queryByRole('button', { name: '새 페이지 만들기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '새 페이지' })).not.toBeInTheDocument()
    await user.click(within(notice).getByRole('button', { name: '노트 목록으로' }))
    await waitFor(() => expect(location()).toBe('/wiki/spaces/1'))
    await waitFor(() => expect(screen.queryByTestId('wiki-space-unavailable')).not.toBeInTheDocument())
  })

  test('숫자가 아닌 노트 주소는 오류 화면 대신 없는 공간·페이지 안내를 보인다(WP-612)', async () => {
    const first = openModule('/wiki/spaces/1/pages/undefined')
    expect(await screen.findByTestId('wiki-page-unavailable')).toHaveTextContent('페이지를 불러올 수 없습니다')
    expect(screen.queryByText('페이지를 불러오는 중 문제가 발생했습니다')).not.toBeInTheDocument()
    first.unmount()
    openModule('/wiki/spaces/abc/pages/undefined')
    const notices = await screen.findAllByTestId('wiki-space-unavailable')
    expect(notices.some((n) => n.textContent?.includes('노트 공간을 찾을 수 없습니다'))).toBe(true)
    expect(screen.queryByText('페이지를 불러오는 중 문제가 발생했습니다')).not.toBeInTheDocument()
  })
})

describe('휴대폰 — 공유', () => {
  test('헤더 공유 버튼 대신 「공유 중」 표식과 ⋯ 메뉴 항목으로 공유 창을 연다', async () => {
    const share: WikiPageShare = {
      pageId: 101, token: 'wsh_owner1', audience: 'WORKSPACE', permission: 'VIEW', includeChildren: false, people: [],
      createdBy: { userId: 1, name: '나' }, createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z',
      expiresAt: null, lastAccessedAt: null, viewCount: 0,
    }
    const state: WikiPageShareState = { share, externalShareEnabled: true, inheritedFrom: null, accessRequests: [] }
    attachSilentCollab()
    const { user } = renderModule('/wiki/spaces/9/pages/101', [
        ...editorSideHandlers,
        http.get('/api/v1/wiki/spaces', () => HttpResponse.json([wikiSpace({ id: 9, type: 'PERSONAL', name: '내 노트', role: 'OWNER' })])),
        http.get('/api/v1/wiki/spaces/9/pages', () => HttpResponse.json([{ ...wikiPageSummary({ id: 101, title: '제품 로드맵' }), share: { audience: 'WORKSPACE', includeChildren: false } }])),
        http.get('/api/v1/wiki/spaces/9/members', () => HttpResponse.json([])),
        http.get('/api/v1/wiki/pages/101', () => HttpResponse.json(wikiPageDetail({ id: 101, spaceId: 9, title: '제품 로드맵', shared: true }))),
        http.get('/api/v1/wiki/pages/101/summary', () => HttpResponse.json({ summary: null, status: 'TOO_SHORT', summaryVersion: null, pageVersion: 1, summarizedAt: null })),
        http.get('/api/v1/wiki/pages/101/share', () => HttpResponse.json(state)),
        http.get('/api/v1/wiki/pages/101/share/events', () => HttpResponse.json([])),
        http.get('/api/v1/members', () => HttpResponse.json({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 })),
    ])
    expect(await screen.findByTestId('wiki-page-shared-badge')).toBeInTheDocument()
    expect(screen.queryByTestId('wiki-share-button')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('wiki-page-menu'))
    await user.click(await screen.findByTestId('wiki-menu-share'))
    const dialog = await screen.findByTestId('wiki-share-dialog')
    await waitFor(() => expect(within(dialog).getByTestId('wiki-share-url')).toHaveValue(`${window.location.origin}/wiki/share/wsh_owner1`))
  })

  test('받는 사람 공유 화면은 트리 대신 「공유된 페이지」 선택 상자로 하위 페이지 주소로 옮긴다', async () => {
    const TOKEN = 'wsh_e2eShare1'
    const resolved: WikiShareResolved = {
      rootPageId: 31, spaceId: 9, permission: 'VIEW', includeChildren: true, sharedBy: { userId: 2, name: '김민지' }, member: false,
      pages: [wikiPageSummary({ id: 31, title: '제품 로드맵' }), wikiPageSummary({ id: 32, parentId: 31, title: '하반기 계획' })],
    }
    attachSilentCollab()
    const { user, location } = renderScreen(
      <Routes>
        <Route path="/wiki/share/:token" element={<WikiSharePage />} />
        <Route path="/wiki/share/:token/pages/:pageId" element={<WikiSharePage />} />
      </Routes>,
      {
        path: `/wiki/share/${TOKEN}`,
        handlers: [
          ...editorSideHandlers,
          http.get('/api/v1/wiki/spaces', () => HttpResponse.json([MINE])),
          http.get(`/api/v1/wiki/shares/${TOKEN}`, () => HttpResponse.json(resolved)),
          http.get('/api/v1/wiki/pages/:id', ({ params }) => HttpResponse.json(wikiPageDetail({ id: Number(params.id), spaceId: 9 }))),
          http.get('/api/v1/wiki/pages/:id/summary', () => HttpResponse.json({ summary: null, status: 'TOO_SHORT', summaryVersion: null, pageVersion: 1, summarizedAt: null })),
        ],
      },
    )
    const select = await screen.findByRole('combobox', { name: '공유된 페이지' })
    expect(screen.queryByTestId('wiki-share-tree')).not.toBeInTheDocument()
    await waitFor(() => expect(select).toHaveValue('31'))
    await user.selectOptions(select, '32')
    await waitFor(() => expect(location()).toBe(`/wiki/share/${TOKEN}/pages/32`))
    await waitFor(() => expect(screen.getByRole('combobox', { name: '공유된 페이지' })).toHaveValue('32'))
  })
})
