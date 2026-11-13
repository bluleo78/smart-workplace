// @vitest-environment jsdom
// happy-dom(화면 테스트 기본, WP-1002)과 날짜 칸·글자 수 제한·포커스 이동 처리가 달라 이 파일은 jsdom 에서 돈다.
// 드라이브 공유 링크 — 공유 창(ShareLinkModal)과 공개 받기 화면(/s/:token, ShareLinkPage) 화면 컴포넌트 테스트(WP-971, WP-984).
// 생성 payload·랜딩 URL·생성 직후 자동 복사·기존 링크 다시 복사·폐기 반영(WP-1528), 닫기/취소 라벨, 만료일·비밀번호 유효성(요청 차단), 만료일 표시 형식,
// 받기 화면의 안내·홈 링크는 브라우저 없이 판정되므로 e2e/pages/drive/drive-share-link.spec.ts 에서 옮겼다.
// WP-1227: 공유 링크 화면(정보 → 파일 카드·비밀번호/사내 잠금·열람 토큰·드라이브에서 열기·미리보기 뷰어).
// 인증 없이 /s/:token 에 들어가도 받기 화면이 뜨는 라우트 배선(@wiring)은 그 E2E 가 지킨다. 보관 공간 분기는 ShareLinkModal.test.tsx.
// 공유 창은 파일 행 버튼이 여는 대화상자만, 받기 화면은 /s/:token 라우트 하나만 renderScreen 으로 띄운다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'

import { ShareLinkModal } from '@/components/drive/ShareLinkModal'
import { driveKeys } from '@/hooks/queries/driveKeys'
import ShareLinkPage from '@/pages/drive/ShareLinkPage'
import { renderScreen } from '@/test/renderScreen'
import type { ShareLink } from '@/types/drive'

const FILE_ID = 10
const LINKS = `/api/v1/drive/files/${FILE_ID}/share-links`

const link = (over: Partial<ShareLink> = {}): ShareLink => ({
  id: 5,
  audience: 'EXTERNAL',
  hasPassword: false,
  expiresAt: null,
  revoked: false,
  active: true,
  createdAt: '2026-06-21T00:00:00Z',
  createdBy: 1,
  token: 'sl_abc',
  createdByName: '양동희',
  ...over,
})

/** 공유 창을 띄운다 — 목록 GET 은 list(), POST 는 받은 본문을 posts 에 쌓고 created(목록과 같은 모양의 생성 응답, WP-1528)를 돌려준다. */
function renderModal({ list = (): ShareLink[] => [], handlers = [] as RequestHandler[], created }: { list?: () => ShareLink[]; handlers?: RequestHandler[]; created?: ShareLink } = {}) {
  const posts: Record<string, unknown>[] = []
  let closed = 0
  const view = renderScreen(<ShareLinkModal target={{ kind: 'file', id: FILE_ID, name: 'report.txt' }} onClose={() => closed++} />, {
    path: `/drive/spaces/1`,
    handlers: [
      ...handlers,
      http.get(LINKS, () => HttpResponse.json(list())),
      http.post(LINKS, async ({ request }) => {
        posts.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json(created ?? {}, { status: 201 })
      }),
    ],
  })
  return { ...view, posts, closed: () => closed }
}

