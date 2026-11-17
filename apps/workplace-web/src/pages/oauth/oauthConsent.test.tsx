// OAuth 동의 화면(/oauth/authorize, WP-1686) 화면 테스트 — 쿼리 → validate → 카드, 허용·거부 → 승인 POST 본문 → 이동(leaveTo),
// 오류 상태(redirect 없는 오류·앱으로 돌려보내는 오류·일시 실패·AI 계정·프레임 안)를 MSW 로 지킨다.
// 브라우저 이동(window.location.replace)은 jsdom 에서 일어나지 않으므로 leaveTo 를 vi.mock 으로 막고 부른 주소를 본다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isFramed, leaveTo, loadedDocumentUrl } from '@/lib/oauthConsent'
import { renderScreen } from '@/test/renderScreen'
import { testAuthValue } from '@/test/renderWithProviders'
import type { AuthorizeDecisionRequest } from '@/types/oauth'

import { AUTH_PATH, TWO_WORKSPACES, validated } from '../../../e2e/factories/oauth.factory'
import OAuthConsentPage from './OAuthConsentPage'

// 이동·프레임 판정·문서를 받은 주소만 막는다 — 나머지 순수 판정(decisionBody·readAuthorizeError 등)은 실제 구현 그대로.
// 문서를 받은 주소는 기본 undefined(확인할 수 없음 = 그대로 그림)로 두고, 다시 받기 테스트만 값을 준다.
vi.mock('@/lib/oauthConsent', async (orig) => ({
  ...(await orig<typeof import('@/lib/oauthConsent')>()),
  leaveTo: vi.fn(),
  isFramed: vi.fn(() => false),
  loadedDocumentUrl: vi.fn(() => undefined),
}))

const VALIDATE_URL = '/api/v1/oauth/authorize/validate'
const DECIDE_URL = '/api/v1/oauth/authorize'
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'

/** 승인 본문에 늘 실리는 인가 요청 파라미터(AUTH_PATH 를 서버처럼 디코드한 값). */
const REQUEST_FIELDS = {
  responseType: 'code',
  clientId: 'swc_1',
  redirectUri: CALLBACK,
  codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  codeChallengeMethod: 'S256',
  state: 'st-1',
  resource: 'https://mcp.example/mcp',
}

/** validate 핸들러 — 받은 URL 을 모은다. */
function validateHandler(respond: () => Response, seen: URL[] = []) {
  return http.get(VALIDATE_URL, ({ request }) => {
    seen.push(new URL(request.url))
    return respond()
  })
}

/** 승인 핸들러 — 받은 본문을 모은다. */
function decideHandler(respond: (body: AuthorizeDecisionRequest) => Response, bodies: AuthorizeDecisionRequest[] = []) {
  return http.post(DECIDE_URL, async ({ request }) => {
    const body = (await request.json()) as AuthorizeDecisionRequest
    bodies.push(body)
    return respond(body)
  })
}

/** 받은 결정대로 앱 콜백 주소를 돌려주는 승인 응답. */
function redirectFor(body: AuthorizeDecisionRequest) {
  const tail = body.decision === 'ALLOW' ? 'code=c1&state=st-1' : 'error=access_denied&state=st-1'
  return HttpResponse.json({ redirectUrl: `${CALLBACK}?${tail}` })
}

/** 동의 카드가 그려질 때까지 기다린다(h1 「Claude 연결」). */
async function cardShown() {
  return screen.findByRole('heading', { level: 1, name: 'Claude 연결' })
}

/** dl 의 dt 이름으로 같은 줄의 dd 를 찾는다. */
function valueOf(label: string) {
  // 셀렉트 줄은 dt 안에 label 이 있어 getByText 가 둘을 함께 잡으므로 dt 를 글자로 직접 고른다.
  const dt = Array.from(document.querySelectorAll('dt')).find((el) => el.textContent === label)
  const dd = dt?.nextElementSibling
  if (!dd) throw new Error(`${label} 값 칸이 없다`)
  return dd as HTMLElement
}

beforeEach(() => {
  vi.mocked(leaveTo).mockClear()
  vi.mocked(isFramed).mockReset().mockReturnValue(false)
  vi.mocked(loadedDocumentUrl).mockReset().mockReturnValue(undefined)
})

