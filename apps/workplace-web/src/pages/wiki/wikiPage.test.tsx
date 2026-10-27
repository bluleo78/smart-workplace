// 노트 화면(사이드바 + /wiki 진입 + 페이지 본문·헤더) — 화면 테스트(WP-971, WP-995, WP-983).
// /wiki 진입 복원·기본 화면, 빈·로딩·없는 공간/페이지 안내, 헤더 ⋯(삭제·소스·기록·전체 폭)·AI 버튼 권한, AI 배지, 백링크,
// 공유 창(외부 공개·재발급·해제·접근 요청)·읽기 전용 숨김, 버전 기록 목록·뒤로 가기·복원 실패·뷰어는 브라우저 없이 판정되므로
// wiki.spec · wiki-last-visited · wiki-space-unavailable · wiki-space-create · wiki-header · wiki-full-width · wiki-permissions ·
// wiki-markdown-source · wiki-mentions · wiki-ai · wiki-summary · wiki-share-owner · wiki-revisions 에서 옮겼다.
// 본문(동기화 서버) 내용·입력·클립보드·기하는 E2E 에 남는다 — 여기선 /collab 연결을 받기만 하고(silentCollab) 본문은 동기화하지 않는다.
// App·인증 부팅 없이 노트 모듈 라우트만 renderScreen 으로 띄운다(WikiModuleRoutes).
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { wikiLastVisitedKey,writeWikiLastVisited } from '@/lib/wikiLastVisited'
import { attachSilentCollab,editorSideHandlers } from '@/test/kits/wiki/testkit-b3-msw'
import { renderScreen } from '@/test/renderScreen'
import type {
  WikiBacklink,
  WikiPageDetail,
  WikiPageShare,
  WikiPageShareState,
  WikiPageSummary,
  WikiRevisionList,
  WikiRole,
  WikiSpace,
} from '@/types/wiki'

import { wikiPageDetail, wikiPageSummary, wikiSpace } from '../../../e2e/factories/wiki.factory'
import { WikiModuleRoutes } from './testkit-b3'

const PERSONAL = wikiSpace({ id: 1, type: 'PERSONAL', name: '내 위키', role: 'OWNER' })

type Opts = {
  path: string
  spaces?: () => WikiSpace[]
  tree?: (spaceId: number) => WikiPageSummary[]
  /** 페이지 상세 — null 이면 404 를 준다. */
  detail?: (id: number) => WikiPageDetail | null
  handlers?: RequestHandler[]
  auth?: Parameters<typeof renderScreen>[1] extends infer O ? (O extends { auth?: infer A } ? A : never) : never
}

/** 노트 모듈을 띄운다 — 스페이스·트리·상세는 함수로 받아 쓰기 뒤 재조회에 바뀐 값을 돌려줄 수 있다. */
function open({ path, spaces = () => [PERSONAL], tree = () => [], detail, handlers = [], auth }: Opts) {
  attachSilentCollab()
  return renderScreen(<WikiModuleRoutes />, {
    path,
    auth,
    handlers: [
      ...handlers,
      ...editorSideHandlers,
      http.get('/api/v1/wiki/spaces', () => HttpResponse.json(spaces())),
      http.get('/api/v1/wiki/spaces/:id/pages', ({ params }) => HttpResponse.json(tree(Number(params.id)))),
      http.get('/api/v1/wiki/spaces/:id/members', () => HttpResponse.json([])),
      http.get('/api/v1/wiki/pages/:id', ({ params }) => {
        const d = detail?.(Number(params.id)) ?? null
        return d ? HttpResponse.json(d) : HttpResponse.json({ status: 404, message: '페이지를 열 수 없습니다' }, { status: 404 })
      }),
      http.get('/api/v1/wiki/pages/:id/summary', () =>
        HttpResponse.json({ summary: null, status: 'TOO_SHORT', summaryVersion: null, pageVersion: 1, summarizedAt: null }),
      ),
    ],
  })
}

/** 헤더 ⋯ 메뉴를 연다. */
async function openPageMenu(user: ReturnType<typeof renderScreen>['user']) {
  const header = await screen.findByTestId('wiki-page-header')
  await user.click(within(header).getByRole('button', { name: '페이지 메뉴' }))
}

// ── /wiki 진입 · 마지막으로 본 노트(wiki-last-visited · wiki-space-create · wiki-members) ─────────────

const TEAM = wikiSpace({ id: 2, type: 'TEAM', name: '팀 위키', role: 'OWNER' })
const LAST_ID = 42
const LAST_TITLE = '마지막으로 본 팀 노트'
const KEY = wikiLastVisitedKey(1, 1)

