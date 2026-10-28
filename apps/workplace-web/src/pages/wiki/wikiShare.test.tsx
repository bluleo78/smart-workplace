// 노트 공유 링크 화면 — 외부 보기(로그인 없음)·받는 사람 공유 화면의 실패 갈래·알림 입구(/wiki/open/:pageId) 화면 테스트(WP-971, WP-995, WP-983).
// 외부 보기의 응답 → 화면(트리·본문·가린 멘션·링크), 하위 이동의 ?pageId 질의, 만료·하위만 닫힘·해제·일시 오류·로그인 필요(401) 안내,
// 받는 사람 화면의 외부 보기 전환(409 PUBLIC)·일시 실패(5xx)·접근 요청, 알림 입구의 갈 곳 판정은 브라우저 없이 판정되므로
// wiki-share-public · wiki-share-view 에서 옮겼다. 공유 창의 「사람·팀 추가」(WP-1023 — 사람·조직도 부서·내 그룹 검색과 저장 payload)도 여기서 본다. 이미지 실제 로드·전체 폭 기하·robots.txt·동기화 서버 연결·워크스페이스 전환 새로고침은 E2E 에 남는다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { useState } from 'react'
import { Route, Routes, useParams } from 'react-router-dom'
import { describe, expect, test } from 'vitest'

import { WikiShareDialog } from '@/components/wiki/WikiShareDialog'
import { WikiSharePublicViewContext } from '@/components/wiki/wikiSharePublicView'
import { attachSilentCollab,editorSideHandlers } from '@/test/kits/wiki/testkit-b3-msw'
import { renderScreen, type ScreenUser } from '@/test/renderScreen'
import type { UserGroupDetail, UserGroupNode, UserGroupTree } from '@/types/userGroup'
import type {
  WikiPageShare,
  WikiPageShareRequest,
  WikiPublicShare,
  WikiShareAccessRequestResult,
  WikiShareResolved,
} from '@/types/wiki'

import { createMember } from '../../../e2e/factories/auth.factory'
import { wikiPageDetail, wikiPageSummary } from '../../../e2e/factories/wiki.factory'
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

// ── 공유 창 「사람·팀 추가」(WP-1023) ─────────────────────────────────────
// 사람·조직도 부서·내 그룹을 한 검색에서 섹션으로 고르고, 부서는 부서 행으로(groupIds), 내 그룹은 지금 사람 구성원을 지정한 사람으로 펼쳐(userIds)
// 저장한다. 실제 공유 창(WikiShareDialog)을 MSW 로 띄워 검색 질의·PUT payload·응답 → 화면(부서 행·토스트)을 본다.

const SHARE_PAGE = 5
const PEOPLE_NAMES: Record<number, string> = { 3: '박서준', 7: '김민지', 8: '이도윤' }
/** 조직도(SHARED) 부서 이름·사람 수 — PUT 응답의 groups 를 만든다. 백엔드(12)는 개발팀(10)의 하위 부서. */
const DEPTS: Record<number, { name: string; memberCount: number }> = {
  10: { name: '개발팀', memberCount: 3 },
  12: { name: '백엔드', memberCount: 1 },
  20: { name: '디자인팀', memberCount: 2 },
}
const GROUP_TREE: UserGroupTree = {
  shared: [
    groupNode(10, '개발팀', 'SHARED', [groupNode(12, '백엔드', 'SHARED')]),
    groupNode(20, '디자인팀', 'SHARED'),
  ],
  // 내 그룹 — 개발 스터디(30) 아래에 하위 그룹 스터디-A(31).
  personal: [groupNode(30, '개발 스터디', 'PERSONAL', [groupNode(31, '스터디-A', 'PERSONAL')])],
}

function groupNode(id: number, name: string, visibility: UserGroupNode['visibility'], children: UserGroupNode[] = []): UserGroupNode {
  return { id, code: null, name, parentId: null, ownerId: visibility === 'PERSONAL' ? 1 : null, visibility, sortOrder: 0, children }
}

