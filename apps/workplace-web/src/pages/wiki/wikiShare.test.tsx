// 노트 공유 링크 화면 — 외부 보기(로그인 없음)·받는 사람 공유 화면의 실패 갈래·알림 입구(/wiki/open/:pageId) 화면 테스트(WP-971, WP-995, WP-983).
// 외부 보기의 응답 → 화면(트리·본문·가린 멘션·링크), 하위 이동의 ?pageId 질의, 만료·하위만 닫힘·해제·일시 오류·로그인 필요(401) 안내,
// 받는 사람 화면의 외부 보기 전환(409 PUBLIC)·일시 실패(5xx)·접근 요청, 알림 입구의 갈 곳 판정은 브라우저 없이 판정되므로
// wiki-share-public · wiki-share-view 에서 옮겼다. 이미지 실제 로드·전체 폭 기하·robots.txt·동기화 서버 연결·워크스페이스 전환 새로고침은 E2E 에 남는다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { useState } from 'react'
import { Route, Routes, useParams } from 'react-router-dom'
import { describe, expect, test } from 'vitest'

import { WikiSharePublicViewContext } from '@/components/wiki/wikiSharePublicView'
import { renderScreen } from '@/test/renderScreen'
import type { WikiPublicShare, WikiShareAccessRequestResult, WikiShareResolved } from '@/types/wiki'

import { wikiPageDetail, wikiPageSummary } from '../../../e2e/factories/wiki.factory'
import { attachSilentCollab,editorSideHandlers } from './testkit-b3-msw'
import { WikiOpenPage } from './WikiOpenPage'
import { WikiPublicSharePage } from './WikiPublicSharePage'
import { WikiSharePage } from './WikiSharePage'

// ── 외부 보기(wiki-share-public) ─────────────────────────────────────────

const TOKEN = 'wsh_e2ePublic1'
const API = `/api/v1/public/wiki/shares/${TOKEN}`
const ROOT = 41
const CHILD = 42
const PAGES: WikiPublicShare['pages'] = [
  { id: ROOT, parentId: null, title: '제품 로드맵', position: 0 },
  { id: CHILD, parentId: ROOT, title: '하반기 계획', position: 0 },
]
// 서버가 이미 가린 마크다운 — 가려진 멘션은 자리표시 글자, 범위 안 페이지 멘션은 제목 글자, 내부 링크는 글자만 남는다.
const ROOT_BODY = [
  '외부에 공개된 본문입니다',
  '담당 ‹접근 권한 없음› 관련 ‹접근 권한 없음›',
  '범위 안 페이지 하반기 계획 와 내부 링크 글자',
  '[참고 문서](https://example.com/ref)',
].join('\n\n')
const CHILD_BODY = '하위 페이지 본문입니다'
const share = (pageId: number): WikiPublicShare => ({
  workspaceName: '아이에이클라우드',
  rootPageId: ROOT,
  pages: PAGES,
  page: {
    id: pageId,
    title: PAGES.find((p) => p.id === pageId)?.title ?? '',
    markdown: pageId === ROOT ? ROOT_BODY : CHILD_BODY,
    updatedAt: '2026-10-21T01:00:00Z',
  },
})

/** 공개 조회 — respond(pageId) 가 응답을 정한다(기본 200). 받은 ?pageId 를 순서대로 모은다(없으면 null). */
function openPublic(path: string, respond: (pageId: number | null) => Response | Promise<Response> = (id) => HttpResponse.json(share(id ?? ROOT))) {
  const asked: (string | null)[] = []
  const view = renderScreen(
    <Routes>
      <Route path="/wiki/share/:token/*" element={<WikiPublicSharePage />} />
      <Route path="*" element={null} />
    </Routes>,
    {
      path,
      handlers: [
        http.get(API, ({ request }) => {
          const p = new URL(request.url).searchParams.get('pageId')
          asked.push(p)
          return respond(p == null ? null : Number(p))
        }),
      ],
    },
  )
  return { ...view, asked }
}
const publicView = () => screen.getByTestId('wiki-public-share-page')
const tree = () => screen.getByTestId('wiki-public-share-tree')