describe('OAuth 동의 화면 — 요청 확인과 카드', () => {
  it('쿼리를 그대로 validate 로 넘긴다', async () => {
    const seen: URL[] = []
    renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH + '&state=st-2',
      handlers: [validateHandler(() => HttpResponse.json(validated()), seen)],
    })
    await cardShown()
    expect(seen).toHaveLength(1)
    expect(seen[0].searchParams.getAll('state')).toEqual(['st-1', 'st-2'])
    expect(seen[0].searchParams.get('redirect_uri')).toBe(CALLBACK)
  })

  it('확인하는 동안 상태 문구를 보인다', async () => {
    renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [validateHandler(() => HttpResponse.json(validated()))],
    })
    expect(screen.getByRole('status')).toHaveTextContent('연결 요청을 확인하는 중…')
    await cardShown()
  })

  it('워크스페이스가 하나면 이름만 보인다', async () => {
    renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [validateHandler(() => HttpResponse.json(validated()))],
    })
    await cardShown()
    expect(screen.getByText('claude.ai')).toBeInTheDocument()
    expect(valueOf('워크스페이스')).toHaveTextContent('Work Loop')
    expect(screen.queryByRole('combobox')).toBeNull()
    const account = valueOf('계정')
    expect(within(account).getByText('Tester')).toHaveClass('font-semibold')
    expect(within(account).getByText('tester@example.com')).toBeInTheDocument()
    expect(valueOf('권한')).toHaveTextContent('내 권한 그대로 · 읽기·쓰기')
    expect(valueOf('권한')).toHaveTextContent('이슈·노트·드라이브·메일·채널·캘린더·연락처')
    expect(screen.getByText('연결 끊기: 설정 › API 토큰 › 연결된 앱')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /연결 끊기/ })).toBeNull()
  })

  it('워크스페이스가 둘이면 고르고 허용하면 고른 tenantId 로 한 번 보내고 받은 주소로 간다', async () => {
    const bodies: AuthorizeDecisionRequest[] = []
    const { user } = renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [validateHandler(() => HttpResponse.json(TWO_WORKSPACES)), decideHandler(redirectFor, bodies)],
    })
    await cardShown()
    const trigger = screen.getByRole('combobox', { name: '워크스페이스' })
    expect(trigger).toHaveTextContent('Gen:iA Lab')
    // Radix Select 는 jsdom 에 없는 포인터 캡처를 쓰므로 키보드로 열고 고른다.
    trigger.focus()
    await user.keyboard('{Enter}')
    const option = await screen.findByRole('option', { name: 'Work Loop' })
    option.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(trigger).toHaveTextContent('Work Loop'))

    await user.click(screen.getByRole('button', { name: '허용' }))
    expect(await screen.findByRole('status')).toHaveTextContent('앱으로 돌아가는 중…')
    expect(bodies).toEqual([{ ...REQUEST_FIELDS, tenantId: 1, decision: 'ALLOW' }])
    expect(leaveTo).toHaveBeenCalledTimes(1)
    expect(leaveTo).toHaveBeenCalledWith(`${CALLBACK}?code=c1&state=st-1`)
  })

  it('거부하면 DENY 를 보내고 받은 주소로 간다', async () => {
    const bodies: AuthorizeDecisionRequest[] = []
    const { user } = renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [validateHandler(() => HttpResponse.json(validated())), decideHandler(redirectFor, bodies)],
    })
    await cardShown()
    await user.click(screen.getByRole('button', { name: '거부' }))
    await waitFor(() => expect(leaveTo).toHaveBeenCalledWith(`${CALLBACK}?error=access_denied&state=st-1`))
    expect(bodies).toEqual([{ ...REQUEST_FIELDS, tenantId: 1, decision: 'DENY' }])
    expect(leaveTo).toHaveBeenCalledTimes(1)
  })

  it('확인되지 않은 앱이면 배지와 안내 줄, 아니면 없다', async () => {
    const notice = 'Gen:iA Works 가 확인하지 않은 앱입니다. 위 주소가 연결하려던 앱이 맞는지 확인하세요.'
    const first = renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [validateHandler(() => HttpResponse.json(validated({ unverified: true })))],
    })
    await cardShown()
    expect(screen.getByText('확인되지 않은 앱')).toHaveClass('bg-warning-subtle', 'text-warning-text')
    expect(screen.getByText(notice)).toBeInTheDocument()
    first.unmount()

    renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [validateHandler(() => HttpResponse.json(validated({ unverified: false })))],
    })
    await cardShown()
    expect(screen.queryByText('확인되지 않은 앱')).toBeNull()
    expect(screen.queryByText(notice)).toBeNull()
  })

  it('화면을 떠났다 같은 주소로 다시 열면 validate 를 다시 부른다', async () => {
    // 떠남(언마운트)·다시 열기를 같은 QueryClient 안에서 흉내 낸다 — renderScreen 을 두 번 부르면 캐시가 새로 생겨 확인이 안 된다.
    function Toggle() {
      const [shown, setShown] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setShown((v) => !v)}>
            화면 바꾸기
          </button>
          {shown && <OAuthConsentPage />}
        </>
      )
    }
    const seen: URL[] = []
    const { user, queryClient } = renderScreen(<Toggle />, {
      path: AUTH_PATH,
      handlers: [validateHandler(() => HttpResponse.json(validated()), seen)],
    })
    await cardShown()
    expect(seen).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: '화면 바꾸기' }))
    expect(screen.queryByRole('heading', { level: 1, name: 'Claude 연결' })).toBeNull()
    // 관찰자가 빠지면 검증 결과를 캐시에서 버린다(gcTime 0) — 오래 남겨 두면 다시 열 때 옛 결과로 카드를 그린다.
    await waitFor(() => expect(queryClient.getQueryCache().findAll({ queryKey: ['oauth-authorize'] })).toHaveLength(0), {
      timeout: 1000,
    })

    await user.click(screen.getByRole('button', { name: '화면 바꾸기' }))
    await cardShown()
    expect(seen).toHaveLength(2)
  })

  it('이메일이 없으면 아이디를 보인다', async () => {
    renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [validateHandler(() => HttpResponse.json(validated()))],
      auth: { user: { ...testAuthValue.user!, email: null } },
    })
    await cardShown()
    expect(within(valueOf('계정')).getByText('tester')).toBeInTheDocument()
  })

  it('워크스페이스가 없으면 안내를 보이고 허용은 꺼지고 거부는 된다', async () => {
    const bodies: AuthorizeDecisionRequest[] = []
    const { user } = renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [
        validateHandler(() => HttpResponse.json(validated({ workspaces: [], currentTenantId: null }))),
        decideHandler(redirectFor, bodies),
      ],
    })
    await cardShown()
    expect(valueOf('워크스페이스')).toHaveTextContent('연결할 수 있는 워크스페이스가 없습니다')
    expect(screen.getByRole('button', { name: '허용' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '거부' }))
    await waitFor(() => expect(leaveTo).toHaveBeenCalledWith(`${CALLBACK}?error=access_denied&state=st-1`))
    expect(bodies).toEqual([{ ...REQUEST_FIELDS, tenantId: null, decision: 'DENY' }])
  })
})