/** 요청 → 서버가 저장해 돌려줄 공유(사람 이름·부서 이름과 사람 수를 채운다). groupIds 를 보내지 않으면 지금 부서를 그대로 둔다(서버와 같은 규칙). */
function savedShare(req: WikiPageShareRequest, prev: WikiPageShare): WikiPageShare {
  const groupIds = req.groupIds ?? prev.groups.map((g) => g.groupId)
  return {
    ...prev,
    audience: req.audience,
    permission: req.permission,
    people: req.userIds.map((userId) => ({ userId, name: PEOPLE_NAMES[userId] ?? `사용자${userId}` })),
    groups: groupIds.map((groupId) => ({ groupId, ...DEPTS[groupId] })),
  }
}

/**
 * 지정한 사람 공유 하나를 가진 공유 창을 띄운다 — 받은 PUT 본문과 사람 검색어를 모은다. groupMembers 는 그룹 id 별 상세의 구성원(없으면 빈 목록),
 * detailGate 를 주면 그룹 상세 응답이 그 약속이 풀릴 때까지 기다린다(구성원을 받는 사이의 다른 추가를 재현). firstPutGate 를 주면 첫 PUT 이
 * 본문을 받은 뒤 그 약속이 풀릴 때까지 응답하지 않는다(저장이 끝나기 전에 잇달아 더하기를 재현).
 */
function openShareDialog(
  initial: Partial<WikiPageShare> = {},
  groupMembers: Record<number, UserGroupDetail['members']> = {},
  detailGate?: Promise<void>,
  firstPutGate?: Promise<void>,
) {
  const puts: WikiPageShareRequest[] = []
  const searches: string[] = []
  let current: WikiPageShare = {
    pageId: SHARE_PAGE, token: 'wsh_dialog', audience: 'PEOPLE', permission: 'VIEW', includeChildren: false,
    people: [{ userId: 3, name: '박서준' }], groups: [], createdBy: { userId: 1, name: '나' },
    createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z', expiresAt: null, lastAccessedAt: null, viewCount: 0,
    ...initial,
  }
  const view = renderScreen(
    <WikiShareDialog open onOpenChange={() => {}} pageId={SHARE_PAGE} spaceId={1} pageTitle="로드맵" childCount={0} onOpenPage={() => {}} />,
    {
      handlers: [
        http.get(`/api/v1/wiki/pages/${SHARE_PAGE}/share`, () =>
          HttpResponse.json({ share: current, externalShareEnabled: true, inheritedFrom: null, accessRequests: [], excludedFromParent: false, excludedPages: [] }),
        ),
        http.put(`/api/v1/wiki/pages/${SHARE_PAGE}/share`, async ({ request }) => {
          const body = (await request.json()) as WikiPageShareRequest
          puts.push(body)
          if (firstPutGate && puts.length === 1) await firstPutGate
          current = savedShare(body, current)
          return HttpResponse.json(current)
        }),
        http.get('/api/v1/members', ({ request }) => {
          const search = new URL(request.url).searchParams.get('search') ?? ''
          searches.push(search)
          // 「김」으로 찾으면 김민지(7), 검색어가 없으면 모두, 그 밖엔 없음. 1(나 — 로그인 사용자)은 후보에서 빠져야 한다(WP-1048).
          const all = [
            createMember({ userId: 1, username: 'me', name: '나' }),
            createMember({ userId: 7, username: 'minji', name: '김민지', department: '프론트엔드팀' }),
            createMember({ userId: 8, username: 'doyun', name: '이도윤' }),
          ]
          const content = search === '' ? all : all.filter((m) => m.name.includes(search))
          return HttpResponse.json({ content, page: 0, size: 20, totalElements: content.length, totalPages: 1 })
        }),
        http.get('/api/v1/user-groups', () => HttpResponse.json(GROUP_TREE)),
        // 하위 조직 포함 구성원(빈 검색어) — 공유 창 부서 행의 ▾(WP-1048). groupMembers 의 직속 구성원에 경로 없이 답한다.
        http.get('/api/v1/user-groups/:id/members/search', ({ params }) => {
          const id = Number(params.id)
          return HttpResponse.json((groupMembers[id] ?? []).map((m) => ({ groupId: id, groupPath: [], ...m })))
        }),
        http.get('/api/v1/user-groups/:id', async ({ params }) => {
          const id = Number(params.id)
          if (detailGate) await detailGate
          return HttpResponse.json({ ...groupNode(id, `그룹${id}`, 'PERSONAL'), members: groupMembers[id] ?? [] } satisfies UserGroupDetail)
        }),
      ],
    },
  )
  return { ...view, puts, searches }
}