describe('노트 외부 보기(로그인 없음)', () => {
  test('공유 루트를 pageId 없이 묻고, 워크스페이스·제목·가린 본문을 읽기 전용으로 그리며 바깥 링크는 새 탭(opener 차단)이다', async () => {
    const { asked } = openPublic(`/wiki/share/${TOKEN}`)
    expect(await screen.findByRole('heading', { name: '제품 로드맵' })).toBeInTheDocument()
    expect(publicView()).toHaveTextContent('아이에이클라우드')
    expect(asked[0]).toBeNull()
    // 검색엔진 색인 막기 — 화면도 noindex 를 둔다.
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', expect.stringMatching(/noindex/))
    await waitFor(() => expect(document.title).toMatch(/제품 로드맵/))
    const body = publicView().querySelector('.wiki-editor') as HTMLElement
    await waitFor(() => expect(body).toHaveTextContent('외부에 공개된 본문입니다'))
    expect(body.querySelector('.ProseMirror')).toHaveAttribute('contenteditable', 'false')
    // 가려진 멘션은 「접근 권한 없음」 글자, 범위 안 페이지·내부 링크는 글자만 — 앱 안으로 가는 링크 없이 바깥 링크 하나만 남는다.
    expect(body).toHaveTextContent('담당 ‹접근 권한 없음› 관련 ‹접근 권한 없음›')
    expect(body).toHaveTextContent('범위 안 페이지 하반기 계획 와 내부 링크 글자')
    const links = body.querySelectorAll('a')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', 'https://example.com/ref')
    expect(links[0]).toHaveAttribute('target', '_blank')
    expect(links[0].getAttribute('rel')).toMatch(/noopener/)
    expect(links[0].getAttribute('rel')).toMatch(/noreferrer/)
  })

  test('트리로 하위 페이지로 옮기면 ?pageId 로 묻고 주소·제목·본문이 바뀌며 트리는 남는다 — 하위 주소로 바로 열어도 그 페이지를 묻는다', async () => {
    const { user, location, asked, unmount } = openPublic(`/wiki/share/${TOKEN}`)
    await user.click(within(await screen.findByTestId('wiki-public-share-tree')).getByRole('button', { name: '하반기 계획' }))
    await waitFor(() => expect(location()).toBe(`/wiki/share/${TOKEN}/pages/${CHILD}`))
    await waitFor(() => expect(publicView()).toHaveTextContent(CHILD_BODY))
    expect(screen.getByRole('heading', { name: '하반기 계획' })).toBeInTheDocument()
    expect(asked.at(-1)).toBe(String(CHILD))
    expect(within(tree()).getByRole('button', { name: '제품 로드맵' })).toBeInTheDocument()
    unmount()
    // 새로고침과 같은 진입 — 주소의 pageId 로 같은 페이지를 연다.
    const again = openPublic(`/wiki/share/${TOKEN}/pages/${CHILD}`)
    await waitFor(() => expect(publicView()).toHaveTextContent(CHILD_BODY))
    expect(again.asked).toEqual([String(CHILD)])
  })

  test('하위 응답을 기다리는 동안에도 트리가 남고 본문이 skeleton 으로 깜빡이지 않는다', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { user, location } = openPublic(`/wiki/share/${TOKEN}`, async (id) => {
      if (id === CHILD) await gate
      return HttpResponse.json(share(id ?? ROOT))
    })
    await user.click(within(await screen.findByTestId('wiki-public-share-tree')).getByRole('button', { name: '하반기 계획' }))
    await waitFor(() => expect(location()).toBe(`/wiki/share/${TOKEN}/pages/${CHILD}`))
    expect(within(tree()).getByRole('button', { name: '제품 로드맵' })).toBeInTheDocument()
    expect(screen.queryByTestId('wiki-public-share-skeleton')).not.toBeInTheDocument()
    release()
    await waitFor(() => expect(publicView()).toHaveTextContent(CHILD_BODY))
  })

  test('휴대폰용 「공유된 페이지」 선택 상자로 고르면 그 페이지를 묻는다(트리는 md 이상에서만 보인다)', async () => {
    const { user, asked } = openPublic(`/wiki/share/${TOKEN}`)
    const select = await screen.findByLabelText('공유된 페이지')
    await user.selectOptions(select, String(CHILD))
    await waitFor(() => expect(publicView()).toHaveTextContent(CHILD_BODY))
    expect(asked.at(-1)).toBe(String(CHILD))
  })

  test('만료·해제(404)면 링크가 열리지 않는다고 안내하고 트리·본문은 없다(noindex 는 그대로)', async () => {
    openPublic(`/wiki/share/${TOKEN}`, () => HttpResponse.json({ message: 'x' }, { status: 404 }))
    await waitFor(() => expect(publicView()).toHaveTextContent('링크가 열리지 않습니다'))
    expect(publicView()).toHaveTextContent('공유가 해제됐거나 만료됐을 수 있습니다')
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', expect.stringMatching(/noindex/))
    expect(screen.queryByTestId('wiki-public-share-tree')).not.toBeInTheDocument()
  })

  test('하위 페이지 하나만 404 면 트리·머리는 두고 본문에만 안내하며, 다른 페이지로 다시 옮길 수 있다', async () => {
    const { user } = openPublic(`/wiki/share/${TOKEN}`, (id) =>
      id === CHILD ? HttpResponse.json({ message: 'x' }, { status: 404 }) : HttpResponse.json(share(ROOT)),
    )
    await user.click(within(await screen.findByTestId('wiki-public-share-tree')).getByRole('button', { name: '하반기 계획' }))
    await waitFor(() => expect(publicView()).toHaveTextContent('이 페이지는 더 이상 공유되지 않습니다'))
    expect(publicView()).not.toHaveTextContent('링크가 열리지 않습니다')
    expect(publicView()).toHaveTextContent('아이에이클라우드')
    await user.click(within(tree()).getByRole('button', { name: '제품 로드맵' }))
    await waitFor(() => expect(publicView()).toHaveTextContent('외부에 공개된 본문입니다'))
  })

  /** 닫힌 링크 화면 — 옛 트리·제목·워크스페이스 이름이 하나도 남지 않아야 한다. */
  async function expectLinkGone() {
    await waitFor(() => expect(publicView()).toHaveTextContent('링크가 열리지 않습니다'))
    expect(screen.queryByTestId('wiki-public-share-tree')).not.toBeInTheDocument()
    for (const stale of ['제품 로드맵', '하반기 계획', '아이에이클라우드', '외부에 공개된 본문입니다']) {
      expect(publicView()).not.toHaveTextContent(stale)
    }
    expect(publicView()).not.toHaveTextContent('이 페이지는 더 이상 공유되지 않습니다')
  }

  test('해제된 뒤 다른 페이지를 열면 옛 트리·제목 없이 링크가 닫힌 안내가 뜨고, 뒤로 가 루트로 와도 옛 본문이 보이지 않는다', async () => {
    let revoked = false
    const { user, location } = openPublic(`/wiki/share/${TOKEN}`, (id) =>
      revoked ? HttpResponse.json({ message: 'x' }, { status: 404 }) : HttpResponse.json(share(id ?? ROOT)),
    )
    const nav = await screen.findByTestId('wiki-public-share-tree')
    revoked = true
    // 아직 열지 않은(캐시에 없는) 하위 페이지 — 404 뒤 루트를 다시 물어 해제를 알아챈다.
    await user.click(within(nav).getByRole('button', { name: '하반기 계획' }))
    await expectLinkGone()
    act(() => window.history.back())
    await waitFor(() => expect(location()).toBe(`/wiki/share/${TOKEN}`))
    await expectLinkGone()
  })

  test('하위만 닫힌 안내 뒤 링크가 해제되면 「처음 페이지로」도 닫힌 안내를 보인다', async () => {
    let revoked = false
    const { user } = openPublic(`/wiki/share/${TOKEN}`, (id) =>
      id === CHILD || revoked ? HttpResponse.json({ message: 'x' }, { status: 404 }) : HttpResponse.json(share(ROOT)),
    )
    await user.click(within(await screen.findByTestId('wiki-public-share-tree')).getByRole('button', { name: '하반기 계획' }))
    await waitFor(() => expect(publicView()).toHaveTextContent('이 페이지는 더 이상 공유되지 않습니다'))
    revoked = true
    await user.click(within(publicView()).getByRole('button', { name: '처음 페이지로' }))
    await expectLinkGone()
  })

  test('일시적인 서버 오류(500)는 만료와 다르게 안내하고 다시 시도하면 열린다', async () => {
    let fail = true
    const { user } = openPublic(`/wiki/share/${TOKEN}`, () =>
      fail ? HttpResponse.json({ message: 'x' }, { status: 500 }) : HttpResponse.json(share(ROOT)),
    )
    await waitFor(() => expect(publicView()).toHaveTextContent('문서를 불러오지 못했습니다'))
    expect(publicView()).not.toHaveTextContent('만료됐을 수 있습니다')
    fail = false
    await user.click(within(publicView()).getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(publicView()).toHaveTextContent('외부에 공개된 본문입니다'))
  })

  test('로그인해야 열리는 내부 링크(401)는 로그인으로 보내고, 열었던 하위 주소를 대기 목적지로 남긴다', async () => {
    const { location } = openPublic(`/wiki/share/${TOKEN}/pages/${CHILD}`, () => HttpResponse.json({ loginRequired: true }, { status: 401 }))
    await waitFor(() => expect(location()).toBe('/login'))
    expect(JSON.parse(sessionStorage.getItem('pendingPushTarget') ?? 'null')).toEqual({ tenantId: null, url: `/wiki/share/${TOKEN}/pages/${CHILD}` })
  })
})

