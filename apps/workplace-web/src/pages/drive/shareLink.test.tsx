// @vitest-environment jsdom
// happy-dom(화면 테스트 기본, WP-1002)과 날짜 칸·글자 수 제한·포커스 이동 처리가 달라 이 파일은 jsdom 에서 돈다.
// 드라이브 공유 링크 — 공유 창(ShareLinkModal)과 공개 받기 화면(/s/:token, ShareLinkPage) 화면 컴포넌트 테스트(WP-971, WP-984).
// 생성 payload·랜딩 URL·폐기 반영, 닫기/취소 라벨, 만료일·비밀번호 유효성(요청 차단), 만료일 표시 형식,
// 받기 화면의 비밀번호 인코딩 헤더·401/410 안내·홈 링크는 브라우저 없이 판정되므로 e2e/pages/drive/drive-share-link.spec.ts 에서 옮겼다.
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

describe('공개 받기 화면', () => {
  /** /s/:token 받기 화면 — 다운로드 응답은 reply 로 준다. 요청은 requests 에 쌓는다. */
  function renderLanding(token: string, reply: () => Response) {
    const requests: Request[] = []
    const view = renderScreen(
      <Routes>
        <Route path="/s/:token" element={<ShareLinkPage />} />
      </Routes>,
      {
        path: `/s/${token}`,
        handlers: [
          http.get('/api/v1/public/drive/share/:token/download', ({ request }) => {
            requests.push(request.clone())
            return reply()
          }),
        ],
      },
    )
    return { ...view, requests }
  }

  // WP-528: 한글·기호 비밀번호는 원문 헤더가 아니라 UTF-8 퍼센트 인코딩 X-Share-Password-Encoded 로, URL 쿼리에는 싣지 않는다.
  test('비밀번호를 인코딩 헤더로 보내고 URL 에는 싣지 않는다', async () => {
    const { user, requests } = renderLanding('sl_pw', () =>
      new HttpResponse('file-content', { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="test.txt"' } }),
    )
    expect(screen.getByTestId('share-download-btn')).toHaveTextContent('다운로드')
    await user.click(screen.getByLabelText('공유 링크 비밀번호'))
    await user.paste('한글비번 +1%')
    await user.click(screen.getByTestId('share-download-btn'))
    await waitFor(() => expect(requests).toHaveLength(1))
    const req = requests[0]
    expect(req.headers.get('x-share-password-encoded')).toBe(encodeURIComponent('한글비번 +1%'))
    expect(req.headers.get('x-share-password')).toBeNull()
    expect(req.url).toContain('sl_pw')
    expect(req.url).not.toContain('password=')
  })

  // 401 — 비밀번호 안내 + 로그인으로 가는 링크(#677 막다른 화면 방지).
  test('401 이면 비밀번호 안내와 로그인 링크를 보인다', async () => {
    const { user } = renderLanding('sl_401', () => new HttpResponse(null, { status: 401 }))
    await user.click(screen.getByTestId('share-download-btn'))
    expect(await screen.findByTestId('share-error-msg')).toHaveTextContent('비밀번호가 필요하거나 올바르지 않습니다')
    expect(screen.getByTestId('share-error-login-link')).toHaveAttribute('href', '/login')
  })

  // 410 — 만료·폐기 안내와 다음 행동, 로그인 링크는 없다(#677).
  test('410 이면 만료 안내와 다음 행동을 보이고 로그인 링크는 없다', async () => {
    const { user } = renderLanding('sl_410', () => new HttpResponse(null, { status: 410 }))
    await user.click(screen.getByTestId('share-download-btn'))
    expect(await screen.findByTestId('share-error-msg')).toHaveTextContent('만료되었거나 폐기된 링크입니다')
    expect(screen.getByTestId('share-error-action')).toHaveTextContent('새 링크를 요청하세요')
    expect(screen.queryByTestId('share-error-login-link')).not.toBeInTheDocument()
  })

  // #677: 앱 셸 밖 독립 화면이라 브랜드 링크(/)로 앱에 돌아갈 수 있다.
  test('브랜드 링크로 앱 홈에 돌아갈 수 있다', () => {
    renderLanding('sl_abc', () => new HttpResponse(null, { status: 404 }))
    expect(screen.getByRole('link', { name: 'Gen:iA Works' })).toHaveAttribute('href', '/')
  })
})