/** 개인(첫 공간)·팀 공간과 팀 공간의 페이지 42 — 상세 응답 코드를 바꿔 복원 분기를 본다. */
function openLastVisited(path: string, pageStatus = 200) {
  const pageGets: number[] = []
  const view = open({
    path,
    spaces: () => [PERSONAL, TEAM],
    tree: (id) => (id === 2 ? [wikiPageSummary({ id: LAST_ID, title: LAST_TITLE })] : []),
    handlers: [
      http.get(`/api/v1/wiki/pages/${LAST_ID}`, () => {
        pageGets.push(LAST_ID)
        return pageStatus === 200
          ? HttpResponse.json(wikiPageDetail({ id: LAST_ID, spaceId: 2, title: LAST_TITLE }))
          : HttpResponse.json({ status: pageStatus, message: '페이지를 열 수 없습니다' }, { status: pageStatus })
      }),
      // 404 면 덮는 공유가 있는지 입구 판정을 묻는다(WP-987) — 같은 상태로 답해 공유 없음(안내 화면)으로 둔다.
      http.get(`/api/v1/wiki/pages/${LAST_ID}/entry`, () =>
        HttpResponse.json({ status: pageStatus, message: '페이지를 열 수 없습니다' }, { status: pageStatus === 200 ? 404 : pageStatus }),
      ),
    ],
  })
  return { ...view, pageGets }
}

describe('/wiki 진입', () => {
  test('노트를 열면 로그인 사용자·워크스페이스 키로 기록하고, 다음 /wiki 진입은 그 노트를 연다', async () => {
    const first = openLastVisited(`/wiki/spaces/2/pages/${LAST_ID}`)
    await screen.findByTestId('wiki-page-header')
    await waitFor(() => expect(localStorage.getItem(KEY)).toBe(String(LAST_ID)))
    first.unmount()
    const { location } = openLastVisited('/wiki')
    await waitFor(() => expect(location()).toBe(`/wiki/spaces/2/pages/${LAST_ID}`))
  })

  test.each([404, 403])('마지막으로 본 노트가 %i 이면 기록을 지우고 첫 공간으로 간다', async (status) => {
    writeWikiLastVisited(KEY, LAST_ID)
    const { location } = openLastVisited('/wiki', status)
    await waitFor(() => expect(location()).toBe('/wiki/spaces/1'))
    expect(await screen.findByTestId('wiki-empty-state')).toBeInTheDocument()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  test('일시 오류(500)면 첫 공간으로 가되 기록은 남긴다', async () => {
    writeWikiLastVisited(KEY, LAST_ID)
    const { location } = openLastVisited('/wiki', 500)
    await waitFor(() => expect(location()).toBe('/wiki/spaces/1'))
    expect(localStorage.getItem(KEY)).toBe(String(LAST_ID))
  })

  test('다른 사용자 키로 남은 기록은 복원하지 않고 조회도 하지 않는다', async () => {
    writeWikiLastVisited(wikiLastVisitedKey(99, 1), LAST_ID)
    const { location, pageGets } = openLastVisited('/wiki')
    await waitFor(() => expect(location()).toBe('/wiki/spaces/1'))
    expect(pageGets).toEqual([])
  })

  test('보던 노트가 404 면 skeleton 대신 안내를 보이고, 「노트 목록으로」는 같은 노트로 돌아오지 않는다', async () => {
    writeWikiLastVisited(KEY, LAST_ID)
    const { user, location } = openLastVisited(`/wiki/spaces/2/pages/${LAST_ID}`, 404)
    expect(await screen.findByText('페이지를 불러올 수 없습니다')).toBeInTheDocument()
    expect(screen.queryByTestId('wiki-page-skeleton')).not.toBeInTheDocument()
    expect(screen.getByText('요청한 노트 페이지가 존재하지 않거나 접근 권한이 없습니다.')).toBeInTheDocument()
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull())
    await user.click(screen.getByRole('button', { name: '노트 목록으로' }))
    await waitFor(() => expect(location()).toBe('/wiki/spaces/1'))
  })

  test('스페이스가 하나도 없으면 「준비 중」에 멈추지 않고 빈 상태에서 공간을 만들어 그리로 간다(WP-143)', async () => {
    let created: WikiSpace | null = null
    const posts: unknown[] = []
    const { user, location } = open({
      path: '/wiki',
      spaces: () => (created ? [created] : []),
      handlers: [
        http.post('/api/v1/wiki/spaces', async ({ request }) => {
          const body = (await request.json()) as { name: string }
          posts.push(body)
          created = wikiSpace({ id: 5, name: body.name, role: 'OWNER' })
          return HttpResponse.json(created)
        }),
      ],
    })
    expect(await screen.findByTestId('wiki-no-spaces')).toBeInTheDocument()
    expect(screen.queryByText('노트 공간을 준비 중…')).not.toBeInTheDocument()
    // 데스크톱 사이드바는 빈 선택 상자를 그리지 않는다(빈 상태는 본문 한 곳).
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('wiki-no-spaces')).toHaveLength(1)
    await user.click(screen.getByTestId('wiki-no-spaces-create'))
    await user.type(await screen.findByTestId('wiki-space-create-input'), '제품팀 노트')
    await user.click(screen.getByTestId('wiki-space-create-confirm'))
    await waitFor(() => expect(location()).toBe('/wiki/spaces/5'))
    expect(posts).toEqual([{ name: '제품팀 노트' }])
    expect(await screen.findByRole('combobox')).toBeInTheDocument()
  })
})