// ── 받는 사람 공유 화면의 실패 갈래(wiki-share-view) ─────────────────────────

const VIEW_TOKEN = 'wsh_e2eShare1'
const SHARE_SPACE = 9
const VROOT = 31
const VCHILD = 32
const resolved = (over: Partial<WikiShareResolved> = {}): WikiShareResolved => ({
  rootPageId: VROOT,
  spaceId: SHARE_SPACE,
  permission: 'VIEW',
  includeChildren: true,
  sharedBy: { userId: 2, name: '김민지' },
  member: false,
  pages: [wikiPageSummary({ id: VROOT, title: '제품 로드맵' }), wikiPageSummary({ id: VCHILD, parentId: VROOT, title: '하반기 계획' })],
  ...over,
})

/**
 * 입구(App 의 WikiShareGate)와 같은 전환 — 공유 화면이 외부 보기를 부르면 그 토큰은 외부 보기로 그린다.
 * 로그인 상태(renderScreen 의 고정 인증)에서 받는 사람 화면을 띄우기 위해 앱 셸 대신 이 입구로 감싼다.
 */
function Gate() {
  const { token = '' } = useParams()
  const [publicToken, setPublicToken] = useState<string | null>(null)
  if (publicToken === token) return <WikiPublicSharePage />
  return (
    <WikiSharePublicViewContext.Provider value={setPublicToken}>
      <WikiSharePage />
    </WikiSharePublicViewContext.Provider>
  )
}