describe('OAuth 동의 화면 — 한 번만 보내기·자동 포커스 없음', () => {
  // 두 번째 클릭은 다시 그리기 전이라 disabled 가 아직 없다 — ref 막음만이 두 번째 POST 를 막는다. 먼저 누른 쪽 결정이 간다.
  it.each([
    { title: '같은 틱에 허용을 두 번 눌러도 POST 는 한 번', first: '허용', second: '허용', sent: 'ALLOW' },
    { title: '거부와 허용을 같은 틱에 눌러도 POST 는 한 번', first: '거부', second: '허용', sent: 'DENY' },
  ])('$title', async ({ first, second, sent }) => {
    const bodies: AuthorizeDecisionRequest[] = []
    renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [validateHandler(() => HttpResponse.json(validated())), decideHandler(redirectFor, bodies)],
    })
    await cardShown()
    const firstButton = screen.getByRole('button', { name: first })
    const secondButton = screen.getByRole('button', { name: second })
    act(() => {
      firstButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      secondButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await waitFor(() => expect(leaveTo).toHaveBeenCalledTimes(1))
    expect(bodies).toHaveLength(1)
    expect(bodies[0].decision).toBe(sent)
  })

  it('보내는 동안 두 단추가 모두 꺼지고 바쁨 표시가 붙는다', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { user } = renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [
        validateHandler(() => HttpResponse.json(validated())),
        http.post(DECIDE_URL, async () => {
          await gate
          return HttpResponse.json({ redirectUrl: `${CALLBACK}?code=c1&state=st-1` })
        }),
      ],
    })
    await cardShown()
    await user.click(screen.getByRole('button', { name: '허용' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '허용' })).toBeDisabled())
    expect(screen.getByRole('button', { name: '거부' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '허용' })).toHaveAttribute('aria-busy', 'true')
    release()
    await waitFor(() => expect(leaveTo).toHaveBeenCalledTimes(1))
  })

  it('열자마자 허용에 포커스가 없다', async () => {
    const bodies: AuthorizeDecisionRequest[] = []
    const { user } = renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [validateHandler(() => HttpResponse.json(validated())), decideHandler(redirectFor, bodies)],
    })
    await cardShown()
    const allow = screen.getByRole('button', { name: '허용' })
    expect(document.activeElement).not.toBe(allow)
    await user.keyboard('{Enter}')
    // Enter 가 무엇이든 보냈다면 그 요청이 MSW 에 닿을 때까지 남은 일(마이크로태스크·React 갱신)을 비운 뒤 0건을 본다.
    await act(async () => {})
    expect(bodies).toHaveLength(0)
    expect(leaveTo).not.toHaveBeenCalled()
  })
})