const memberRow = (targetId: number, targetType: 'MEMBER' | 'EXTERNAL' = 'MEMBER') => ({
  targetType, targetId, name: `m${targetId}`, email: null, title: null, organization: null,
})

/** 「사람·팀 추가」를 열고 검색창을 돌려준다. */
async function openPicker(user: ScreenUser) {
  await user.click(await screen.findByTestId('wiki-share-add-person'))
  // 팝오버는 모달 대화상자 밖(포털)에 그려져 접근성 트리에서 aria-hidden 으로 보일 수 있어 이름표로 찾는다.
  return screen.findByLabelText('사람·팀 검색')
}

describe('노트 공유 창 — 사람·팀 추가(WP-1023)', () => {
  test('검색은 사람·조직도·내 그룹을 섹션으로 보이고, 검색어로 사람은 서버에 묻고 그룹은 이름·상위 부서로 거른다', async () => {
    const { user, searches } = openShareDialog()
    const input = await openPicker(user)
    const departments = await screen.findByTestId('share-target-departments')
    expect(within(departments).getByText('조직도', { selector: '[cmdk-group-heading]' })).toBeInTheDocument()
    expect(within(screen.getByTestId('share-target-personal-groups')).getByText('내 그룹', { selector: '[cmdk-group-heading]' })).toBeInTheDocument()
    expect(within(await screen.findByTestId('share-target-people')).getByText('사람', { selector: '[cmdk-group-heading]' })).toBeInTheDocument()

    await user.type(input, '김')
    await waitFor(() => expect(searches).toContain('김'))
    expect(await screen.findByTestId('share-target-person-7')).toHaveTextContent('김민지')
    await waitFor(() => expect(screen.queryByTestId('share-target-person-8')).not.toBeInTheDocument())
    // 「김」에 맞는 그룹이 없어 그룹 섹션은 그리지 않는다.
    expect(screen.queryByTestId('share-target-departments')).not.toBeInTheDocument()
    expect(screen.queryByTestId('share-target-personal-groups')).not.toBeInTheDocument()

    // 「개발」 — 개발팀·그 하위 백엔드(경로로)·내 그룹 개발 스터디가 남고 디자인팀은 빠진다.
    await user.clear(input)
    await user.type(input, '개발')
    expect(await screen.findByTestId('share-target-department-10')).toBeInTheDocument()
    expect(screen.getByTestId('share-target-department-12')).toBeInTheDocument()
    expect(screen.queryByTestId('share-target-department-20')).not.toBeInTheDocument()
    expect(screen.getByTestId('share-target-personal-group-30')).toBeInTheDocument()
  })

  test('조직도 부서를 고르면 groupIds 에 더해 저장하고(사람은 그대로) 부서 행을 「이름 · N명」으로 보인다 — 키보드(Enter)로도 고른다', async () => {
    const { user, puts } = openShareDialog()
    const input = await openPicker(user)
    await user.type(input, '디자인')
    await screen.findByTestId('share-target-department-20')
    await waitFor(() => expect(screen.queryByTestId('share-target-department-10')).not.toBeInTheDocument())
    // 사람 검색(debounce 뒤 서버 질의)이 「디자인」에 맞는 사람이 없다고 답해 사람 섹션이 사라져도, 선택은 남은 첫 후보(디자인팀)로 옮겨 Enter 로 바로 고른다.
    await waitFor(() => expect(screen.queryByTestId('share-target-people')).not.toBeInTheDocument())
    await user.keyboard('{Enter}')

    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toMatchObject({ audience: 'PEOPLE', userIds: [3], groupIds: [20], notify: { message: null } })
    expect(await screen.findByTestId('wiki-share-group-20')).toHaveTextContent('디자인팀 · 2명')
    // 이미 지정한 부서는 검색에서 고를 수 없다.
    await user.clear(input)
    await user.type(input, '디자인')
    expect(await screen.findByTestId('share-target-department-20')).toHaveAttribute('aria-disabled', 'true')
  })

  test('내 그룹을 고르면 사람 구성원만 지정한 사람으로 펼쳐(이미 있는 사람 제외) 저장하고 몇 명을 더했는지 알린다 — 부서 행은 남지 않는다', async () => {
    const { user, puts } = openShareDialog({ groups: [{ groupId: 10, name: '개발팀', memberCount: 3 }] }, {
      30: [memberRow(3), memberRow(7), memberRow(8), memberRow(99, 'EXTERNAL')],
    })
    await openPicker(user)
    await user.click(await screen.findByTestId('share-target-personal-group-30'))

    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].userIds).toEqual([3, 7, 8])
    // 부서는 지금 값 그대로 보낸다 — 내 그룹은 대상으로 남지 않는다.
    expect(puts[0].groupIds).toEqual([10])
    expect(await screen.findByText('개발 스터디에서 2명 추가 (이미 있는 1명 제외)')).toBeInTheDocument()
    const people = screen.getByTestId('wiki-share-people')
    expect(within(people).getByText('김민지')).toBeInTheDocument()
    expect(within(people).getByText('이도윤')).toBeInTheDocument()
    expect(within(people).queryByText(/개발 스터디/)).not.toBeInTheDocument()
  })

  test('내 그룹의 사람이 모두 이미 있으면 저장하지 않고 알린다', async () => {
    const { user, puts } = openShareDialog({}, { 30: [memberRow(3)] })
    await openPicker(user)
    await user.click(await screen.findByTestId('share-target-personal-group-30'))
    expect(await screen.findByText('개발 스터디의 1명은 이미 모두 있습니다')).toBeInTheDocument()
    expect(puts).toHaveLength(0)
  })

  test('부서 행의 빼기를 누르면 그 부서만 빼고(사람은 그대로) 저장하며 행이 사라진다', async () => {
    const { user, puts } = openShareDialog({
      groups: [{ groupId: 10, name: '개발팀', memberCount: 3 }, { groupId: 20, name: '디자인팀', memberCount: 2 }],
    })
    expect(await screen.findByTestId('wiki-share-group-10')).toHaveTextContent('개발팀 · 3명')
    await user.click(screen.getByRole('button', { name: '개발팀 빼기' }))

    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toMatchObject({ userIds: [3], groupIds: [20] })
    expect(puts[0].notify).toBeUndefined()
    await waitFor(() => expect(screen.queryByTestId('wiki-share-group-10')).not.toBeInTheDocument())
    expect(screen.getByTestId('wiki-share-group-20')).toBeInTheDocument()
  })

  test('내 그룹은 하위 그룹도 경로와 함께 보이고, 고르면 하위 그룹 구성원까지 펼쳐 중복 없이 더한다', async () => {
    const { user, puts } = openShareDialog({}, { 30: [memberRow(7)], 31: [memberRow(7), memberRow(8)] })
    const input = await openPicker(user)
    // 검색으로 찾은 하위 그룹은 상위 경로와 함께 보인다.
    await user.type(input, '스터디')
    const sub = await screen.findByTestId('share-target-personal-group-31')
    expect(sub).toHaveTextContent('스터디-A')
    expect(sub).toHaveTextContent('개발 스터디')
    await user.click(screen.getByTestId('share-target-personal-group-30'))

    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].userIds).toEqual([3, 7, 8])
    expect(await screen.findByText('개발 스터디에서 2명 추가')).toBeInTheDocument()
  })

  test('내 그룹을 펼칠 때 공유하는 나와 공유를 만든 사람은 더하지도 세지도 않는다', async () => {
    // 로그인 사용자는 1(renderScreen 기본), 공유를 만든 사람은 2.
    const { user, puts } = openShareDialog({ createdBy: { userId: 2, name: '최공유' } }, {
      30: [memberRow(1), memberRow(2), memberRow(3), memberRow(8)],
    })
    await openPicker(user)
    await user.click(await screen.findByTestId('share-target-personal-group-30'))

    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].userIds).toEqual([3, 8])
    expect(await screen.findByText('개발 스터디에서 1명 추가 (이미 있는 1명 제외)')).toBeInTheDocument()
  })

  test('내 그룹 구성원을 받는 사이 사람을 더해도, 펼친 저장은 그 사람을 지우지 않고 함께 보낸다', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { user, puts } = openShareDialog({}, { 30: [memberRow(8)] }, gate)
    await openPicker(user)
    await user.click(await screen.findByTestId('share-target-personal-group-30'))
    // 구성원 응답이 오기 전에 김민지(7)를 더한다.
    await user.click(await screen.findByTestId('share-target-person-7'))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].userIds).toEqual([3, 7])

    act(() => release())
    await waitFor(() => expect(puts).toHaveLength(2))
    expect(puts[1].userIds).toEqual([3, 7, 8])
    const people = screen.getByTestId('wiki-share-people')
    await waitFor(() => expect(within(people).getByText('이도윤')).toBeInTheDocument())
    expect(within(people).getByText('김민지')).toBeInTheDocument()
  })

  test('첫 부서의 저장이 끝나기 전에 다른 부서를 고르면, 두 번째 저장은 첫 저장이 끝난 뒤 두 부서를 함께 보낸다(먼저 고른 부서가 지워지지 않는다)', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { user, puts } = openShareDialog({}, {}, undefined, gate)
    await openPicker(user)
    await user.click(await screen.findByTestId('share-target-department-10'))
    await waitFor(() => expect(puts).toHaveLength(1))
    // 첫 PUT 이 응답하기 전에 디자인팀(20)을 고른다 — 앞 저장이 끝날 때까지 보내지 않는다.
    await user.click(screen.getByTestId('share-target-department-20'))
    expect(puts).toHaveLength(1)

    act(() => release())
    await waitFor(() => expect(puts).toHaveLength(2))
    expect(puts[0].groupIds).toEqual([10])
    expect(puts[1].groupIds).toEqual([10, 20])
    expect(puts[1].userIds).toEqual([3])
    expect(await screen.findByTestId('wiki-share-group-20')).toBeInTheDocument()
    expect(screen.getByTestId('wiki-share-group-10')).toBeInTheDocument()
  })

  test('사람을 더한 저장이 끝나기 전에 다른 사람을 더해도 두 사람이 모두 남는다', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { user, puts } = openShareDialog({}, {}, undefined, gate)
    await openPicker(user)
    await user.click(await screen.findByTestId('share-target-person-7'))
    await waitFor(() => expect(puts).toHaveLength(1))
    await user.click(screen.getByTestId('share-target-person-8'))

    act(() => release())
    await waitFor(() => expect(puts).toHaveLength(2))
    expect(puts[0].userIds).toEqual([3, 7])
    expect(puts[1].userIds).toEqual([3, 7, 8])
    const people = screen.getByTestId('wiki-share-people')
    await waitFor(() => expect(within(people).getByText('이도윤')).toBeInTheDocument())
    expect(within(people).getByText('김민지')).toBeInTheDocument()
  })

  test('내 그룹을 펼친 저장이 끝나기 전에 사람을 더해도, 펼쳐 넣은 사람이 지워지지 않는다', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { user, puts } = openShareDialog({}, { 30: [memberRow(8)] }, undefined, gate)
    await openPicker(user)
    await user.click(await screen.findByTestId('share-target-personal-group-30'))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].userIds).toEqual([3, 8])
    // 펼친 저장(PUT)이 응답하기 전에 김민지(7)를 더한다.
    await user.click(screen.getByTestId('share-target-person-7'))

    act(() => release())
    await waitFor(() => expect(puts).toHaveLength(2))
    expect(puts[1].userIds).toEqual([3, 8, 7])
    const people = screen.getByTestId('wiki-share-people')
    await waitFor(() => expect(within(people).getByText('김민지')).toBeInTheDocument())
    expect(within(people).getByText('이도윤')).toBeInTheDocument()
  })

  test('상위 부서가 이미 대상이면 그 하위 부서는 고를 수 없고 「상위 부서에 포함됨」으로 보인다', async () => {
    const { user } = openShareDialog({ groups: [{ groupId: 10, name: '개발팀', memberCount: 3 }] })
    await openPicker(user)
    await user.click(await screen.findByTestId('share-target-expand-10'))
    const backend = await screen.findByTestId('share-target-department-12')
    expect(backend).toHaveAttribute('aria-disabled', 'true')
    expect(backend).toHaveTextContent('상위 부서에 포함됨')
    expect(screen.getByTestId('share-target-department-10')).toHaveTextContent('(이미 추가됨)')
    // 다른 부서는 그대로 고를 수 있다.
    expect(screen.getByTestId('share-target-department-20')).not.toHaveAttribute('aria-disabled', 'true')
  })
})