describe('공유 창', () => {
  // WP-1528: 기존 링크가 있으면 「+ 새 링크 만들기」로 폼을 펼친다 → POST audience(기본 외부) → 폼이 닫히고 새 링크가 목록 맨 위에
  // 강조되어 나타나며, 랜딩(/s/) URL 이 바로 클립보드에 들어가고 「링크를 만들고 복사했습니다」 토스트가 뜬다.
  test('새 링크를 만들면 폼이 닫히고 맨 위에 강조되며 URL 이 바로 복사된다', async () => {
    let listed: ShareLink[] = [link({ id: 5, token: 'sl_old' })]
    const { user, posts } = renderModal({
      list: () => listed,
      created: link({ id: 9, token: 'sl_new', createdByName: 'Tester' }),
    })
    await screen.findByTestId('share-link-item')
    expect(screen.queryByTestId('share-link-form')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('share-link-new-btn'))
    expect(document.getElementById('share-audience-external')).toBeChecked()
    listed = [link({ id: 9, token: 'sl_new', createdByName: 'Tester' }), link({ id: 5, token: 'sl_old' })]
    await user.click(screen.getByTestId('share-link-create-btn'))

    await waitFor(() => expect(screen.queryByTestId('share-link-form')).not.toBeInTheDocument())
    expect(posts[0].audience).toBe('EXTERNAL')
    const first = screen.getAllByTestId('share-link-item')[0]
    expect(first).toHaveAttribute('data-highlighted', 'true')
    const url = within(first).getByRole('textbox', { name: '공유 링크 URL' }) as HTMLInputElement
    expect(url.value).toBe(`${window.location.origin}/s/sl_new`)
    expect(url.value).not.toContain('/api/v1/public/drive/share/')
    expect(screen.getAllByTestId('share-link-item')[1]).not.toHaveAttribute('data-highlighted', 'true')
    expect(await screen.findByText('링크를 만들고 복사했습니다')).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/s/sl_new`)
    expect(screen.queryByText(/이 URL은 지금만/)).not.toBeInTheDocument()
  })

  // WP-1538: 폴더 대상은 폴더 경로로 목록을 받고 폴더 경로로 POST 한다(기본 만료 30일 뒤가 ISO 로 실린다).
  test('payload posts to folder path', async () => {
    const posts: Record<string, unknown>[] = []
    const FOLDER_LINKS = '/api/v1/drive/folders/20/share-links'
    const { user } = renderScreen(<ShareLinkModal target={{ kind: 'folder', id: 20, name: '견적' }} onClose={() => {}} />, {
      path: `/drive/spaces/1`,
      handlers: [
        http.get(FOLDER_LINKS, () => HttpResponse.json([])),
        http.post(FOLDER_LINKS, async ({ request }) => {
          posts.push((await request.json()) as Record<string, unknown>)
          return HttpResponse.json(link({ id: 9, token: 'sl_f' }), { status: 201 })
        }),
      ],
    })
    await user.click(await screen.findByTestId('share-link-create-btn'))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0].audience).toBe('EXTERNAL')
    expect(typeof posts[0].expiresAt).toBe('string')
  })

  // 생성 뒤 목록 재조회가 실패해도 응답으로 만든 새 링크는 맨 위에 남는다(조용히 무시).
  test('재조회가 실패해도 새 링크가 맨 위에 남는다', async () => {
    let fail = false
    const { user } = renderModal({
      created: link({ id: 9, token: 'sl_new', audience: 'INTERNAL', hasPassword: true, createdByName: 'Tester' }),
      handlers: [
        http.get(LINKS, () => (fail ? new HttpResponse(null, { status: 500 }) : HttpResponse.json([link({ id: 5, token: 'sl_old' })]))),
      ],
    })
    await screen.findByTestId('share-link-item')
    fail = true
    await user.click(screen.getByTestId('share-link-new-btn'))
    await user.click(screen.getByTestId('share-link-create-btn'))
    await waitFor(() => expect(screen.getAllByTestId('share-link-item')).toHaveLength(2))
    const first = screen.getAllByTestId('share-link-item')[0]
    expect(first).toHaveAttribute('data-highlighted', 'true')
    expect((within(first).getByRole('textbox', { name: '공유 링크 URL' }) as HTMLInputElement).value).toMatch(/\/s\/sl_new$/)
    expect(first).toHaveTextContent('사내')
    expect(first).toHaveTextContent('비밀번호')
    expect(first).toHaveTextContent('Tester')
    expect(screen.queryByTestId('share-link-list-error')).not.toBeInTheDocument()
  })

  // 두 번째로 만든 링크로 강조가 옮겨 간다 — 한 번에 하나만 강조.
  test('두 번째 생성은 강조를 새 링크로 옮긴다', async () => {
    let n = 0
    let gets = 0
    // 첫 조회만 성공하고 생성 뒤 재조회는 실패 — 화면이 응답으로 만든 항목만으로 강조를 옮기는지 본다.
    const { user } = renderModal({
      handlers: [
        http.post(LINKS, () => {
          n++
          return HttpResponse.json(link({ id: 10 + n, token: `sl_n${n}` }), { status: 201 })
        }),
        http.get(LINKS, () => (gets++ === 0 ? HttpResponse.json([link({ id: 5, token: 'sl_old' })]) : new HttpResponse(null, { status: 500 }))),
      ],
    })
    await user.click(await screen.findByTestId('share-link-new-btn'))
    await user.click(screen.getByTestId('share-link-create-btn'))
    await waitFor(() => expect(screen.queryByTestId('share-link-form')).not.toBeInTheDocument())
    await user.click(screen.getByTestId('share-link-new-btn'))
    await user.click(screen.getByTestId('share-link-create-btn'))
    await waitFor(() => expect(screen.getAllByTestId('share-link-item')).toHaveLength(3))
    const items = screen.getAllByTestId('share-link-item')
    expect((within(items[0]).getByRole('textbox') as HTMLInputElement).value).toMatch(/sl_n2$/)
    expect((within(items[1]).getByRole('textbox') as HTMLInputElement).value).toMatch(/sl_n1$/)
    expect(items[0]).toHaveAttribute('data-highlighted', 'true')
    expect(items[1]).not.toHaveAttribute('data-highlighted', 'true')
  })

  // 이미 만든 링크의 [복사] — 같은 랜딩 URL 을 다시 복사한다(WP-1528 의 첫 동작).
  test('카드 [복사]는 그 링크의 URL 을 복사하고 안내한다', async () => {
    const { user } = renderModal({ list: () => [link({ token: 'sl_abc' })] })
    await user.click(await screen.findByTestId('share-link-copy-btn'))
    expect(await screen.findByText('링크를 복사했습니다')).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/s/sl_abc`)
  })

  // 폐기 DELETE → 그 카드는 살아 있는 목록에서 빠져 「지난 링크」로 옮겨 가고, 펼치면 「폐기됨」 배지(Badge pill)로 보인다.
  test('폐기하면 그 카드가 지난 링크로 옮겨 간다', async () => {
    let revoked = false
    let deletes = 0
    const { user } = renderModal({
      list: () => [link({ revoked, active: !revoked, token: revoked ? null : 'sl_abc' }), link({ id: 6, token: 'sl_other' })],
      handlers: [
        http.delete('/api/v1/drive/share-links/5', () => {
          deletes++
          revoked = true
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    })
    await waitFor(() => expect(screen.getAllByTestId('share-link-item')).toHaveLength(2))
    await user.click(screen.getAllByTestId('share-link-revoke-btn')[0])
    await waitFor(() => expect(screen.getAllByTestId('share-link-item')).toHaveLength(1))
    expect(deletes).toBe(1)
    const toggle = screen.getByTestId('share-link-past-toggle')
    expect(toggle).toHaveTextContent('지난 링크 1개 (폐기·만료)')
    await user.click(toggle)
    const past = screen.getByTestId('share-link-past-item')
    expect(within(past).getByText('폐기됨')).toHaveClass('inline-flex')
    expect(within(past).queryByTestId('share-link-revoke-btn')).not.toBeInTheDocument()
  })

  // #829: 코너 X 는 「닫기」, 하단 버튼은 「취소」 — 같은 이름이 둘이 아니고, 취소는 닫는다.
  // 링크가 없으면 폼이 바로 펼쳐지고 폼 [취소]는 없어 하단 「취소」 하나만 남는다(WP-1528).
  test('하단 버튼은 「취소」, 코너 X 는 「닫기」이고 취소하면 닫힌다', async () => {
    const { user, closed } = renderModal()
    const modal = await screen.findByTestId('share-link-modal')
    await screen.findByTestId('share-link-form')
    expect(within(modal).getAllByRole('button', { name: '닫기' })).toHaveLength(1)
    const cancel = within(modal).getAllByRole('button', { name: '취소' })
    expect(cancel).toHaveLength(1)
    await user.click(cancel[0])
    expect(closed()).toBe(1)
  })

  // #673: 과거 만료일은 키보드 입력으로 들어와도 생성 시 다시 막는다 — 인라인 오류, 요청 없음, 새 링크 없음.
  // WP-901: 5자리 연도는 과거 가드보다 먼저 서버와 같은 범위 안내로 막고 aria-describedby 로 잇는다.
  test('과거 만료일·범위 밖 연도는 인라인 오류로 생성을 막는다', async () => {
    const { user, posts } = renderModal()
    await screen.findByTestId('share-link-form')
    const expires = document.getElementById('share-expires') as HTMLInputElement
    fireEvent.change(expires, { target: { value: '2020-01-01' } })
    await user.click(screen.getByTestId('share-link-create-btn'))
    expect(await screen.findByTestId('share-expires-error')).toHaveTextContent('오늘 이후')
    expect(screen.queryByTestId('share-link-item')).not.toBeInTheDocument()

    fireEvent.change(expires, { target: { value: '20260-10-23' } })
    await user.click(screen.getByTestId('share-link-create-btn'))
    await waitFor(() => expect(screen.getByTestId('share-expires-error')).toHaveTextContent('날짜는 1900-01-01 ~ 9999-12-31 사이여야 합니다'))
    expect(expires).toHaveAttribute('aria-describedby', 'share-expires-error')
    expect(posts).toHaveLength(0)
    expect(screen.queryByTestId('share-link-item')).not.toBeInTheDocument()
  })

  // WP-497: 비밀번호가 72바이트(bcrypt 한도)를 넘으면 한국어 인라인 오류로 막고, 고치면 오류가 사라져 생성된다.
  test('비밀번호 72바이트 초과는 막고, 한도 안으로 고치면 생성한다', async () => {
    const { user, posts } = renderModal({ created: link({ id: 6, token: 'sl_pw', hasPassword: true }) })
    await screen.findByTestId('share-link-form')
    const pw = document.getElementById('share-password') as HTMLInputElement
    fireEvent.change(pw, { target: { value: '가'.repeat(25) } })
    await user.click(screen.getByTestId('share-link-create-btn'))
    expect(await screen.findByTestId('share-password-error')).toHaveTextContent('72바이트')
    expect(pw).toHaveAttribute('aria-invalid', 'true')
    expect(posts).toHaveLength(0)

    fireEvent.change(pw, { target: { value: '가'.repeat(24) } })
    expect(screen.queryByTestId('share-password-error')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('share-link-create-btn'))
    await waitFor(() => expect(posts).toHaveLength(1))
  })

  // #617: 만료일은 공용 formatDateOnly(YYYY-MM-DD) + 「까지」 — 로케일 점 형식이 아니고, 콜론 오프셋(+09:00)도 「-」 없이 읽는다.
  test('만료일은 zero-pad 하이픈 형식이고 +09:00 오프셋도 표시된다', async () => {
    const { unmount } = renderModal({ list: () => [link({ expiresAt: '2099-01-05T00:00:00Z' })] })
    const item = await screen.findByTestId('share-link-item')
    expect(item).toHaveTextContent('2099-01-05 까지')
    expect(item.textContent).not.toMatch(/\d{4}\.\s?\d{1,2}\.\s?\d{1,2}\.?/)
    unmount()

    renderModal({ list: () => [link({ expiresAt: '2099-01-05T23:59:59+09:00' })] })
    expect(await screen.findByTestId('share-link-item')).toHaveTextContent('2099-01-05 까지')
  })
})

describe('공유 링크 화면', () => {
  const BASE = '/api/v1/public/drive/share/:token'
  const ANON = { user: null, isAuthenticated: false, isLoading: false }
  type InfoBody = Record<string, unknown>
  const fileInfo = (over: InfoBody = {}): InfoBody => ({
    passwordRequired: false,
    loginRequired: false,
    name: 'report.txt',
    mimeType: 'text/plain',
    sizeBytes: 2048,
    sharedBy: '홍길동',
    loginAvailable: false,
    driveOpen: null,
    ...over,
  })

  /**
   * /s/:token 화면 — info(req) 가 정보 응답, 나머지 공개 경로는 핸들러로. 모든 요청은 requests 에 쌓는다.
   * search 로 ?from=login 같은 쿼리를 붙인다.
   */
  function renderLanding({
    token = 'sl_abc',
    search = '',
    info,
    unlock = () => HttpResponse.json({ viewToken: 'vt_1', expiresAt: '2099-01-01T00:00:00Z' }),
    content = () => new HttpResponse('hello share', { headers: { 'Content-Type': 'text/plain' } }),
    download = () => new HttpResponse('file', { headers: { 'Content-Disposition': 'attachment; filename="report.txt"' } }),
    auth,
  }: {
    token?: string
    search?: string
    info: (req: Request) => Response
    unlock?: () => Response
    content?: () => Response
    download?: () => Response
    auth?: Record<string, unknown>
  }) {
    const requests: { kind: string; req: Request; body?: unknown }[] = []
    const view = renderScreen(
      <Routes>
        <Route path="/s/:token" element={<ShareLinkPage />} />
      </Routes>,
      {
        path: `/s/${token}${search}`,
        auth,
        handlers: [
          http.get(BASE, ({ request }) => {
            requests.push({ kind: 'info', req: request.clone() })
            return info(request)
          }),
          http.post(`${BASE}/unlock`, async ({ request }) => {
            requests.push({ kind: 'unlock', req: request.clone(), body: await request.clone().json() })
            return unlock()
          }),
          http.get(`${BASE}/content`, ({ request }) => {
            requests.push({ kind: 'content', req: request.clone() })
            return content()
          }),
          http.get(`${BASE}/download`, ({ request }) => {
            requests.push({ kind: 'download', req: request.clone() })
            return download()
          }),
        ],
      },
    )
    const of = (kind: string) => requests.filter((r) => r.kind === kind)
    return { ...view, requests, of }
  }

  // WP-1539: 파일 정보가 열리면 「공유받은 항목」 캐시를 낡은 것으로 표시 — 드라이브로 돌아가면 사이드바 개수·목록을 다시 받는다.
  test('로그인 상태로 파일 정보를 열면 공유받은 항목 캐시를 무효화하고, 비로그인이면 건드리지 않는다', async () => {
    const signedIn = renderLanding({ info: () => HttpResponse.json(fileInfo()) })
    signedIn.queryClient.setQueryData(driveKeys.sharedWithMe(), [])
    await screen.findByTestId('share-file-card')
    await waitFor(() => expect(signedIn.queryClient.getQueryState(driveKeys.sharedWithMe())?.isInvalidated).toBe(true))
    signedIn.unmount()

    const anon = renderLanding({ auth: ANON, info: () => HttpResponse.json(fileInfo({ loginAvailable: true })) })
    anon.queryClient.setQueryData(driveKeys.sharedWithMe(), [])
    await screen.findByTestId('share-file-card')
    expect(anon.queryClient.getQueryState(driveKeys.sharedWithMe())?.isInvalidated).toBe(false)
  })

  // 비밀번호 없는 링크 — 바로 파일 카드(아이콘·이름·형식·크기·공유한 사람·버튼 둘).
  test('비밀번호 없는 링크는 바로 파일 카드를 보인다', async () => {
    renderLanding({ info: () => HttpResponse.json(fileInfo()) })
    const card = await screen.findByTestId('share-file-card')
    expect(within(card).getByTestId('share-file-name')).toHaveTextContent('report.txt')
    // WP-1429: 랜드마크(main)·대표 제목(h1, 파일 이름)이 하나씩, 탭 제목은 「파일 · 화면 · 앱」.
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'report.txt' })).toBeInTheDocument()
    expect(document.title).toBe('report.txt · 공유 링크 · Gen:iA Works')
    expect(screen.getByTestId('share-file-meta')).toHaveTextContent('TXT 파일 · 2.0 KB')
    expect(screen.getByTestId('share-file-shared-by')).toHaveTextContent('공유한 사람 홍길동')
    expect(screen.getByTestId('share-preview-btn')).toHaveTextContent('미리보기')
    expect(screen.getByTestId('share-download-btn')).toHaveTextContent('다운로드')
    expect(screen.queryByLabelText('공유 링크 비밀번호')).not.toBeInTheDocument()
  })

  // 공유한 사람이 없으면(null) 그 줄을 빼고, 다운로드는 공개 /download 로 받는다.
  test('공유한 사람 null 이면 줄이 없고 다운로드는 /download 로 받는다', async () => {
    const { user, of } = renderLanding({ info: () => HttpResponse.json(fileInfo({ sharedBy: null })) })
    await screen.findByTestId('share-file-card')
    expect(screen.queryByTestId('share-file-shared-by')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('share-download-btn'))
    await waitFor(() => expect(of('download')).toHaveLength(1))
    expect(of('download')[0].req.headers.get('x-share-view-token')).toBeNull()
  })

  // 비밀번호 링크 — 잠금 카드 → [확인] 은 비밀번호를 본문으로(URL·헤더 아님) 보내고, 받은 열람 토큰을 이후 정보·원본·다운로드 요청 헤더에 싣는다.
  test('비밀번호 잠금을 풀면 파일 카드가 보이고 이후 요청에 열람 토큰을 싣는다', async () => {
    const { user, of } = renderLanding({
      info: (req) =>
        HttpResponse.json(req.headers.get('x-share-view-token') === 'vt_1' ? fileInfo() : { passwordRequired: true, loginRequired: false }),
    })
    expect(await screen.findByText('비밀번호로 보호된 파일')).toBeInTheDocument()
    // WP-1429: 잠금 상태의 h1 은 잠금 제목 하나.
    expect(screen.getByRole('heading', { level: 1, name: '비밀번호로 보호된 파일' })).toBeInTheDocument()
    expect(screen.getByText('공유한 사람에게 받은 비밀번호를 넣으세요.')).toBeInTheDocument()
    await user.click(screen.getByLabelText('공유 링크 비밀번호'))
    await user.paste('한글비번 +1%')
    await user.click(screen.getByTestId('share-unlock-btn'))

    await screen.findByTestId('share-file-card')
    const unlock = of('unlock')[0]
    expect(unlock.body).toEqual({ password: '한글비번 +1%' })
    expect(unlock.req.url).not.toContain('password')
    expect(of('info').at(-1)!.req.headers.get('x-share-view-token')).toBe('vt_1')

    await user.click(screen.getByTestId('share-download-btn'))
    await waitFor(() => expect(of('download')).toHaveLength(1))
    expect(of('download')[0].req.headers.get('x-share-view-token')).toBe('vt_1')
    expect(of('download')[0].req.headers.get('x-share-password-encoded')).toBeNull()
  })

  // 틀린 비밀번호(401)·잠김(429) — 칸 아래 인라인 안내.
  test('틀린 비밀번호와 잠김은 칸 아래 안내를 보인다', async () => {
    let status = 401
    const { user } = renderLanding({
      info: () => HttpResponse.json({ passwordRequired: true, loginRequired: false }),
      unlock: () => new HttpResponse(null, { status }),
    })
    await screen.findByText('비밀번호로 보호된 파일')
    await user.click(screen.getByLabelText('공유 링크 비밀번호'))
    await user.paste('wrong')
    await user.click(screen.getByTestId('share-unlock-btn'))
    expect(await screen.findByTestId('share-unlock-error')).toHaveTextContent('비밀번호가 맞지 않습니다')
    expect(screen.getByLabelText('공유 링크 비밀번호')).toHaveAttribute('aria-invalid', 'true')

    status = 429
    await user.click(screen.getByTestId('share-unlock-btn'))
    await waitFor(() => expect(screen.getByTestId('share-unlock-error')).toHaveTextContent('시도 횟수를 넘었습니다. 잠시 뒤 다시 시도하세요'))
    expect(screen.queryByTestId('share-file-card')).not.toBeInTheDocument()
  })

  // 사내 링크 + 비로그인 — 사내 전용 잠금 카드, [로그인] 은 이 링크(?from=login)를 대기 목적지로 남기고 /login 으로.
  test('사내 링크를 비로그인으로 열면 로그인 잠금 카드를 보이고 돌아올 곳을 남긴다', async () => {
    const { user, location } = renderLanding({ token: 'sl_in', info: () => HttpResponse.json({ passwordRequired: false, loginRequired: true, sharedBy: null, driveOpen: null }), auth: ANON })
    expect(await screen.findByText('사내 전용 파일')).toBeInTheDocument()
    expect(screen.getByText('로그인한 같은 워크스페이스 사람만 볼 수 있습니다.')).toBeInTheDocument()
    await user.click(screen.getByTestId('share-login-btn'))
    expect(location()).toBe('/login')
    expect(JSON.parse(sessionStorage.getItem('pendingPushTarget')!)).toEqual({ tenantId: null, url: '/s/sl_in?from=login' })
  })

  // 사내 폴더 링크를 하위 폴더 주소(?folder=)로 비로그인 열기 — 로그인 뒤 같은 하위 폴더로 돌아오게 folder 도 남긴다(WP-1538).
  test('사내 폴더 링크의 하위 폴더 주소에서 로그인하면 folder 도 돌아올 곳에 남긴다', async () => {
    const { user } = renderLanding({
      token: 'sl_in',
      search: '?folder=42',
      info: () => HttpResponse.json({ passwordRequired: false, loginRequired: true, target: 'FOLDER' }),
      auth: ANON,
    })
    expect(await screen.findByText('사내 전용 폴더')).toBeInTheDocument()
    await user.click(screen.getByTestId('share-login-btn'))
    expect(JSON.parse(sessionStorage.getItem('pendingPushTarget')!)).toEqual({ tenantId: null, url: '/s/sl_in?from=login&folder=42' })
  })

  // 다른 워크스페이스(403) — 전환 안내.
  test('다른 워크스페이스 계정이면 403 안내를 보인다', async () => {
    renderLanding({ info: () => new HttpResponse(null, { status: 403 }) })
    expect(await screen.findByTestId('share-error-msg')).toHaveTextContent(
      '이 워크스페이스 사람만 볼 수 있는 파일입니다. 다른 워크스페이스 계정이 있다면 전환한 뒤 다시 여세요.',
    )
  })

  // 410·404 — 기존 문구 + 새 링크 요청 안내.
  test('만료·없는 링크는 원인과 새 링크 요청 안내를 보인다', async () => {
    const { unmount } = renderLanding({ info: () => new HttpResponse(null, { status: 410 }) })
    expect(await screen.findByTestId('share-error-msg')).toHaveTextContent('만료되었거나 폐기된 링크입니다')
    expect(screen.getByTestId('share-error-action')).toHaveTextContent('새 링크를 요청하세요')
    unmount()
    renderLanding({ info: () => new HttpResponse(null, { status: 404 }) })
    expect(await screen.findByTestId('share-error-msg')).toHaveTextContent('존재하지 않는 링크입니다')
    expect(screen.getByTestId('share-error-action')).toHaveTextContent('새 링크를 요청하세요')
    // WP-1429: 오류 상태도 main·h1 하나씩 — 제목은 화면 이름(보이지 않게), 원인 문구는 알림(role=alert).
    // 탭 제목은 덮지 않아 주소 기본값(「공유 링크」, documentTitle.test)에 맡긴다.
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: '공유 링크' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('존재하지 않는 링크입니다.')
    expect(document.title).not.toContain('report.txt')
  })

  // 공간 권한이 있으면 「드라이브에서 열기 →」 가 폴더·미리보기 경로로 간다(같은 창).
  test('드라이브 접근 권한이 있으면 드라이브에서 열기 링크를 보인다', async () => {
    renderLanding({ info: () => HttpResponse.json(fileInfo({ driveOpen: { spaceId: 3, folderId: 7, driveFileId: 42 } })) })
    const link = await screen.findByTestId('share-drive-open-link')
    expect(link).toHaveTextContent('드라이브에서 열기 →')
    expect(link).toHaveAttribute('href', '/drive/spaces/3?folderId=7&preview=42')
    expect(link).not.toHaveAttribute('target')
  })

  // 비로그인 — 「로그인하고 드라이브에서 열기 →」 는 ?from=login 으로 돌아올 곳을 남기고 로그인으로.
  test('비로그인이면 로그인하고 드라이브에서 열기가 돌아올 곳을 남긴다', async () => {
    const { user, location } = renderLanding({ token: 'sl_anon', info: () => HttpResponse.json(fileInfo({ loginAvailable: true })), auth: ANON })
    const link = await screen.findByTestId('share-login-open-link')
    expect(link).toHaveTextContent('로그인하고 드라이브에서 열기 →')
    await user.click(link)
    expect(location()).toBe('/login')
    expect(JSON.parse(sessionStorage.getItem('pendingPushTarget')!)).toEqual({ tenantId: null, url: '/s/sl_anon?from=login' })
  })

  // 로그인했지만 공간 권한 없음 — 링크 없음. 로그인하고 막 돌아온 경우(from=login)만 이유를 알린다.
  test('로그인했지만 권한이 없으면 링크가 없고 from=login 이면 안내한다', async () => {
    const { unmount } = renderLanding({ info: () => HttpResponse.json(fileInfo()) })
    await screen.findByTestId('share-file-card')
    expect(screen.queryByTestId('share-drive-open-link')).not.toBeInTheDocument()
    expect(screen.queryByTestId('share-login-open-link')).not.toBeInTheDocument()
    expect(screen.queryByTestId('share-no-access-msg')).not.toBeInTheDocument()
    unmount()

    const { location } = renderLanding({ search: '?from=login', info: () => HttpResponse.json(fileInfo()) })
    expect(await screen.findByTestId('share-no-access-msg')).toHaveTextContent('이 파일이 있는 공간에 접근 권한이 없습니다')
    // 드라이브로 자동 이동하지 않는다.
    expect(location()).toBe('/s/sl_abc?from=login')
  })

  // [미리보기] — 통합 뷰어가 열리고 공개 /content 를 열람 토큰 헤더로 받는다.
  test('미리보기는 뷰어를 열고 공개 원본을 열람 토큰 헤더로 받는다', async () => {
    const { user, of } = renderLanding({
      info: (req) =>
        HttpResponse.json(req.headers.get('x-share-view-token') ? fileInfo() : { passwordRequired: true, loginRequired: false }),
    })
    await screen.findByText('비밀번호로 보호된 파일')
    await user.click(screen.getByLabelText('공유 링크 비밀번호'))
    await user.paste('pw')
    await user.click(screen.getByTestId('share-unlock-btn'))
    await user.click(await screen.findByTestId('share-preview-btn'))
    expect(await screen.findByText('hello share')).toBeInTheDocument()
    expect(of('content')).toHaveLength(1)
    expect(of('content')[0].req.headers.get('x-share-view-token')).toBe('vt_1')
    // 공개 화면이라 링크 복사가 없다(shareable=false).
    expect(screen.queryByRole('menuitem', { name: /링크 복사/ })).not.toBeInTheDocument()
  })

  // 열람 토큰 만료 — 원본 요청이 401 이면 뷰어를 닫고 비밀번호 잠금 카드로 돌아간다.
  test('열람 토큰이 만료되면 비밀번호 잠금 카드로 돌아간다', async () => {
    const { user } = renderLanding({
      info: (req) =>
        HttpResponse.json(req.headers.get('x-share-view-token') ? fileInfo() : { passwordRequired: true, loginRequired: false }),
      content: () => new HttpResponse(null, { status: 401 }),
    })
    await screen.findByText('비밀번호로 보호된 파일')
    await user.click(screen.getByLabelText('공유 링크 비밀번호'))
    await user.paste('pw')
    await user.click(screen.getByTestId('share-unlock-btn'))
    await user.click(await screen.findByTestId('share-preview-btn'))
    expect(await screen.findByText('비밀번호로 보호된 파일')).toBeInTheDocument()
    expect(screen.queryByTestId('share-file-card')).not.toBeInTheDocument()
  })

  // 열람 토큰 만료 — 다운로드가 401 이면 다시 시도하지 않고 비밀번호 잠금 카드로 돌아간다.
  test('다운로드가 401 이면 비밀번호 잠금 카드로 돌아간다', async () => {
    const { user, of } = renderLanding({
      info: (req) =>
        HttpResponse.json(req.headers.get('x-share-view-token') ? fileInfo() : { passwordRequired: true, loginRequired: false }),
      download: () => new HttpResponse(null, { status: 401 }),
    })
    await screen.findByText('비밀번호로 보호된 파일')
    await user.click(screen.getByLabelText('공유 링크 비밀번호'))
    await user.paste('pw')
    await user.click(screen.getByTestId('share-unlock-btn'))
    await user.click(await screen.findByTestId('share-download-btn'))
    expect(await screen.findByText('비밀번호로 보호된 파일')).toBeInTheDocument()
    expect(of('download')).toHaveLength(1)
  })

  // 사내 링크에서 세션이 풀리면 /unlock 도 401 — 정보를 다시 물어 로그인 잠금이면 「틀림」 대신 사내 잠금 카드를 보인다.
  test('잠금 풀기 401 뒤 정보가 로그인 필요면 사내 잠금 카드로 바뀐다', async () => {
    let loginRequired = false
    const { user, of } = renderLanding({
      info: () => HttpResponse.json({ passwordRequired: !loginRequired, loginRequired }),
      unlock: () => {
        loginRequired = true
        return new HttpResponse(null, { status: 401 })
      },
    })
    await screen.findByText('비밀번호로 보호된 파일')
    await user.click(screen.getByLabelText('공유 링크 비밀번호'))
    await user.paste('pw')
    await user.click(screen.getByTestId('share-unlock-btn'))
    expect(await screen.findByText('사내 전용 파일')).toBeInTheDocument()
    expect(screen.queryByTestId('share-unlock-error')).not.toBeInTheDocument()
    expect(of('info')).toHaveLength(2)
  })

  // WP-1429: 예상 밖 응답 모양(이름·잠금 표시 없음)이면 빈 화면 대신 일시 실패 카드(h1 포함)와 다시 시도를 보인다.
  test('정보 응답 모양이 예상 밖이면 일시 실패 안내와 다시 시도를 보인다', async () => {
    renderLanding({ info: () => HttpResponse.json({ passwordRequired: false, loginRequired: false }) })
    expect(await screen.findByTestId('share-error-msg')).toHaveTextContent('링크를 열지 못했습니다')
    expect(screen.getByRole('heading', { level: 1, name: '공유 링크' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  })

  // 토큰 없는 주소 — 정보 조회가 꺼져 로딩에 머물지 않고 없는 링크 안내를 보인다.
  test('토큰이 없으면 존재하지 않는 링크 안내를 보인다', async () => {
    renderScreen(<ShareLinkPage />, { path: '/s/' })
    expect(await screen.findByTestId('share-error-msg')).toHaveTextContent('존재하지 않는 링크입니다')
    expect(screen.queryByTestId('share-loading')).not.toBeInTheDocument()
  })

  // 세션 복원 중(isLoading)에는 정보를 묻지 않는다 — 새 탭의 로그인 사용자가 Bearer 없이 물어 사내 잠금으로 보이지 않게.
  test('세션 복원 중에는 정보를 묻지 않는다', async () => {
    const { of } = renderLanding({ info: () => HttpResponse.json(fileInfo()), auth: { isLoading: true } })
    expect(screen.getByTestId('share-loading')).toBeInTheDocument()
    // WP-1429: 로딩 상태도 h1 하나(화면 이름, 보이지 않게).
    expect(screen.getByRole('heading', { level: 1, name: '공유 링크' })).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 50))
    expect(of('info')).toHaveLength(0)
  })

  // #677: 앱 셸 밖 독립 화면이라 브랜드 링크(/)로 앱에 돌아갈 수 있다.
  test('브랜드 링크로 앱 홈에 돌아갈 수 있다', () => {
    renderLanding({ info: () => new HttpResponse(null, { status: 404 }) })
    expect(screen.getByRole('link', { name: 'Gen:iA Works' })).toHaveAttribute('href', '/')
  })

  // WP-1364: 브랜드 링크 안에 로고 마크가 문구 앞에 붙는다.
  test('브랜드 링크에 로고 마크가 문구와 함께 있다(WP-1364)', () => {
    renderLanding({ info: () => new HttpResponse(null, { status: 404 }) })
    const link = screen.getByRole('link', { name: 'Gen:iA Works' })
    expect(within(link).getByTestId('share-brand-mark')).toBeInTheDocument()
  })
})

