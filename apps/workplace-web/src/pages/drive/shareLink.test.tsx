// @vitest-environment jsdom
// happy-dom(화면 테스트 기본, WP-1002)과 날짜 칸·글자 수 제한·포커스 이동 처리가 달라 이 파일은 jsdom 에서 돈다.
// 드라이브 공유 링크 — 공유 창(ShareLinkModal)과 공개 받기 화면(/s/:token, ShareLinkPage) 화면 컴포넌트 테스트(WP-971, WP-984).
// 생성 payload·랜딩 URL·폐기 반영, 닫기/취소 라벨, 만료일·비밀번호 유효성(요청 차단), 만료일 표시 형식,
// 받기 화면의 안내·홈 링크는 브라우저 없이 판정되므로 e2e/pages/drive/drive-share-link.spec.ts 에서 옮겼다.
// WP-1227: 공유 링크 화면(정보 → 파일 카드·비밀번호/사내 잠금·열람 토큰·드라이브에서 열기·미리보기 뷰어).
// 인증 없이 /s/:token 에 들어가도 받기 화면이 뜨는 라우트 배선(@wiring)은 그 E2E 가 지킨다. 보관 공간 분기는 ShareLinkModal.test.tsx.
// 공유 창은 파일 행 버튼이 여는 대화상자만, 받기 화면은 /s/:token 라우트 하나만 renderScreen 으로 띄운다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'

import { ShareLinkModal } from '@/components/drive/ShareLinkModal'
import ShareLinkPage from '@/pages/drive/ShareLinkPage'
import { renderScreen } from '@/test/renderScreen'
import type { CreatedShareLink, ShareLink } from '@/types/drive'

import { createFile } from '../../../e2e/factories/drive.factory'

const FILE_ID = 10
const LINKS = `/api/v1/drive/files/${FILE_ID}/share-links`

const link = (over: Partial<ShareLink> = {}): ShareLink => ({
  id: 5,
  audience: 'EXTERNAL',
  hasPassword: false,
  expiresAt: null,
  revoked: false,
  createdAt: '2026-06-21T00:00:00Z',
  createdBy: 1,
  ...over,
})