// ── 공간 첫 화면 · 없는 공간/페이지(wiki.spec · wiki-space-unavailable · wiki-ai) ─────────────────

describe('공간 첫 화면', () => {
  test('빈 상태는 숨은 h1·아이콘·제목·설명·CTA 를 보이고, CTA 는 페이지를 만들어 그리로 간다(#245)', async () => {
    const creates: unknown[] = []
    const { user, location, container } = open({
      path: '/wiki/spaces/1',
      detail: (id) => wikiPageDetail({ id, title: '' }),
      handlers: [
        http.post('/api/v1/wiki/spaces/1/pages', async ({ request }) => {
          creates.push(await request.json())
          return HttpResponse.json(wikiPageDetail({ id: 50, title: '' }), { status: 201 })
        }),
      ],
    })
    const empty = await screen.findByTestId('wiki-empty-state')
    expect(await screen.findByRole('heading', { level: 1, name: '노트 — 내 위키' })).toBeInTheDocument()
    expect(empty.querySelector('svg.lucide-book-open')).not.toBeNull()
    expect(within(empty).getByText('표시할 페이지가 없습니다')).toBeInTheDocument()
    expect(within(empty).getByText('페이지를 선택하거나 새 페이지를 만드세요')).toBeInTheDocument()
    await user.click(within(empty).getByRole('button', { name: '새 페이지 만들기' }))
    await waitFor(() => expect(location()).toBe('/wiki/spaces/1/pages/50'))
    expect(creates).toEqual([{ parentId: null, title: '' }])
    expect(container).toBeTruthy()
  })

  test('볼 수 없는 공간 주소는 만들기 대신 안내와 「노트 목록으로」를 보인다(WP-559)', async () => {
    const { user, location } = open({
      path: '/wiki/spaces/8',
      handlers: [
        http.get('/api/v1/wiki/spaces/8/pages', () => HttpResponse.json({ message: '위키 공간을 찾을 수 없습니다: 8' }, { status: 404 })),
      ],
    })
    const notices = await screen.findAllByTestId('wiki-space-unavailable')
    expect(notices[0]).toHaveTextContent('노트 공간을 찾을 수 없습니다')
    // 눌러도 404 인 생성 진입점은 없다 — 빈 상태 버튼도, 사이드바 ＋ 도.
    expect(screen.queryByRole('button', { name: '새 페이지 만들기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '새 페이지' })).not.toBeInTheDocument()
    await user.click(within(notices[notices.length - 1]).getByRole('button', { name: '노트 목록으로' }))
    await waitFor(() => expect(location()).toBe('/wiki/spaces/1'))
    await waitFor(() => expect(screen.queryByTestId('wiki-space-unavailable')).not.toBeInTheDocument())
  })

  test('숫자가 아닌 노트 주소는 오류 화면 대신 없는 공간·페이지 안내를 보인다(WP-612)', async () => {
    const first = open({ path: '/wiki/spaces/1/pages/undefined' })
    expect(await screen.findByTestId('wiki-page-unavailable')).toHaveTextContent('페이지를 불러올 수 없습니다')
    expect(screen.queryByText('페이지를 불러오는 중 문제가 발생했습니다')).not.toBeInTheDocument()
    first.unmount()
    open({ path: '/wiki/spaces/abc/pages/undefined' })
    const notices = await screen.findAllByTestId('wiki-space-unavailable')
    expect(notices.some((n) => n.textContent?.includes('노트 공간을 찾을 수 없습니다'))).toBe(true)
    expect(screen.queryByText('페이지를 불러오는 중 문제가 발생했습니다')).not.toBeInTheDocument()
  })

  test('페이지 상세를 기다리는 동안 skeleton 을 보이고(「불러오는 중…」 글자 없음), 도착하면 헤더로 바뀐다(#246)', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    open({
      path: '/wiki/spaces/1/pages/300',
      tree: () => [wikiPageSummary({ id: 300, title: '느린 페이지' })],
      handlers: [
        http.get('/api/v1/wiki/pages/300', async () => {
          await held
          return HttpResponse.json(wikiPageDetail({ id: 300, title: '느린 페이지' }))
        }),
      ],
    })
    expect(await screen.findByTestId('wiki-page-skeleton')).toBeInTheDocument()
    expect(screen.queryByText('불러오는 중…')).not.toBeInTheDocument()
    release()
    expect(await screen.findByTestId('wiki-page-header')).toBeInTheDocument()
    expect(screen.queryByTestId('wiki-page-skeleton')).not.toBeInTheDocument()
  })
})

// ── 헤더(wiki-header · wiki-permissions · wiki-markdown-source · wiki-ai · wiki-summary · wiki-full-width) ──

const HEADER_TREE = [wikiPageSummary({ id: 1, title: '제품 문서' }), wikiPageSummary({ id: 2, parentId: 1, title: '기획' })]
const headerDetail = (over: Partial<WikiPageDetail> = {}) => (id: number) =>
  wikiPageDetail({ id, parentId: id === 2 ? 1 : null, title: id === 2 ? '기획' : '제품 문서', body: '', ...over })

describe('노트 헤더', () => {
  test('⋯ → 페이지 삭제 확인 → DELETE 후 공간 첫 화면으로 간다', async () => {
    const deletes: string[] = []
    const { user, location } = open({
      path: '/wiki/spaces/1/pages/2',
      tree: () => HEADER_TREE,
      detail: headerDetail(),
      handlers: [
        http.delete('/api/v1/wiki/pages/:id', ({ request }) => {
          deletes.push(new URL(request.url).pathname)
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    })
    await openPageMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: '페이지 삭제' }))
    await user.click(within(await screen.findByTestId('wiki-delete-dialog')).getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(deletes).toEqual(['/api/v1/wiki/pages/2']))
    await waitFor(() => expect(location()).toBe('/wiki/spaces/1'))
  })

  test('AI 생성 이력이 있으면 브레드크럼 옆에 「AI 생성 포함」 배지가, 없으면 배지가 없다(#736)', async () => {
    const first = open({
      path: '/wiki/spaces/1/pages/1',
      tree: () => HEADER_TREE,
      detail: headerDetail({ aiLastUsedAt: '2026-07-20T00:00:00Z', aiLastAction: 'draft' }),
    })
    expect(await screen.findByTestId('wiki-page-ai-attribution-badge')).toHaveTextContent('AI 생성 포함')
    first.unmount()
    open({ path: '/wiki/spaces/1/pages/1', tree: () => HEADER_TREE, detail: headerDetail() })
    await screen.findByTestId('wiki-page-header')
    expect(screen.queryByTestId('wiki-page-ai-attribution-badge')).not.toBeInTheDocument()
  })

  test('EDITOR 는 새 페이지 버튼과 ⋯ 의 버전 기록·삭제를 본다', async () => {
    const { user } = open({
      path: '/wiki/spaces/1/pages/1',
      spaces: () => [wikiSpace({ id: 1, name: '팀 노트', ownerId: 9, role: 'EDITOR' })],
      tree: () => HEADER_TREE,
      detail: headerDetail(),
    })
    // 메뉴를 열면 Radix 가 나머지를 aria-hidden 으로 가리므로 사이드바 버튼부터 본다.
    await screen.findByTestId('wiki-page-header')
    expect(await screen.findByRole('button', { name: '새 페이지' })).toBeInTheDocument()
    await openPageMenu(user)
    expect(await screen.findByTestId('wiki-menu-history')).toBeInTheDocument()
    expect(screen.getByTestId('wiki-menu-delete')).toBeInTheDocument()
  })

  test('VIEWER 는 ⋯ 에 버전 기록·마크다운 소스가 있고 삭제는 없다(WP-602·#753)', async () => {
    const { user } = open({
      path: '/wiki/spaces/1/pages/1',
      spaces: () => [wikiSpace({ id: 1, name: '팀 노트', ownerId: 9, role: 'VIEWER' })],
      tree: () => HEADER_TREE,
      detail: headerDetail(),
    })
    await openPageMenu(user)
    expect(await screen.findByTestId('wiki-menu-history')).toBeInTheDocument()
    expect(screen.getByTestId('wiki-menu-source')).toBeInTheDocument()
    expect(screen.queryByTestId('wiki-menu-delete')).not.toBeInTheDocument()
  })

  test('「전체 폭」 저장이 거절되면 켜짐을 되돌리고 서버 사유를 알린다(WP-793)', async () => {
    const puts: unknown[] = []
    const { user } = open({
      path: '/wiki/spaces/1/pages/1',
      tree: () => HEADER_TREE,
      detail: headerDetail({ fullWidth: false }),
      handlers: [
        http.put('/api/v1/wiki/pages/1', async ({ request }) => {
          puts.push(await request.json())
          return HttpResponse.json({ message: '편집 권한이 없습니다' }, { status: 403 })
        }),
      ],
    })
    await openPageMenu(user)
    await user.click(await screen.findByRole('menuitemcheckbox', { name: '전체 폭' }))
    expect(await screen.findByText('편집 권한이 없습니다')).toBeInTheDocument()
    expect(puts).toEqual([{ title: null, body: null, fullWidth: true }])
    await waitFor(() => expect(screen.getByRole('menuitemcheckbox', { name: '전체 폭' })).toHaveAttribute('aria-checked', 'false'))
  })

  test('뷰어도 상단 AI 요약 카드를 본다(WP-301)', async () => {
    open({
      path: '/wiki/spaces/1/pages/1',
      spaces: () => [wikiSpace({ id: 1, name: '팀 노트', role: 'VIEWER' })],
      tree: () => HEADER_TREE,
      detail: headerDetail(),
      handlers: [
        http.get('/api/v1/wiki/pages/1/summary', () =>
          HttpResponse.json({ summary: '배포를 10/9 로 확정했다.', status: 'READY', summaryVersion: 1, pageVersion: 1, summarizedAt: '2026-10-08T05:20:00Z' }),
        ),
      ],
    })
    expect(await screen.findByTestId('wiki-ai-summary')).toHaveTextContent('배포를 10/9 로 확정했다.')
  })
})

// ── 백링크(wiki-mentions) ────────────────────────────────────────────────

describe('백링크 패널', () => {
  test('참조하는 페이지를 제목·공간 이름으로 보이고, 누르면 그 페이지 자신의 공간 주소로 간다', async () => {
    const backlinks: WikiBacklink[] = [
      { pageId: 501, spaceId: 1, spaceName: '팀 위키', title: '회의록 2026', updatedAt: '2026-06-10T00:00:00Z' },
      { pageId: 502, spaceId: 2, spaceName: '엔지니어링', title: '제품 로드맵', updatedAt: '2026-06-11T00:00:00Z' },
    ]
    const { user, location } = open({
      path: '/wiki/spaces/1/pages/1',
      tree: () => HEADER_TREE,
      detail: headerDetail(),
      handlers: [http.get('/api/v1/wiki/pages/1/backlinks', () => HttpResponse.json({ items: backlinks }))],
    })
    const panel = await screen.findByTestId('wiki-backlinks-panel')
    expect(panel).toHaveTextContent('이 페이지를 참조하는 곳')
    expect(screen.getByTestId('wiki-backlink-501')).toHaveTextContent('회의록 2026')
    expect(screen.getByTestId('wiki-backlink-501')).toHaveTextContent('팀 위키')
    expect(screen.getByTestId('wiki-backlink-502')).toHaveTextContent('제품 로드맵')
    expect(screen.getByTestId('wiki-backlink-502')).toHaveTextContent('엔지니어링')
    await user.click(screen.getByTestId('wiki-backlink-502'))
    await waitFor(() => expect(location()).toBe('/wiki/spaces/2/pages/502'))
  })

  test('백링크가 없으면 패널을 그리지 않는다', async () => {
    open({ path: '/wiki/spaces/1/pages/1', tree: () => HEADER_TREE, detail: headerDetail() })
    await screen.findByTestId('wiki-page-header')
    // 백링크 조회가 끝난 뒤에도 없다.
    await act(() => new Promise((r) => setTimeout(r, 50)))
    expect(screen.queryByTestId('wiki-backlinks-panel')).not.toBeInTheDocument()
  })
})

// ── 공유하는 쪽(wiki-share-owner) ────────────────────────────────────────

const SHARE_SPACE = 9
const SHARE_PAGE = 101
const SHARE_TITLE = '제품 로드맵'
const tokenOf = (n: number) => `wsh_owner${n}`

/** 서버가 가진 공유 한 건 — 라우트가 읽고 써서 다음 GET(트리·상세·공유 상태)에 그대로 돌아온다. */
type ServerShare = { share: WikiPageShare | null; accessRequests: WikiPageShareState['accessRequests']; tokenSeq: number }

const existingShare = (over: Partial<WikiPageShare> = {}): WikiPageShare => ({
  pageId: SHARE_PAGE,
  token: tokenOf(1),
  audience: 'WORKSPACE',
  permission: 'VIEW',
  includeChildren: false,
  people: [],
  createdBy: { userId: 1, name: '나' },
  createdAt: '2026-10-20T00:00:00Z',
  updatedAt: '2026-10-20T00:00:00Z',
  expiresAt: null,
  lastAccessedAt: null,
  viewCount: 0,
  ...over,
})

/** 공유하는 쪽 노트 화면 — 공유 상태·저장·재발급·해제·기록·접근 요청 처리. 요청은 calls 에 모은다. */
function openShareOwner(server: ServerShare, { role = 'OWNER' as WikiRole, path = `/wiki/spaces/${SHARE_SPACE}/pages/${SHARE_PAGE}` } = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = []
  const sharePath = `/api/v1/wiki/pages/${SHARE_PAGE}/share`
  const record = async (request: Request) => {
    const body = request.method === 'PUT' ? await request.json() : undefined
    calls.push({ method: request.method, path: new URL(request.url).pathname, body })
  }
  const view = open({
    path,
    spaces: () => [wikiSpace({ id: SHARE_SPACE, type: 'PERSONAL', name: '내 노트', role })],
    tree: () => [
      {
        ...wikiPageSummary({ id: SHARE_PAGE, title: SHARE_TITLE }),
        share: server.share && { audience: server.share.audience, includeChildren: server.share.includeChildren },
      },
    ],
    detail: (id) => wikiPageDetail({ id, spaceId: SHARE_SPACE, title: SHARE_TITLE, shared: server.share != null }),
    handlers: [
      http.get(sharePath, async ({ request }) => {
        await record(request)
        const state: WikiPageShareState = { share: server.share, externalShareEnabled: true, inheritedFrom: null, accessRequests: server.accessRequests, excludedFromParent: false, excludedPages: [] }
        return HttpResponse.json(state)
      }),
      http.put(sharePath, async ({ request }) => {
        const req = (await request.clone().json()) as { audience: WikiPageShare['audience']; permission: WikiPageShare['permission']; includeChildren: boolean; expiresAt: string | null }
        await record(request)
        server.share = existingShare({ ...req, token: server.share?.token ?? tokenOf(server.tokenSeq) })
        return HttpResponse.json(server.share)
      }),
      http.delete(sharePath, async ({ request }) => {
        await record(request)
        server.share = null
        return new HttpResponse(null, { status: 204 })
      }),
      http.post(`${sharePath}/regenerate`, async ({ request }) => {
        await record(request)
        server.tokenSeq += 1
        server.share = { ...(server.share as WikiPageShare), token: tokenOf(server.tokenSeq) }
        return HttpResponse.json(server.share)
      }),
      // 사람 지정 공유의 사람 고르기(MemberSearchPopover)가 미리 부르는 구성원 검색.
      http.get('/api/v1/members', () => HttpResponse.json({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 })),
      http.get(`${sharePath}/events`, async ({ request }) => (await record(request), HttpResponse.json([]))),
      http.post(`${sharePath}/access-requests/:id/:decision`, async ({ request, params }) => {
        await record(request)
        server.accessRequests = server.accessRequests.filter((r) => r.id !== Number(params.id))
        return new HttpResponse(null, { status: 204 })
      }),
    ],
  })
  return { ...view, calls }
}

const newServer = (over: Partial<ServerShare> = {}): ServerShare => ({ share: null, accessRequests: [], tokenSeq: 1, ...over })
const shareDialog = () => screen.findByTestId('wiki-share-dialog')

describe('노트 공유 — 공유하는 쪽', () => {
  test('외부 공개로 바꾸면 확인을 받은 뒤 보기·이 페이지만·30일 만료로 저장한다', async () => {
    // 만료는 지금(Date)으로 정해진다 — 시각만 고정하고 타이머는 그대로 둔다.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-21T03:00:00.000Z') })
    const server = newServer({ share: existingShare({ permission: 'EDIT', includeChildren: true }) })
    const { user, calls } = openShareOwner(server)
    await user.click(await screen.findByTestId('wiki-share-button'))
    const dialog = await shareDialog()
    await user.click(within(dialog).getByTestId('wiki-share-audience'))
    await user.click(await screen.findByRole('option', { name: /링크가 있는 누구나\(외부\)/ }))
    const confirm = await screen.findByTestId('wiki-share-confirm')
    expect(confirm).toHaveTextContent('외부에 공개할까요?')
    // 확인을 받기 전에는 저장하지 않는다.
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([])
    await user.click(within(confirm).getByRole('button', { name: '외부 공개' }))
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([
        { audience: 'PUBLIC', permission: 'VIEW', includeChildren: false, userIds: [], expiresAt: '2026-11-20T03:00:00.000Z' },
      ]),
    )
    await waitFor(() => expect(within(dialog).getByTestId('wiki-share-permission')).toBeDisabled())
    expect(within(dialog).getByTestId('wiki-share-expiry')).toHaveTextContent('2026')
  })

  test('재발급·해제는 확인을 받고, 해제하면 헤더·트리가 공유 전으로 돌아간다', async () => {
    const server = newServer({ share: existingShare() })
    const { user, calls } = openShareOwner(server)
    // 공유 중 — 헤더는 「공유 중」, 트리에 자기 공유 표시.
    expect(await screen.findByTestId('wiki-share-button')).toHaveTextContent('공유 중')
    expect(screen.getByTestId(`wiki-tree-shared-${SHARE_PAGE}`)).toHaveAttribute('data-mark', 'own')
    await user.click(screen.getByTestId('wiki-share-button'))
    const dialog = await shareDialog()
    const origin = window.location.origin
    await waitFor(() => expect(within(dialog).getByTestId('wiki-share-url')).toHaveValue(`${origin}/wiki/share/${tokenOf(1)}`))
    const posts = () => calls.filter((c) => c.method === 'POST' && c.path.endsWith('/regenerate'))
    const deletes = () => calls.filter((c) => c.method === 'DELETE')
    // 재발급 — 취소하면 보내지 않고, 확인하면 새 링크로 바뀐다.
    await user.click(within(dialog).getByTestId('wiki-share-regenerate'))
    expect(await screen.findByTestId('wiki-share-confirm')).toHaveTextContent('링크를 다시 만들까요?')
    await user.click(within(screen.getByTestId('wiki-share-confirm')).getByRole('button', { name: '취소' }))
    expect(posts()).toEqual([])
    await user.click(within(dialog).getByTestId('wiki-share-regenerate'))
    await user.click(within(await screen.findByTestId('wiki-share-confirm')).getByRole('button', { name: '다시 만들기' }))
    await waitFor(() => expect(within(dialog).getByTestId('wiki-share-url')).toHaveValue(`${origin}/wiki/share/${tokenOf(2)}`))
    expect(posts()).toHaveLength(1)
    // 해제 — 확인해야 DELETE 가 나가고, 끝나면 공유 전 화면으로 돌아간다.
    await user.click(within(dialog).getByTestId('wiki-share-switch'))
    expect(await screen.findByTestId('wiki-share-confirm')).toHaveTextContent('공유를 해제할까요?')
    expect(deletes()).toEqual([])
    await user.click(within(screen.getByTestId('wiki-share-confirm')).getByRole('button', { name: '해제' }))
    await waitFor(() => expect(within(dialog).queryByTestId('wiki-share-url')).not.toBeInTheDocument())
    expect(deletes()).toHaveLength(1)
    await user.click(within(dialog).getByRole('button', { name: '완료' }))
    await waitFor(() => expect(screen.getByTestId('wiki-share-button')).toHaveTextContent(/^공유$/))
    await waitFor(() => expect(screen.queryByTestId(`wiki-tree-shared-${SHARE_PAGE}`)).not.toBeInTheDocument())
  })

  test('접근 요청을 승인·거절하면 그 API 를 부르고, 처리된 요청은 목록에서 사라진다', async () => {
    const server = newServer({
      share: existingShare({ audience: 'PEOPLE' }),
      accessRequests: [
        { id: 41, requester: { userId: 9, name: '최요청' }, requestedAt: '2026-10-20T02:00:00Z' },
        { id: 42, requester: { userId: 10, name: '정거절' }, requestedAt: '2026-10-20T03:00:00Z' },
      ],
    })
    const { user, calls } = openShareOwner(server)
    await user.click(await screen.findByTestId('wiki-share-button'))
    const requests = await screen.findByTestId('wiki-share-requests')
    expect(requests).toHaveTextContent('접근 요청 2건')
    const row = (name: string) => within(screen.getByTestId('wiki-share-requests')).getByText(name).closest('li') as HTMLElement
    await user.click(within(row('최요청')).getByRole('button', { name: '승인' }))
    await waitFor(() => expect(screen.getByTestId('wiki-share-requests')).toHaveTextContent('접근 요청 1건'))
    expect(screen.getByTestId('wiki-share-requests')).not.toHaveTextContent('최요청')
    await user.click(within(row('정거절')).getByRole('button', { name: '거절' }))
    await waitFor(() => expect(screen.queryByTestId('wiki-share-requests')).not.toBeInTheDocument())
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
      `/api/v1/wiki/pages/${SHARE_PAGE}/share/access-requests/41/approve`,
      `/api/v1/wiki/pages/${SHARE_PAGE}/share/access-requests/42/deny`,
    ])
  })

  test('접근 요청 알림으로 ?share=1 을 달고 열면 편집자에게 공유 창을 띄운다', async () => {
    openShareOwner(newServer(), { path: `/wiki/spaces/${SHARE_SPACE}/pages/${SHARE_PAGE}?share=1` })
    expect(await screen.findByRole('dialog')).toHaveTextContent('링크로 공유')
  })

  test('읽기 전용(VIEWER)에게는 공유 버튼이 없고 공유 상태도 조회하지 않으며, ?share=1 표시는 지운다', async () => {
    const server = newServer({ share: existingShare() })
    const { calls, location } = openShareOwner(server, { role: 'VIEWER', path: `/wiki/spaces/${SHARE_SPACE}/pages/${SHARE_PAGE}?share=1` })
    expect(await screen.findByTestId('wiki-page-menu')).toBeInTheDocument()
    await waitFor(() => expect(location()).toBe(`/wiki/spaces/${SHARE_SPACE}/pages/${SHARE_PAGE}`))
    expect(screen.queryByTestId('wiki-share-button')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // 트리의 공유 표시는 읽기 전용에게도 보인다(트리 응답이 싣는 요약일 뿐 토큰은 없다).
    expect(screen.getByTestId(`wiki-tree-shared-${SHARE_PAGE}`)).toBeInTheDocument()
    expect(calls).toEqual([])
  })
})