/** 받는 사람 화면 — 링크 열기 응답은 resolve() 로 매번 다시 정한다. 받는 사람 자신의 스페이스(5)만 있다. */
function openShareView(resolve: () => Response, handlers: RequestHandler[] = []) {
  const selects: unknown[] = []
  attachSilentCollab()
  const view = renderScreen(
    <Routes>
      <Route path="/wiki/share/:token" element={<Gate />} />
      <Route path="/wiki/share/:token/pages/:pageId" element={<Gate />} />
      <Route path="*" element={null} />
    </Routes>,
    {
      path: `/wiki/share/${VIEW_TOKEN}`,
      handlers: [
        ...handlers,
        ...editorSideHandlers,
        http.post('/api/v1/auth/select-tenant', async ({ request }) => (selects.push(await request.json()), HttpResponse.json({}))),
        http.get('/api/v1/wiki/spaces', () => HttpResponse.json([{ id: 5, type: 'PERSONAL', name: '내 노트', ownerId: 1, role: 'OWNER', createdAt: '2026-06-01T00:00:00Z' }])),
        http.get(`/api/v1/wiki/shares/${VIEW_TOKEN}`, () => resolve()),
        http.get('/api/v1/wiki/pages/:id', ({ params }) =>
          HttpResponse.json(wikiPageDetail({ id: Number(params.id), spaceId: SHARE_SPACE, title: '제품 로드맵', body: '공유된 본문입니다' })),
        ),
        http.get('/api/v1/wiki/pages/:id/summary', () => HttpResponse.json({ summary: null, status: 'TOO_SHORT', summaryVersion: null, pageVersion: 1, summarizedAt: null })),
      ],
    },
  )
  return { ...view, selects }
}
const forbidden = (denied = false) =>
  HttpResponse.json({ status: 403, error: 'Forbidden', message: '이 링크를 열 수 없습니다', requested: false, denied }, { status: 403 })