describe('OAuth 동의 화면 — 오류', () => {
  it('등록 안 된 redirect_uri 면 오류 카드만 보이고 어디로도 가지 않는다', async () => {
    renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [
        validateHandler(() =>
          HttpResponse.json(
            { error: 'invalid_redirect_uri', errorDescription: '등록되지 않은 redirect_uri 입니다.' },
            { status: 400 },
          ),
        ),
      ],
    })
    expect(await screen.findByRole('heading', { level: 1, name: '연결할 수 없습니다' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('등록되지 않은 redirect_uri 입니다.')
    expect(screen.getByText('이 창을 닫고 연결하려던 앱에서 다시 시도해 주세요.')).toBeInTheDocument()
    expect(screen.getByText('invalid_redirect_uri')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Gen:iA Works 로 가기' })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('button', { name: '허용' })).toBeNull()
    expect(leaveTo).not.toHaveBeenCalled()
  })

  it('서버가 오류 설명을 주지 않으면 기본 문구를 보인다', async () => {
    renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [validateHandler(() => HttpResponse.json({ error: 'invalid_client' }, { status: 400 }))],
    })
    expect(await screen.findByRole('heading', { level: 1, name: '연결할 수 없습니다' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('연결 요청을 처리하지 못했습니다.')
    expect(screen.getByText('invalid_client')).toBeInTheDocument()
  })

  it('validate 오류에 errorRedirectUrl 이 있으면 그 주소로 바로 간다', async () => {
    const back = `${CALLBACK}?error=invalid_request&state=st-1`
    renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [
        validateHandler(() =>
          HttpResponse.json(
            { error: 'invalid_request', errorDescription: 'PKCE 가 필요합니다.', errorRedirectUrl: back },
            { status: 400 },
          ),
        ),
      ],
    })
    // 확인 중에도 status 가 있으므로 이동 중 문구를 글자로 기다린다.
    expect(await screen.findByText('앱으로 돌아가는 중…')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('앱으로 돌아가는 중…')
    await waitFor(() => expect(leaveTo).toHaveBeenCalledWith(back))
    expect(leaveTo).toHaveBeenCalledTimes(1)
  })

  it('errorRedirectUrl 이 javascript: 면 이동하지 않고 오류 카드', async () => {
    renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [
        validateHandler(() =>
          HttpResponse.json(
            { error: 'invalid_request', errorDescription: 'x', errorRedirectUrl: 'javascript:alert(1)' },
            { status: 400 },
          ),
        ),
      ],
    })
    expect(await screen.findByRole('heading', { level: 1, name: '연결할 수 없습니다' })).toBeInTheDocument()
    expect(screen.queryByText('앱으로 돌아가는 중…')).toBeNull()
    expect(leaveTo).not.toHaveBeenCalled()
  })

  it('쿼리 없이 열면 오류 카드', async () => {
    const seen: URL[] = []
    renderScreen(<OAuthConsentPage />, {
      path: '/oauth/authorize',
      handlers: [
        validateHandler(
          () => HttpResponse.json({ error: 'invalid_client', errorDescription: 'client_id 가 없습니다.' }, { status: 400 }),
          seen,
        ),
      ],
    })
    expect(await screen.findByRole('heading', { level: 1, name: '연결할 수 없습니다' })).toBeInTheDocument()
    expect(seen).toHaveLength(1)
    expect(seen[0].search).toBe('')
    // search 는 끝의 빈 '?' 도 '' 로 보이므로 주소 전체로 '?' 를 붙여 보내지 않았는지 본다.
    expect(seen[0].href.endsWith('/api/v1/oauth/authorize/validate')).toBe(true)
    expect(screen.getByRole('alert')).toHaveTextContent('client_id 가 없습니다.')
    expect(leaveTo).not.toHaveBeenCalled()
  })

  it('승인 400 단독이면 단추 위에 서버 문구를 보이고 단추를 다시 켠다', async () => {
    const bodies: AuthorizeDecisionRequest[] = []
    const { user } = renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [
        validateHandler(() => HttpResponse.json(validated())),
        decideHandler(
          () => HttpResponse.json({ error: 'invalid_request', errorDescription: '이 워크스페이스는 쓸 수 없습니다.' }, { status: 400 }),
          bodies,
        ),
      ],
    })
    await cardShown()
    await user.click(screen.getByRole('button', { name: '허용' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('이 워크스페이스는 쓸 수 없습니다.')
    expect(screen.getByRole('heading', { level: 1, name: 'Claude 연결' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '허용' })).toBeEnabled())
    expect(screen.getByRole('button', { name: '거부' })).toBeEnabled()
    expect(leaveTo).not.toHaveBeenCalled()
    // 다시 켠 단추는 다시 보낼 수 있다(진행 중 막음이 풀렸다).
    await user.click(screen.getByRole('button', { name: '허용' }))
    await waitFor(() => expect(bodies).toHaveLength(2))
  })

  it('승인 400 에 서버 문구가 없으면 단추 위에 기본 문구를 보인다', async () => {
    const { user } = renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [
        validateHandler(() => HttpResponse.json(validated())),
        decideHandler(() => HttpResponse.json({ error: 'invalid_request' }, { status: 400 })),
      ],
    })
    await cardShown()
    await user.click(screen.getByRole('button', { name: '허용' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('연결 요청을 처리하지 못했습니다.')
  })

  it('승인 400 + errorRedirectUrl 이면 그 주소로 간다', async () => {
    const back = `${CALLBACK}?error=invalid_request&state=st-1`
    const { user } = renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [
        validateHandler(() => HttpResponse.json(validated())),
        decideHandler(() =>
          HttpResponse.json({ error: 'invalid_request', errorDescription: 'x', errorRedirectUrl: back }, { status: 400 }),
        ),
      ],
    })
    await cardShown()
    await user.click(screen.getByRole('button', { name: '허용' }))
    expect(await screen.findByRole('status')).toHaveTextContent('앱으로 돌아가는 중…')
    expect(leaveTo).toHaveBeenCalledWith(back)
    expect(leaveTo).toHaveBeenCalledTimes(1)
  })

  it('승인 500 이면 잠시 뒤 다시 눌러 주세요', async () => {
    const { user } = renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [
        validateHandler(() => HttpResponse.json(validated())),
        decideHandler(() => HttpResponse.json({ message: 'boom' }, { status: 500 })),
      ],
    })
    await cardShown()
    await user.click(screen.getByRole('button', { name: '허용' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('잠시 뒤 다시 눌러 주세요.')
    await waitFor(() => expect(screen.getByRole('button', { name: '허용' })).toBeEnabled())
    expect(leaveTo).not.toHaveBeenCalled()
  })

  it('승인 redirectUrl 이 javascript: 면 이동하지 않고 오류 카드', async () => {
    const { user } = renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [
        validateHandler(() => HttpResponse.json(validated())),
        decideHandler(() => HttpResponse.json({ redirectUrl: 'javascript:alert(1)' })),
      ],
    })
    await cardShown()
    await user.click(screen.getByRole('button', { name: '허용' }))
    expect(await screen.findByRole('heading', { level: 1, name: '연결할 수 없습니다' })).toBeInTheDocument()
    expect(screen.queryByText('앱으로 돌아가는 중…')).toBeNull()
    expect(leaveTo).not.toHaveBeenCalled()
  })

  it('validate 500 이면 다시 시도로 다시 불러 카드를 그린다', async () => {
    let calls = 0
    const { user } = renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [
        validateHandler(() => {
          calls += 1
          return calls === 1 ? HttpResponse.json({ message: 'boom' }, { status: 500 }) : HttpResponse.json(validated())
        }),
      ],
    })
    expect(await screen.findByRole('heading', { level: 1, name: '연결 요청을 확인하지 못했습니다' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    await cardShown()
    expect(calls).toBe(2)
  })
})