// ── 버전 기록(wiki-revisions) ─────────────────────────────────────────────
// 미리보기의 변경 표시·복원은 라이브 문서(동기화 서버)와 편집 가능(첫 동기화 뒤)에 달려 E2E 에 남는다. 목록·주소 상태만 여기서 본다.

const REV_PAGE = 282
const REV_TITLE = '10월 1주차 스프린트 리뷰'
const KIM = { id: 2, name: '김철수' }
const LEE = { id: 5, name: '이영희' }
const PARK = { id: 3, name: '박민수' }
const CHOI = { id: 6, name: '최수진 (플랫폼개발팀 · 백엔드 파트 리드)' }
const revItem = (version: number, iso: string, editors: { id: number; name: string }[], aiActor: { id: number; name: string } | null = null) => ({
  version,
  title: REV_TITLE,
  editedAt: new Date(iso).toISOString(),
  createdAt: new Date(iso).toISOString(),
  reason: aiActor ? ('AI' as const) : ('SESSION' as const),
  editors,
  aiActor,
})
const REV_LIST: WikiRevisionList = {
  current: { version: 7, editedAt: new Date('2026-10-07T14:50:00+09:00').toISOString(), editors: [KIM, PARK, LEE] },
  items: [
    revItem(6, '2026-10-07T14:32:00+09:00', [LEE], LEE),
    revItem(5, '2026-10-07T14:05:00+09:00', [KIM, PARK]),
    revItem(4, '2026-10-07T11:20:00+09:00', [LEE]),
    revItem(3, '2026-10-06T17:48:00+09:00', [CHOI]),
    revItem(2, '2026-10-05T09:12:00+09:00', [KIM]),
  ],
}