describe('노트 공유 링크 — 받는 사람', () => {
  test('다른 워크스페이스의 외부 링크(409 WIKI_SHARE_PUBLIC)는 전환 없이 외부 보기를 그린다', async () => {
    const publicShare: WikiPublicShare = {
      workspaceName: '다른 회사',
      rootPageId: VROOT,
      pages: [{ id: VROOT, parentId: null, title: '공개 문서', position: 0 }],
      page: { id: VROOT, title: '공개 문서', markdown: '외부에 공개된 본문', updatedAt: '2026-10-21T01:00:00Z' },
    }
    const { selects } = openShareView(
      () => HttpResponse.json({ status: 409, error: 'Conflict', message: '외부 보기로 여는 공유 링크입니다', code: 'WIKI_SHARE_PUBLIC' }, { status: 409 }),
      [http.get(`/api/v1/public/wiki/shares/${VIEW_TOKEN}`, () => HttpResponse.json(publicShare))],
    )
    const view = await screen.findByTestId('wiki-public-share-page')
    expect(await within(view).findByRole('heading', { name: '공개 문서' })).toBeInTheDocument()
    await waitFor(() => expect(view).toHaveTextContent('외부에 공개된 본문'))
    expect(view).toHaveTextContent('다른 회사')
    expect(screen.queryByTestId('wiki-share-unavailable')).not.toBeInTheDocument()
    expect(selects).toEqual([])
  })

  test('링크 열기가 일시적으로 실패하면(5xx) 닫힌 링크가 아니라 다시 시도로 안내하고, 다시 시도하면 공유 화면이 열린다', async () => {
    let fail = true
    const { user } = openShareView(() =>
      fail ? HttpResponse.json({ status: 503, message: '잠시 후 다시 시도' }, { status: 503 }) : HttpResponse.json(resolved()),
    )
    const box = await screen.findByTestId('wiki-share-load-error')
    expect(box).toHaveTextContent('문서를 불러오지 못했습니다')
    expect(screen.queryByTestId('wiki-share-unavailable')).not.toBeInTheDocument()
    expect(screen.queryByText('링크가 더 이상 열리지 않습니다')).not.toBeInTheDocument()
    fail = false
    await user.click(within(box).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByTestId('wiki-page-shared-by')).toHaveTextContent('김민지님이 공유')
    expect(screen.getByTestId('wiki-share-tree')).toHaveTextContent('하반기 계획')
  })

  test.each([
    ['PENDING', '요청함', '접근을 요청했습니다'],
    ['DENIED', '거절됨', '접근 요청이 거절되었습니다'],
  ] as const)('지정한 사람이 아니면 접근 요청을 한 번 보내고, 응답 %s 면 「%s」(비활성)으로 안내한다', async (status, label, text) => {
    const posts: string[] = []
    const result: WikiShareAccessRequestResult = { status }
    const { user } = openShareView(() => forbidden(), [
      http.post(`/api/v1/wiki/shares/${VIEW_TOKEN}/access-requests`, ({ request }) => (posts.push(request.url), HttpResponse.json(result))),
    ])
    const box = await screen.findByTestId('wiki-share-unavailable')
    expect(box).toHaveTextContent('이 링크를 열 수 없습니다')
    await user.click(within(box).getByRole('button', { name: '접근 요청' }))
    expect(await within(box).findByRole('button', { name: label })).toBeDisabled()
    expect(box).toHaveTextContent(text)
    expect(posts).toHaveLength(1)
  })

  test('최근 거절된 링크는 처음부터 「거절됨」으로 보이고 요청을 보내지 않는다', async () => {
    const posts: string[] = []
    openShareView(() => forbidden(true), [
      http.post(`/api/v1/wiki/shares/${VIEW_TOKEN}/access-requests`, ({ request }) => (posts.push(request.url), HttpResponse.json({ status: 'PENDING' }))),
    ])
    const box = await screen.findByTestId('wiki-share-unavailable')
    expect(box).toHaveTextContent('접근 요청이 거절되었습니다')
    expect(within(box).getByRole('button', { name: '거절됨' })).toBeDisabled()
    expect(posts).toEqual([])
  })
})