// WP-1538: 폴더 공유 링크 화면 — 정보 kind=FOLDER 면 폴더 보기(머리·목록·경로·?folder=·뷰어 ‹ ›·다운로드).
// 하위 목록은 GET /children?folder= 로, 하위 파일은 /files/{id}/content|download 로 받는다(열람 토큰 헤더).
describe('폴더 공유 링크 화면', () => {
  const BASE = '/api/v1/public/drive/share/:token'
  const ANON = { user: null, isAuthenticated: false, isLoading: false }
  type Body = Record<string, unknown>
  const folderInfo = (over: Body = {}): Body => ({
    passwordRequired: false,
    loginRequired: false,
    kind: 'FOLDER',
    name: 'root',
    folderCount: 2,
    fileCount: 4,
    sharedBy: '홍길동',
    loginAvailable: false,
    driveOpen: null,
    ...over,
  })
  const file = (id: number, name: string) => ({ id, name, mimeType: 'text/plain', sizeBytes: 2048, updatedAt: '2026-11-01T00:00:00Z' })
  const ROOT = { id: 20, name: 'root' }
  /** 폴더 id → 목록 응답. null 은 공유 폴더(folder 파라미터 없음). */
  const LISTINGS: Record<string, Body> = {
    root: {
      folderId: 20,
      path: [ROOT],
      folders: [
        { id: 21, name: 'A', updatedAt: '2026-11-02T00:00:00Z' },
        { id: 22, name: 'B', updatedAt: '2026-11-02T00:00:00Z' },
      ],
      files: [file(31, 'a.txt'), file(32, 'b.txt'), file(33, 'c.txt'), file(34, 'd.txt')],
      truncated: false,
    },
    '21': { folderId: 21, path: [ROOT, { id: 21, name: 'A' }], folders: [{ id: 23, name: 'A1', updatedAt: '2026-11-02T00:00:00Z' }], files: [file(35, 'x.txt')], truncated: false },
    '22': { folderId: 22, path: [ROOT, { id: 22, name: 'B' }], folders: [], files: [file(36, 'y.txt')], truncated: false },
    '23': { folderId: 23, path: [ROOT, { id: 21, name: 'A' }, { id: 23, name: 'A1' }], folders: [], files: [], truncated: false },
    '29': {
      folderId: 29,
      path: [ROOT, { id: 25, name: 'L1' }, { id: 26, name: 'L2' }, { id: 27, name: 'L3' }, { id: 29, name: 'L4' }],
      folders: [],
      files: [],
      truncated: false,
    },
  }

  /** /s/:token 폴더 화면 — children(folder) 는 folder 파라미터(없으면 null)로 응답을 고른다. 모든 요청은 requests 에 쌓는다. */
  function renderFolder({
    token = 'sl_x',
    search = '',
    info = () => HttpResponse.json(folderInfo()),
    children = (folder: string | null) => {
      const body = LISTINGS[folder ?? 'root']
      return body ? HttpResponse.json(body) : new HttpResponse(null, { status: 404 })
    },
    auth,
  }: {
    token?: string
    search?: string
    info?: (req: Request) => Response
    children?: (folder: string | null, req: Request) => Response
    auth?: Record<string, unknown>
  } = {}) {
    const requests: { kind: string; req: Request; fileId?: string }[] = []
    const view = renderScreen(
      <Routes>
        <Route path="/s/:token" element={<ShareLinkPage />} />
      </Routes>,
      {
        path: `/s/${token}${search}`,
        auth,
        handlers: [
          http.get(BASE, ({ request }) => {
            requests.push({ kind: 'info', req: request.clone() })
            return info(request)
          }),
          http.post(`${BASE}/unlock`, () => HttpResponse.json({ viewToken: 'vt_1', expiresAt: '2099-01-01T00:00:00Z' })),
          http.get(`${BASE}/children`, ({ request }) => {
            requests.push({ kind: 'children', req: request.clone() })
            return children(new URL(request.url).searchParams.get('folder'), request)
          }),
          http.get(`${BASE}/files/:fileId/content`, ({ request, params }) => {
            requests.push({ kind: 'content', req: request.clone(), fileId: String(params.fileId) })
            return new HttpResponse(`content of ${String(params.fileId)}`, { headers: { 'Content-Type': 'text/plain' } })
          }),
          http.get(`${BASE}/files/:fileId/download`, ({ request, params }) => {
            requests.push({ kind: 'download', req: request.clone(), fileId: String(params.fileId) })
            return new HttpResponse('file', { headers: { 'Content-Disposition': 'attachment; filename="a.txt"' } })
          }),
        ],
      },
    )
    const of = (kind: string) => requests.filter((r) => r.kind === kind)
    const folderParams = () => of('children').map((r) => new URL(r.req.url).searchParams.get('folder'))
    return { ...view, requests, of, folderParams }
  }

  // 공유 폴더(루트) — 머리(이름·「폴더 n개 · 파일 n개」·공유한 사람) + 표(폴더 먼저, 파일 행 미리보기·다운로드 아이콘 버튼).
  test('공유 폴더 루트는 머리와 목록(폴더 먼저)을 보인다', async () => {
    const { folderParams } = renderFolder()
    expect(await screen.findByRole('heading', { level: 1, name: 'root' })).toBeInTheDocument()
    expect(screen.getByTestId('share-folder-meta')).toHaveTextContent('폴더 2개 · 파일 4개')
    expect(screen.getByTestId('share-folder-shared-by')).toHaveTextContent('공유한 사람 홍길동')
    const table = await screen.findByTestId('share-folder-table')
    const names = within(table)
      .getAllByTestId(/^share-(folder|file)-row-/)
      .map((r) => r.getAttribute('data-testid'))
    expect(names).toEqual([
      'share-folder-row-21',
      'share-folder-row-22',
      'share-file-row-31',
      'share-file-row-32',
      'share-file-row-33',
      'share-file-row-34',
    ])
    const row = screen.getByTestId('share-file-row-31')
    expect(within(row).getByText('a.txt')).toBeInTheDocument()
    expect(within(row).getByText('2.0 KB')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'a.txt 미리보기' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'a.txt 다운로드' })).toBeInTheDocument()
    // 첫 진입은 folder 파라미터 없이 공유 폴더를 묻는다. 파일 카드는 없다.
    expect(folderParams()).toEqual([null])
    expect(screen.queryByTestId('share-file-card')).not.toBeInTheDocument()
    expect(document.title).toBe('root · 공유 링크 · Gen:iA Works')
  })

  // 폴더 행 → ?folder=21 push, 머리 대신 경로 「root › A」, 탭 제목은 현재 폴더. 뒤로 가기 = 상위로.
  test('하위 폴더로 들어가면 ?folder= 를 남기고 경로를 보인다', async () => {
    const { user, location } = renderFolder()
    await user.click(await screen.findByRole('button', { name: 'A 폴더 열기' }))
    await waitFor(() => expect(location()).toBe('/s/sl_x?folder=21'))
    const crumbs = await screen.findByTestId('share-folder-breadcrumb')
    expect(crumbs).toHaveTextContent('root›A')
    expect(await screen.findByTestId('share-file-row-35')).toBeInTheDocument()
    expect(screen.queryByTestId('share-folder-meta')).not.toBeInTheDocument()
    expect(document.title).toBe('A · 공유 링크 · Gen:iA Works')
    window.history.back()
    await waitFor(() => expect(location()).toBe('/s/sl_x'))
    expect(await screen.findByTestId('share-folder-meta')).toBeInTheDocument()
  })

  // 경로 클릭 — 상위로 push. 공유 폴더로 갈 땐 folder 를 지우고 다른 파라미터(from=login)는 남긴다.
  test('경로를 누르면 상위로 가고 공유 폴더는 folder 를 지우되 from=login 은 남긴다', async () => {
    const { user, location } = renderFolder({ search: '?from=login&folder=23' })
    const crumbs = await screen.findByTestId('share-folder-breadcrumb')
    expect(crumbs).toHaveTextContent('root›A›A1')
    await user.click(within(crumbs).getByRole('button', { name: 'A' }))
    await waitFor(() => expect(location()).toBe('/s/sl_x?from=login&folder=21'))
    await user.click(within(await screen.findByTestId('share-folder-breadcrumb')).getByRole('button', { name: 'root' }))
    await waitFor(() => expect(location()).toBe('/s/sl_x?from=login'))
    expect(await screen.findByTestId('share-folder-meta')).toBeInTheDocument()
  })

  // 깊은 경로는 「공유 폴더 › … › 부모 › 현재」로 가운데를 접는다(P11).
  test('경로가 4단계를 넘으면 가운데를 접는다', async () => {
    renderFolder({ search: '?folder=29' })
    const crumbs = await screen.findByTestId('share-folder-breadcrumb')
    expect(crumbs).toHaveTextContent('root›…›L3›L4')
    expect(within(crumbs).queryByText('L1')).not.toBeInTheDocument()
  })

  // 새로고침 — 첫 진입 주소의 ?folder= 를 그대로 묻고 경로를 보인다.
  test('첫 진입 ?folder= 를 유지한다', async () => {
    const { folderParams } = renderFolder({ search: '?folder=22' })
    expect(await screen.findByTestId('share-folder-breadcrumb')).toHaveTextContent('root›B')
    expect(folderParams()).toEqual(['22'])
  })

  // 숫자가 아닌·음수 folder → 공유 폴더(folder 파라미터 없이).
  test('잘못된 folder 파라미터는 공유 폴더로 본다', async () => {
    const { folderParams, unmount } = renderFolder({ search: '?folder=abc' })
    expect(await screen.findByTestId('share-folder-meta')).toBeInTheDocument()
    expect(folderParams()).toEqual([null])
    unmount()
    const second = renderFolder({ search: '?folder=-3' })
    expect(await screen.findByTestId('share-folder-meta')).toBeInTheDocument()
    expect(second.folderParams()).toEqual([null])
  })

  // 밖·사라진 폴더(404) — 목록 자리 안내 + [공유 폴더로], 카드 머리는 그대로(P10).
  test('없는 하위 폴더는 목록 자리에 안내와 공유 폴더로 단추를 보인다', async () => {
    const { user, location } = renderFolder({ search: '?folder=99' })
    expect(await screen.findByText('이 폴더를 찾을 수 없습니다')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'root' })).toBeInTheDocument()
    expect(screen.queryByTestId('share-error-msg')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '공유 폴더로' }))
    await waitFor(() => expect(location()).toBe('/s/sl_x'))
    expect(await screen.findByTestId('share-folder-table')).toBeInTheDocument()
  })

  // 상한을 넘은 폴더 — 「일부만 표시됩니다」 줄(P8).
  test('목록이 잘렸으면 일부만 표시된다고 알린다', async () => {
    renderFolder({ children: () => HttpResponse.json({ ...LISTINGS.root, truncated: true }) })
    expect(await screen.findByText('일부만 표시됩니다')).toBeInTheDocument()
  })

  // 파일 행 미리보기 — 뷰어에 현재 폴더 파일 전체가 실리고 ‹ › 로 넘긴다(다음 파일 원본을 /files/{id}/content 로).
  test('미리보기는 현재 폴더 파일 전체를 뷰어에 싣고 넘긴다', async () => {
    const { user, of } = renderFolder()
    await user.click(await screen.findByRole('button', { name: 'b.txt 미리보기' }))
    expect(await screen.findByText('content of 32')).toBeInTheDocument()
    expect(screen.getByTestId('viewer-live')).toHaveTextContent('b.txt, 4개 중 2번째')
    await user.click(screen.getByRole('button', { name: '다음 파일' }))
    expect(await screen.findByText('content of 33')).toBeInTheDocument()
    expect(screen.getByTestId('viewer-live')).toHaveTextContent('c.txt, 4개 중 3번째')
    expect(of('content').map((r) => r.fileId)).toEqual(['32', '33'])
  })

  // 뒤로 가기 — 뷰어가 열린 채 이전 폴더로 돌아가면, 새 목록이 와도 같은 위치의 다른 폴더 파일로 뷰어가 다시 열리지 않는다(WP-1538).
  test('뷰어를 연 채 뒤로 가면 새 폴더 목록이 와도 뷰어가 다시 열리지 않는다', async () => {
    const { user, location } = renderFolder()
    await user.click(await screen.findByRole('button', { name: 'A 폴더 열기' }))
    await waitFor(() => expect(location()).toBe('/s/sl_x?folder=21'))
    await user.click(await screen.findByRole('button', { name: 'x.txt 미리보기' }))
    expect(await screen.findByText('content of 35')).toBeInTheDocument()
    expect(screen.getByTestId('viewer-live')).toBeInTheDocument()
    window.history.back()
    await waitFor(() => expect(location()).toBe('/s/sl_x'))
    expect(await screen.findByTestId('share-folder-table')).toBeInTheDocument()
    expect(screen.queryByTestId('viewer-live')).not.toBeInTheDocument()
  })

  // 다운로드 — /files/{id}/download, 비밀번호 링크면 열람 토큰 헤더.
  test('다운로드는 /files/{id}/download 를 열람 토큰 헤더로 받는다', async () => {
    const { user, of } = renderFolder({
      info: (req) =>
        HttpResponse.json(req.headers.get('x-share-view-token') === 'vt_1' ? folderInfo() : { passwordRequired: true, loginRequired: false, target: 'FOLDER' }),
    })
    expect(await screen.findByText('비밀번호로 보호된 폴더')).toBeInTheDocument()
    await user.click(screen.getByLabelText('공유 링크 비밀번호'))
    await user.paste('pw')
    await user.click(screen.getByTestId('share-unlock-btn'))
    await user.click(await screen.findByRole('button', { name: 'c.txt 다운로드' }))
    await waitFor(() => expect(of('download')).toHaveLength(1))
    expect(of('download')[0].fileId).toBe('33')
    expect(of('download')[0].req.headers.get('x-share-view-token')).toBe('vt_1')
    expect(of('children')[0].req.headers.get('x-share-view-token')).toBe('vt_1')
  })

  // 사내 폴더 링크 + 비로그인 — 「사내 전용 폴더」 잠금 카드(P9 target).
  test('사내 폴더 링크 잠금 카드', async () => {
    renderFolder({ info: () => HttpResponse.json({ passwordRequired: false, loginRequired: true, target: 'FOLDER' }), auth: ANON })
    expect(await screen.findByRole('heading', { level: 1, name: '사내 전용 폴더' })).toBeInTheDocument()
  })

  // 비밀번호 폴더 링크 — 「비밀번호로 보호된 폴더」.
  test('비밀번호 폴더 링크 잠금 카드', async () => {
    renderFolder({ info: () => HttpResponse.json({ passwordRequired: true, loginRequired: false, target: 'FOLDER' }) })
    expect(await screen.findByRole('heading', { level: 1, name: '비밀번호로 보호된 폴더' })).toBeInTheDocument()
  })

  // 드라이브에서 열기 — driveOpen 이 있을 때만, 현재 폴더로. 비로그인에게 「로그인하고 드라이브에서 열기」는 없다(P12).
  test('드라이브에서 열기는 공간 구성원에게만 현재 폴더로 보인다', async () => {
    const { user, unmount } = renderFolder({ info: () => HttpResponse.json(folderInfo({ driveOpen: { spaceId: 3, folderId: 20 } })) })
    const link = await screen.findByTestId('share-drive-open-link')
    // 목록을 받으면 그 폴더(공유 폴더 20) — 받기 전에는 driveOpen.folderId 로 같은 값.
    await waitFor(() => expect(link).toHaveAttribute('href', '/drive/spaces/3?folderId=20'))
    await user.click(await screen.findByRole('button', { name: 'A 폴더 열기' }))
    await waitFor(() => expect(screen.getByTestId('share-drive-open-link')).toHaveAttribute('href', '/drive/spaces/3?folderId=21'))
    unmount()

    renderFolder({ info: () => HttpResponse.json(folderInfo({ loginAvailable: true })), auth: ANON })
    await screen.findByTestId('share-folder-table')
    expect(screen.queryByTestId('share-drive-open-link')).not.toBeInTheDocument()
    expect(screen.queryByTestId('share-login-open-link')).not.toBeInTheDocument()
  })

  // 다른 워크스페이스 403 — info 오류라 종류를 모른다 → 기존 403 문구 그대로.
  test('다른 워크스페이스 403 안내를 보인다', async () => {
    renderFolder({ info: () => new HttpResponse(null, { status: 403 }) })
    expect(await screen.findByTestId('share-error-msg')).toHaveTextContent('다른 워크스페이스 계정이 있다면 전환한 뒤 다시 여세요.')
  })

  // 회귀 — kind 없는(또는 FILE) 정보는 기존 파일 카드, children 은 묻지 않는다.
  test('파일 링크는 그대로 파일 카드를 보인다', async () => {
    const { of } = renderFolder({
      info: () => HttpResponse.json({ passwordRequired: false, loginRequired: false, kind: 'FILE', name: 'report.txt', mimeType: 'text/plain', sizeBytes: 2048, sharedBy: null, loginAvailable: false, driveOpen: null }),
    })
    expect(await screen.findByTestId('share-file-card')).toBeInTheDocument()
    expect(screen.queryByTestId('share-folder-table')).not.toBeInTheDocument()
    expect(of('children')).toHaveLength(0)
  })
})