/** 버전 기록 화면 — 날짜 묶음이 실행 시각에 흔들리지 않게 Date 만 2026-10-07 15:00(KST)으로 고정한다. */
function openRevisions() {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-07T15:00:00+09:00') })
  return open({
    path: `/wiki/spaces/1/pages/${REV_PAGE}`,
    tree: () => [wikiPageSummary({ id: REV_PAGE, title: REV_TITLE })],
    detail: (id) => wikiPageDetail({ id, title: REV_TITLE }),
    handlers: [
      http.get(`/api/v1/wiki/pages/${REV_PAGE}/revisions`, () => HttpResponse.json(REV_LIST)),
      http.get(`/api/v1/wiki/pages/${REV_PAGE}/revisions/:v`, ({ params }) => {
        const item = REV_LIST.items.find((i) => i.version === Number(params.v))
        return HttpResponse.json({ ...item, body: `${params.v}판 본문` })
      }),
    ],
  })
}
const revRow = (v: number | 'current') => screen.getByTestId(`wiki-revision-item-${v}`)

describe('노트 버전 기록', () => {
  test('⋯ → 버전 기록은 날짜로 묶은 목록을 보이고, 맨 위는 현재 버전, AI 판은 ✦ 표식이며 고른 줄로 선택이 옮겨 가고 ✕ 로 닫는다', async () => {
    const { user, location } = openRevisions()
    await openPageMenu(user)
    await user.click(await screen.findByTestId('wiki-menu-history'))
    const panel = await screen.findByTestId('wiki-revision-panel')
    expect(location()).toMatch(/[?&]history=1/)
    await waitFor(() => expect([...panel.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['오늘', '어제', '10월 5일']))
    expect(revRow('current')).toHaveTextContent('현재 버전')
    expect(revRow('current')).toHaveTextContent('김철수 외 2명 · 편집 중')
    expect(revRow('current')).toHaveAttribute('aria-current', 'true')
    expect(revRow(6)).toHaveTextContent('14:32')
    expect(revRow(6)).toHaveTextContent('이영희 (AI 수정)')
    expect(revRow(6).querySelector('svg.lucide-sparkles')).not.toBeNull()
    expect(revRow(5)).toHaveTextContent('김철수, 박민수')
    expect(revRow(3)).toHaveTextContent('17:48')
    expect(revRow(2)).toHaveTextContent('09:12')
    // 선택 줄(aria-current)만 선택 표시(막대 + bg-selected) — 판을 고르면 표시가 옮겨 간다(WP-368).
    expect(revRow('current').className).toMatch(/bg-selected/)
    expect(revRow(5).className).not.toMatch(/bg-selected/)
    await user.click(revRow(5))
    await waitFor(() => expect(revRow(5)).toHaveAttribute('aria-current', 'true'))
    expect(revRow(5).className).toMatch(/bg-selected/)
    expect(revRow(5).className).toMatch(/selection-bar/)
    expect(revRow('current')).not.toHaveAttribute('aria-current')
    await user.click(screen.getByTestId('wiki-revision-panel-close'))
    await waitFor(() => expect(screen.queryByTestId('wiki-revision-panel')).not.toBeInTheDocument())
    expect(location()).not.toMatch(/history=/)
  })

  test('판을 고르면 읽기 전용 미리보기가 열리고, 뒤로 가기는 미리보기 → 목록 → 노트 순으로 닫는다', async () => {
    const { user, location } = openRevisions()
    await openPageMenu(user)
    await user.click(await screen.findByTestId('wiki-menu-history'))
    await screen.findByTestId('wiki-revision-panel')
    await user.click(await screen.findByTestId('wiki-revision-item-5'))
    expect(await screen.findByTestId('wiki-revision-bar')).toHaveTextContent('10월 7일 14:05 버전 미리보기 — 읽기 전용')
    expect(location()).toMatch(/[?&]rev=5/)
    // 편집기는 마운트된 채 가려진다(inert) — 미리보기는 편집할 수 없다.
    expect(screen.getByTestId('wiki-editor-scroll')).toHaveAttribute('inert')
    act(() => window.history.back())
    await waitFor(() => expect(screen.queryByTestId('wiki-revision-bar')).not.toBeInTheDocument())
    expect(screen.getByTestId('wiki-revision-panel')).toBeInTheDocument()
    expect(revRow('current')).toHaveAttribute('aria-current', 'true')
    expect(location()).toMatch(/[?&]history=1/)
    expect(location()).not.toMatch(/rev=/)
    act(() => window.history.back())
    await waitFor(() => expect(screen.queryByTestId('wiki-revision-panel')).not.toBeInTheDocument())
    expect(location()).toBe(`/wiki/spaces/1/pages/${REV_PAGE}`)
  })
})

afterEach(() => {
  vi.useRealTimers()
})