// ── 알림 입구 /wiki/open/:pageId(wiki-share-view) ─────────────────────────────

/** 입구 판정(GET /wiki/pages/{id}/entry) 응답으로 갈 곳을 본다 — 도착 화면은 각 화면 테스트·E2E 가 본다. */
function openEntry(entry: () => Response, search = '') {
  return renderScreen(
    <Routes>
      <Route path="/wiki/open/:pageId" element={<WikiOpenPage />} />
      <Route path="*" element={null} />
    </Routes>,
    { path: `/wiki/open/${VCHILD}${search}`, handlers: [http.get(`/api/v1/wiki/pages/${VCHILD}/entry`, () => entry())] },
  )
}

describe('노트 알림 진입 — /wiki/open/:pageId', () => {
  test('공유 대상이면 지금 링크의 공유 화면 주소로 연다', async () => {
    const { location } = openEntry(() => HttpResponse.json({ spaceId: SHARE_SPACE, member: false, shareToken: VIEW_TOKEN }))
    await waitFor(() => expect(location()).toBe(`/wiki/share/${VIEW_TOKEN}/pages/${VCHILD}`))
  })

  test('멤버면 원래 노트 주소로, 접근 요청 알림의 ?share=1 은 그대로 넘긴다', async () => {
    const { location } = openEntry(() => HttpResponse.json({ spaceId: SHARE_SPACE, member: true, shareToken: null }), '?share=1')
    await waitFor(() => expect(location()).toBe(`/wiki/spaces/${SHARE_SPACE}/pages/${VCHILD}?share=1`))
  })

  test('열 수 없는 노트(404)면 안내한다', async () => {
    openEntry(() => HttpResponse.json({ status: 404, message: '페이지를 찾을 수 없습니다' }, { status: 404 }))
    expect(await screen.findByTestId('wiki-open-unavailable')).toHaveTextContent('노트를 열 수 없습니다')
  })

  test('입구 판정이 일시적으로 실패하면(500) 다시 시도로 안내한다', async () => {
    openEntry(() => HttpResponse.json({ status: 500, message: '서버 오류' }, { status: 500 }))
    expect(await screen.findByTestId('wiki-open-load-error')).toHaveTextContent('노트를 불러오지 못했습니다')
    expect(screen.queryByTestId('wiki-open-unavailable')).not.toBeInTheDocument()
  })
})