// ── 공유 대상 고르기 개선(WP-1048) ─────────────────────────────────────
// 종류 탭·조직 펼치기·나 빼기·소속 부서·검색어 없을 때 조직도 먼저, 공유 창 부서 행의 구성원 펼치기.
describe('노트 공유 창 — 공유 대상 고르기(WP-1048)', () => {
  test('검색어가 없으면 조직도가 사람보다 먼저이고, 나는 사람 후보에 없으며, 사람 행에 소속 부서(없으면 아이디)를 보인다', async () => {
    const { user } = openShareDialog()
    await openPicker(user)
    const people = await screen.findByTestId('share-target-people')
    const departments = screen.getByTestId('share-target-departments')
    // 조직도 → 내 그룹 → 사람 순(문서 순서).
    expect(departments.compareDocumentPosition(people) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('share-target-personal-groups').compareDocumentPosition(people) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 최상위 조직만 보이고 하위 부서는 펼쳐야 보인다.
    expect(screen.getByTestId('share-target-department-10')).toBeInTheDocument()
    expect(screen.queryByTestId('share-target-department-12')).not.toBeInTheDocument()
    expect(screen.getByTestId('share-target-department-10')).toHaveTextContent('조직')
    expect(screen.getByTestId('share-target-personal-group-30')).toHaveTextContent('내 그룹')
    // 공유하는 나(1)는 빠지고, 김민지는 부서, 이도윤은 부서가 없어 아이디.
    expect(screen.queryByTestId('share-target-person-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('share-target-person-7')).toHaveTextContent('프론트엔드팀')
    expect(screen.getByTestId('share-target-person-8')).toHaveTextContent('@doyun')
  })

  test('종류 탭은 후보 수를 보이고, 누른 종류만 남긴다', async () => {
    const { user } = openShareDialog()
    await openPicker(user)
    await screen.findByTestId('share-target-people')
    // 사람은 서버 총원 3에서 나를 뺀 2, 조직은 하위 포함 3, 내 그룹은 하위 포함 2.
    expect(screen.getByTestId('share-target-tab-people')).toHaveTextContent('사람2')
    expect(screen.getByTestId('share-target-tab-departments')).toHaveTextContent('조직3')
    expect(screen.getByTestId('share-target-tab-groups')).toHaveTextContent('내 그룹2')

    await user.click(screen.getByTestId('share-target-tab-departments'))
    expect(screen.getByTestId('share-target-tab-departments')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('share-target-departments')).toBeInTheDocument()
    expect(screen.queryByTestId('share-target-people')).not.toBeInTheDocument()
    expect(screen.queryByTestId('share-target-personal-groups')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('share-target-tab-people'))
    expect(screen.getByTestId('share-target-people')).toBeInTheDocument()
    expect(screen.queryByTestId('share-target-departments')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('share-target-tab-all'))
    expect(screen.getByTestId('share-target-departments')).toBeInTheDocument()
    expect(screen.getByTestId('share-target-people')).toBeInTheDocument()
  })

  test('조직의 ▸ 는 조직을 더하지 않고 하위 부서·직속 구성원을 펼치며, 구성원 행을 고르면 그 사람만 더한다', async () => {
    const { user, puts } = openShareDialog({}, { 10: [memberRow(1), memberRow(7), memberRow(99, 'EXTERNAL')] })
    await openPicker(user)
    await user.click(await screen.findByTestId('share-target-expand-10'))
    expect(await screen.findByTestId('share-target-department-12')).toBeInTheDocument()
    expect(await screen.findByTestId('share-target-member-10-7')).toHaveTextContent('사람만 추가')
    // 나(1)와 외부 연락처(99)는 펼친 구성원에도 없다.
    expect(screen.queryByTestId('share-target-member-10-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('share-target-member-10-99')).not.toBeInTheDocument()
    expect(puts).toHaveLength(0)

    await user.click(screen.getByTestId('share-target-member-10-7'))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toMatchObject({ userIds: [3, 7] })
    expect(puts[0].groupIds ?? []).toEqual([])
    // 다시 누르면 접힌다.
    await user.click(screen.getByTestId('share-target-expand-10'))
    await waitFor(() => expect(screen.queryByTestId('share-target-department-12')).not.toBeInTheDocument())
  })

  test('펼친 조직을 더하면 그 구성원 행은 「조직에 포함됨」으로 고를 수 없다', async () => {
    const { user, puts } = openShareDialog({}, { 10: [memberRow(8)] })
    await openPicker(user)
    await user.click(await screen.findByTestId('share-target-expand-10'))
    expect(await screen.findByTestId('share-target-member-10-8')).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByTestId('share-target-department-10'))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].groupIds).toEqual([10])
    const member = await screen.findByTestId('share-target-member-10-8')
    await waitFor(() => expect(member).toHaveAttribute('aria-disabled', 'true'))
    expect(member).toHaveTextContent('조직에 포함됨')
  })

  test('→ 는 고른 조직을 펼치고 ← 는 접는다(검색창에서 손을 떼지 않고)', async () => {
    const { user } = openShareDialog()
    const input = await openPicker(user)
    await screen.findByTestId('share-target-department-10')
    input.focus()
    // 검색어가 없으면 첫 후보는 맨 위 조직(개발팀).
    await user.keyboard('{ArrowRight}')
    expect(await screen.findByTestId('share-target-department-12')).toBeInTheDocument()
    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(screen.queryByTestId('share-target-department-12')).not.toBeInTheDocument())
  })

  test('← 는 구성원 줄에서 그 조직을 접고, 상위를 접으면 펼쳐 둔 하위도 함께 접힌다', async () => {
    const { user } = openShareDialog({}, { 10: [memberRow(7)], 12: [memberRow(8)] })
    const input = await openPicker(user)
    await user.click(await screen.findByTestId('share-target-expand-10'))
    await user.click(await screen.findByTestId('share-target-expand-12'))
    expect(await screen.findByTestId('share-target-member-12-8')).toBeInTheDocument()
    // 상위(10)를 접었다 다시 펼치면 하위(12)는 접힌 채다.
    await user.click(screen.getByTestId('share-target-expand-10'))
    await user.click(screen.getByTestId('share-target-expand-10'))
    expect(await screen.findByTestId('share-target-member-10-7')).toBeInTheDocument()
    expect(screen.queryByTestId('share-target-member-12-8')).not.toBeInTheDocument()

    // 구성원 줄로 내려가 ← 를 누르면 그 조직(10)이 접힌다.
    input.focus()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    await waitFor(() => expect(screen.getByTestId('share-target-member-10-7')).toHaveAttribute('aria-selected', 'true'))
    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(screen.queryByTestId('share-target-member-10-7')).not.toBeInTheDocument())
  })

  test('검색어 안에서 글자 커서를 옮기는 ← → 는 가로채지 않는다', async () => {
    const { user } = openShareDialog()
    const input = (await openPicker(user)) as HTMLInputElement
    await user.type(input, '개발')
    await user.click(await screen.findByTestId('share-target-expand-10'))
    expect(await screen.findByTestId('share-target-department-12')).toBeInTheDocument()
    input.focus()
    input.setSelectionRange(2, 2)
    // 커서가 끝이 아니면 ← 는 글자 커서만 옮긴다 — 펼친 개발팀은 그대로.
    await user.keyboard('{ArrowLeft}')
    expect(input.selectionStart).toBe(1)
    expect(screen.getByTestId('share-target-department-12')).toBeInTheDocument()
    // 커서가 처음이 아니면 → 도 가로채지 않는다(접힌 그룹이 고른 줄이어도).
    await user.keyboard('{ArrowRight}')
    expect(input.selectionStart).toBe(2)
  })

  test('검색어를 치고 사람 검색이 오기 전에 Enter 를 눌러도 이전 사람 목록의 사람이 아니라 지금 검색어에 맞는 조직을 더한다', async () => {
    const { user, puts } = openShareDialog()
    const input = await openPicker(user)
    // 빈 검색어의 사람 목록(김민지·이도윤)이 보인 뒤.
    await screen.findByTestId('share-target-person-7')
    await user.type(input, '개발{Enter}')
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toMatchObject({ userIds: [3], groupIds: [10] })
  })

  test('지금 검색어에 맞는 조직이 이미 추가돼 고를 것이 없으면, 사람 검색이 오기 전 Enter 는 아무도 더하지 않는다', async () => {
    const { user, puts } = openShareDialog({ groups: [{ groupId: 10, name: '개발팀', memberCount: 3 }] })
    const input = await openPicker(user)
    await screen.findByTestId('share-target-person-7')
    await user.type(input, '백엔드')
    // 「백엔드」는 상위 개발팀이 이미 대상이라 고를 수 없고, 이전 검색어의 사람 줄은 비활성이다.
    expect(screen.getByTestId('share-target-person-7')).toHaveAttribute('aria-disabled', 'true')
    await user.keyboard('{Enter}')
    // 사람 검색(「백엔드」 — 맞는 사람 없음)이 와서 이전 사람 줄이 사라질 때까지 아무것도 더하지 않는다.
    await waitFor(() => expect(screen.queryByTestId('share-target-person-7')).not.toBeInTheDocument())
    expect(puts).toHaveLength(0)
    expect(input).toHaveValue('백엔드')
  })

  test('← 로 접으면 선택은 접은 그룹에 남고, 검색으로 평평하게 보이는 하위 그룹에서는 ← 를 가로채지 않는다', async () => {
    const { user } = openShareDialog({}, { 20: [memberRow(8)] })
    const input = (await openPicker(user)) as HTMLInputElement
    await screen.findByTestId('share-target-department-20')
    input.focus()
    // 디자인팀(둘째 조직)으로 내려가 펼치고, 구성원 줄에서 ← 로 접는다.
    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect(screen.getByTestId('share-target-department-20')).toHaveAttribute('aria-selected', 'true'))
    await user.keyboard('{ArrowRight}')
    await screen.findByTestId('share-target-member-20-8')
    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect(screen.getByTestId('share-target-member-20-8')).toHaveAttribute('aria-selected', 'true'))
    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(screen.queryByTestId('share-target-member-20-8')).not.toBeInTheDocument())
    expect(screen.getByTestId('share-target-department-20')).toHaveAttribute('aria-selected', 'true')

    // 「백엔드」로 찾으면 하위 부서만 보인다 — 상위(개발팀)가 펼쳐져 있지 않아 ← 는 글자 커서용으로 둔다.
    await user.type(input, '백엔드')
    await waitFor(() => expect(screen.getByTestId('share-target-department-12')).toHaveAttribute('aria-selected', 'true'))
    input.setSelectionRange(0, 0)
    expect(fireEvent.keyDown(input, { key: 'ArrowLeft' })).toBe(true)
  })

  test('닫았다 다시 열면 탭·펼침이 처음으로 돌아간다', async () => {
    const { user } = openShareDialog()
    await openPicker(user)
    await user.click(await screen.findByTestId('share-target-expand-10'))
    await screen.findByTestId('share-target-department-12')
    await user.click(screen.getByTestId('share-target-tab-departments'))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('share-target-search')).not.toBeInTheDocument())

    await openPicker(user)
    expect(await screen.findByTestId('share-target-tab-all')).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByTestId('share-target-department-10')).toBeInTheDocument()
    expect(screen.queryByTestId('share-target-department-12')).not.toBeInTheDocument()
  })

  test('공유 창 ▾ 의 하위 부서 사람은 펼친 부서 이름을 빼고 그 아래 소속만 보인다', async () => {
    const sub = { ...memberRow(9), name: '웹파트 사람', groupPath: ['개발팀', '백엔드'] } as UserGroupDetail['members'][number]
    const { user } = openShareDialog({ groups: [{ groupId: 10, name: '개발팀', memberCount: 2 }] }, { 10: [memberRow(7), sub] })
    await user.click(await screen.findByTestId('wiki-share-group-toggle-10'))
    const members = await screen.findByTestId('wiki-share-group-members-10')
    const row = (await within(members).findByText('웹파트 사람')).closest('li')!
    expect(row).toHaveTextContent('백엔드')
    expect(row).not.toHaveTextContent('개발팀')
    // 직속 구성원은 경로 없이 이름만.
    expect(within(members).getByText('m7').closest('li')).toHaveTextContent(/^m7$/)
  })

  test('공유 창의 부서 행 ▾ 는 하위 부서까지 지금 구성원(사람만)을 펼쳐 보인다', async () => {
    const { user, puts } = openShareDialog(
      { groups: [{ groupId: 10, name: '개발팀', memberCount: 1 }] },
      { 10: [memberRow(7), memberRow(99, 'EXTERNAL')] },
    )
    const toggle = await screen.findByTestId('wiki-share-group-toggle-10')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    const members = await screen.findByTestId('wiki-share-group-members-10')
    expect(await within(members).findByText('m7')).toBeInTheDocument()
    expect(within(members).queryByText('m99')).not.toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    // 펼쳐 보기만 한다 — 저장하지 않는다.
    expect(puts).toHaveLength(0)
    await user.click(toggle)
    await waitFor(() => expect(screen.queryByTestId('wiki-share-group-members-10')).not.toBeInTheDocument())
  })
})