describe('OAuth 동의 화면 — 막음', () => {
  it('AI 계정이면 사람 계정 전용을 보이고 validate 를 부르지 않는다', async () => {
    const seen: URL[] = []
    renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [validateHandler(() => HttpResponse.json(validated()), seen)],
      auth: { user: { ...testAuthValue.user!, kind: 'AGENT' } },
    })
    expect(await screen.findByRole('heading', { level: 1, name: '사람 계정 전용' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'AI 계정으로는 앱을 연결할 수 없습니다. 사람 계정으로 로그인해 다시 시도해 주세요.',
    )
    // 막음 카드는 첫 렌더에 동기로 그려지고 그때 validate 가 꺼져 있다 — 기다릴 일이 없다.
    expect(seen).toHaveLength(0)
  })

  it('사람인데 403 이면 서버 문구 오류 카드', async () => {
    renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [
        validateHandler(() =>
          HttpResponse.json(
            { status: 403, error: 'Forbidden', message: '웹 로그인 세션에서만 앱을 연결할 수 있습니다.' },
            { status: 403 },
          ),
        ),
      ],
    })
    expect(await screen.findByRole('heading', { level: 1, name: '연결할 수 없습니다' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('웹 로그인 세션에서만 앱을 연결할 수 있습니다.')
    expect(leaveTo).not.toHaveBeenCalled()
  })

  it('프레임 안이면 막음 문구만, validate 를 부르지 않는다', async () => {
    vi.mocked(isFramed).mockReturnValue(true)
    const seen: URL[] = []
    renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [validateHandler(() => HttpResponse.json(validated()), seen)],
    })
    expect(await screen.findByRole('heading', { level: 1, name: '연결할 수 없습니다' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('이 화면은 다른 화면 안에서 열 수 없습니다.')
    expect(screen.queryByRole('button', { name: '허용' })).toBeNull()
    // 막음 카드는 첫 렌더에 동기로 그려지고(isFramed 를 useState 초기값으로 판정) 그때 validate 가 꺼져 있다 — 기다릴 일이 없다.
    expect(seen).toHaveLength(0)
  })
})

describe('OAuth 동의 화면 — 프레임 금지 헤더를 받은 문서에서만 그린다', () => {
  it('다른 경로(SSO 완료)에서 받은 문서면 validate 를 부르지 않고 같은 쿼리의 /oauth/authorize 로 문서를 다시 받는다', async () => {
    // 로그인 뒤 SPA 이동으로 들어온 경우 — 문서는 'self' 헤더의 /sso/complete 에서 받았다.
    vi.mocked(loadedDocumentUrl).mockReturnValue('http://localhost/sso/complete')
    const seen: URL[] = []
    renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [validateHandler(() => HttpResponse.json(validated()), seen)],
    })
    expect(screen.getByRole('status')).toHaveTextContent('연결 요청을 확인하는 중…')
    await waitFor(() => expect(leaveTo).toHaveBeenCalledWith(AUTH_PATH))
    // 남은 효과·요청이 있었다면 그것까지 비운 뒤 한 번만 떠났고 validate 가 없었는지 본다.
    await act(async () => {})
    expect(leaveTo).toHaveBeenCalledTimes(1)
    expect(seen).toHaveLength(0)
    expect(screen.queryByRole('button', { name: '허용' })).toBeNull()
  })

  it('끝 슬래시·대소문자가 다른 주소로 받은 문서면 정확한 /oauth/authorize 로 다시 받는다', async () => {
    const query = AUTH_PATH.slice(AUTH_PATH.indexOf('?'))
    vi.mocked(loadedDocumentUrl).mockReturnValue(`http://localhost/OAuth/Authorize/${query}`)
    const seen: URL[] = []
    renderScreen(<OAuthConsentPage />, {
      path: `/OAuth/Authorize/${query}`,
      handlers: [validateHandler(() => HttpResponse.json(validated()), seen)],
    })
    await waitFor(() => expect(leaveTo).toHaveBeenCalledWith(`/oauth/authorize${query}`))
    expect(leaveTo).toHaveBeenCalledTimes(1)
    expect(seen).toHaveLength(0)
  })

  it('/oauth/authorize 로 받은 문서면 다시 받지 않고 카드를 그린다(다시 받은 뒤 무한 이동 없음)', async () => {
    vi.mocked(loadedDocumentUrl).mockReturnValue(`http://localhost${AUTH_PATH}`)
    const seen: URL[] = []
    renderScreen(<OAuthConsentPage />, {
      path: AUTH_PATH,
      handlers: [validateHandler(() => HttpResponse.json(validated()), seen)],
    })
    await cardShown()
    expect(seen).toHaveLength(1)
    expect(leaveTo).not.toHaveBeenCalled()
  })
})