/** 공유 창을 띄운다 — 목록 GET 은 list(), POST 는 받은 본문을 posts 에 쌓고 created 를 돌려준다. */
function renderModal({ list = (): ShareLink[] => [], handlers = [] as RequestHandler[], created }: { list?: () => ShareLink[]; handlers?: RequestHandler[]; created?: CreatedShareLink } = {}) {
  const posts: Record<string, unknown>[] = []
  let closed = 0
  const view = renderScreen(<ShareLinkModal file={createFile({ id: FILE_ID, name: 'report.txt' })} onClose={() => closed++} />, {
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
  // 생성 → POST audience(기본 외부) → 랜딩(/s/) URL 1회 노출(다운로드 API 경로 아님) → 목록 1건(외부) → 폐기 DELETE → 「폐기됨」 배지(Badge pill), 폐기 버튼 사라짐.
  test('생성 → 랜딩 URL 노출 → 폐기하면 폐기됨 배지로 바뀐다', async () => {
    let revoked = false
    let deletes = 0
    const { user, posts } = renderModal({
      list: () => [link({ revoked })],
      created: { id: 5, token: 'sl_abc', audience: 'EXTERNAL', hasPassword: false, expiresAt: null },
      handlers: [
        http.delete('/api/v1/drive/share-links/5', () => {
          deletes++
          revoked = true
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    })
    expect(await screen.findByTestId('share-link-modal')).toBeInTheDocument()
    expect(document.getElementById('share-audience-external')).toBeChecked()
    await user.click(screen.getByTestId('share-link-create-btn'))
    const created = await screen.findByTestId('share-link-created-url')
    expect(posts[0].audience).toBe('EXTERNAL')
    const url = within(created).getByRole('textbox', { name: /생성된 공유 링크/i }) as HTMLInputElement
    expect(url.value).toMatch(/\/s\/sl_abc/)
    expect(url.value).not.toContain('/api/v1/public/drive/share/')

    const item = await screen.findByTestId('share-link-item')
    expect(screen.getByTestId('share-link-list')).toBeInTheDocument()
    expect(item).toHaveTextContent('외부')
    await user.click(screen.getByTestId('share-link-revoke-btn'))
    await waitFor(() => expect(screen.getByTestId('share-link-item')).toHaveTextContent('폐기됨'))
    expect(deletes).toBe(1)
    expect(within(screen.getByTestId('share-link-item')).getByText('폐기됨')).toHaveClass('inline-flex')
    expect(screen.queryByTestId('share-link-revoke-btn')).not.toBeInTheDocument()
  })

  // #829: 코너 X 는 「닫기」, 하단 버튼은 「취소」 — 같은 이름이 둘이 아니고, 취소는 닫는다.
  test('하단 버튼은 「취소」, 코너 X 는 「닫기」이고 취소하면 닫힌다', async () => {
    const { user, closed } = renderModal()
    const modal = await screen.findByTestId('share-link-modal')
    expect(within(modal).getAllByRole('button', { name: '닫기' })).toHaveLength(1)
    const cancel = within(modal).getAllByRole('button', { name: '취소' })
    expect(cancel).toHaveLength(1)
    await user.click(cancel[0])
    expect(closed()).toBe(1)
  })

  // #673: 과거 만료일은 키보드 입력으로 들어와도 생성 시 다시 막는다 — 인라인 오류, 요청 없음, URL 영역 없음.
  // WP-901: 5자리 연도는 과거 가드보다 먼저 서버와 같은 범위 안내로 막고 aria-describedby 로 잇는다.
  test('과거 만료일·범위 밖 연도는 인라인 오류로 생성을 막는다', async () => {
    const { user, posts } = renderModal()
    await screen.findByTestId('share-link-modal')
    const expires = document.getElementById('share-expires') as HTMLInputElement
    fireEvent.change(expires, { target: { value: '2020-01-01' } })
    await user.click(screen.getByTestId('share-link-create-btn'))
    expect(await screen.findByTestId('share-expires-error')).toHaveTextContent('오늘 이후')
    expect(screen.queryByTestId('share-link-created-url')).not.toBeInTheDocument()

    fireEvent.change(expires, { target: { value: '20260-10-23' } })
    await user.click(screen.getByTestId('share-link-create-btn'))
    await waitFor(() => expect(screen.getByTestId('share-expires-error')).toHaveTextContent('날짜는 1900-01-01 ~ 9999-12-31 사이여야 합니다'))
    expect(expires).toHaveAttribute('aria-describedby', 'share-expires-error')
    expect(posts).toHaveLength(0)
    expect(screen.queryByTestId('share-link-created-url')).not.toBeInTheDocument()
  })

  // WP-497: 비밀번호가 72바이트(bcrypt 한도)를 넘으면 한국어 인라인 오류로 막고, 고치면 오류가 사라져 생성된다.
  test('비밀번호 72바이트 초과는 막고, 한도 안으로 고치면 생성한다', async () => {
    const { user, posts } = renderModal({ created: { id: 6, token: 'sl_pw', audience: 'EXTERNAL', hasPassword: true, expiresAt: null } })
    await screen.findByTestId('share-link-modal')
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

  // #617: 만료일은 공용 formatDateOnly(YYYY-MM-DD) — 로케일 점 형식이 아니고, 콜론 오프셋(+09:00)도 「-」 없이 읽는다.
  test('만료일은 zero-pad 하이픈 형식이고 +09:00 오프셋도 표시된다', async () => {
    const { unmount } = renderModal({ list: () => [link({ expiresAt: '2099-01-05T00:00:00Z' })] })
    const item = await screen.findByTestId('share-link-item')
    expect(item).toHaveTextContent('2099-01-05')
    expect(item.textContent).not.toMatch(/\d{4}\.\s?\d{1,2}\.\s?\d{1,2}\.?/)
    unmount()

    renderModal({ list: () => [link({ expiresAt: '2099-01-05T23:59:59+09:00' })] })
    expect(await screen.findByTestId('share-link-item')).toHaveTextContent('2099-01-05')
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

  // 비밀번호 없는 링크 — 바로 파일 카드(아이콘·이름·형식·크기·공유한 사람·버튼 둘).
  test('비밀번호 없는 링크는 바로 파일 카드를 보인다', async () => {
    renderLanding({ info: () => HttpResponse.json(fileInfo()) })
    const card = await screen.findByTestId('share-file-card')
    expect(within(card).getByTestId('share-file-name')).toHaveTextContent('report.txt')
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
    await new Promise((r) => setTimeout(r, 50))
    expect(of('info')).toHaveLength(0)
  })

  // #677: 앱 셸 밖 독립 화면이라 브랜드 링크(/)로 앱에 돌아갈 수 있다.
  test('브랜드 링크로 앱 홈에 돌아갈 수 있다', () => {
    renderLanding({ info: () => new HttpResponse(null, { status: 404 }) })
    expect(screen.getByRole('link', { name: 'Gen:iA Works' })).toHaveAttribute('href', '/')
  })
})
