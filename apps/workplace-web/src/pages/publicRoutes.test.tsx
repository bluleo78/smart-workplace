// 로그인 밖 공개 라우트 화면 테스트(WP-971, WP-995) — 로그인 폼·Microsoft 로그인·SSO 완료·M365 OAuth 콜백·알림 탭 진입점.
// 폼 → payload, 서버 오류 → 문구, 주소 파라미터 → 배너, 응답 → 이동 주소는 브라우저 없이 판정되므로 아래 E2E 에서 옮겼다:
//   e2e/pages/login-username.spec.ts(전부)·e2e/pages/auth/login-sso.spec.ts(전부)·e2e/pages/auth/sso-complete.spec.ts·
//   e2e/pages/oauth/m365-callback.spec.ts·e2e/pages/pwa/push-open.spec.ts
// 각 화면의 배선 1건(@wiring)과 서비스워커 메시지(@platform)는 E2E 에 남는다.
// 인증 흐름(login·completeSsoLogin·selectTenant)은 화면이 아니라 AuthProvider 에 있어, 고정 AuthContext 대신 실제 AuthProvider 를
// 화면과 함께 renderScreen 안에 띄운다(App·앱 셸 없이). 알림 탭 진입점의 소속 확인처럼 인증 흐름을 거치지 않는 경우만 고정 값을 쓴다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { type ReactNode } from 'react'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { AuthContext } from '@/hooks/auth-context-value'
import { AuthProvider } from '@/hooks/AuthContext'
import { useAuth } from '@/hooks/useAuth'
import { PENDING_PUSH_TARGET_KEY } from '@/lib/push/openTarget'
import LoginPage from '@/pages/LoginPage'
import M365CallbackPage from '@/pages/oauth/M365CallbackPage'
import PushOpenPage from '@/pages/PushOpenPage'
import SsoCompletePage from '@/pages/SsoCompletePage'
import { renderScreen } from '@/test/renderScreen'

import { createLoginResponse, createMembership, createTokenResponse, createUser } from '../../e2e/factories/auth.factory'

const API = '/api/v1'
const T1 = createMembership({ tenantId: 1, tenantName: 'A', tenantSlug: 'a' })
const T2 = createMembership({ tenantId: 2, tenantName: 'B', tenantSlug: 'b' })

/** 로그인 화면이 마운트 때 부르는 가입·SSO 가용성 조회. */
const loginPageHandlers = (m365 = false) => [
  http.get(`${API}/auth/signup-available`, () => HttpResponse.json({ available: true })),
  http.get(`${API}/auth/sso/status`, () => HttpResponse.json({ m365 })),
]

/** 실제 AuthProvider 아래 로그인·SSO 완료 라우트를 띄운다 — 다른 주소로 가면 「도착」 자리표시가 보인다. */
function renderAuthRoutes(path: string, handlers: RequestHandler[]) {
  return renderScreen(
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/login/sso/complete" element={<SsoCompletePage />} />
        <Route path="*" element={<div>도착</div>} />
      </Routes>
    </AuthProvider>,
    { path, handlers },
  )
}

afterEach(() => {
  window.sessionStorage.clear()
})

describe('로그인 폼', () => {
  // 아이디·이메일 분리의 전제 — zod 가 비-이메일 아이디를 막으면 회원 대부분이 로그인하지 못한다.
  test('비-이메일 아이디로 로그인하면 그 아이디가 그대로 payload 로 나간다', async () => {
    const bodies: unknown[] = []
    const { user } = renderAuthRoutes('/login', [
      ...loginPageHandlers(),
      http.post(`${API}/auth/login`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json(createLoginResponse())
      }),
      http.get(`${API}/users/me`, () => HttpResponse.json({ ...createUser(), roles: [] })),
    ])
    await user.type(await screen.findByLabelText('아이디'), 'jane')
    await user.type(document.querySelector('#password')!, 'Password123')
    await user.click(screen.getByRole('button', { name: '로그인' }))
    await waitFor(() => expect(bodies).toEqual([{ username: 'jane', password: 'Password123' }]))
    // 단일 소속 → 바로 진입(로그인 화면이 / 로 보낸다).
    expect(await screen.findByText('도착')).toBeInTheDocument()
  })

  // WP-763 — 속도 제한(429)은 비밀번호 오류 문구가 아니라 서버 안내를 그대로 보여야 사용자가 기다릴 줄 안다.
  test('로그인이 속도 제한(429)에 걸리면 서버 안내를 그대로 보인다', async () => {
    const { user } = renderAuthRoutes('/login', [
      ...loginPageHandlers(),
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json(
          { status: 429, error: 'Too Many Requests', message: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.', errors: null, timestamp: '2026-01-01T00:00:00Z', path: '/api/v1/auth/login' },
          { status: 429, headers: { 'Retry-After': '3' } },
        ),
      ),
    ])
    await user.type(await screen.findByLabelText('아이디'), 'jane')
    await user.type(document.querySelector('#password')!, 'Password123')
    await user.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByText('요청이 너무 많습니다. 잠시 후 다시 시도하세요.')).toBeInTheDocument()
    expect(screen.queryByText('아이디 또는 비밀번호가 올바르지 않습니다.')).not.toBeInTheDocument()
  })
})

describe('Microsoft 로그인(WP-48)', () => {
  // 버튼은 SPA 이동이 아닌 <a> 전체 이동이다 — 서버 start 가 302 로 Microsoft 에 보낸다. 링크 주소의 returnTo 가 로그인 뒤 복귀 대상.
  test('SSO 가 설정되면 버튼이 보이고 start 로 returnTo=/ 를 붙여 이동한다', async () => {
    renderAuthRoutes('/login', loginPageHandlers(true))
    const link = await screen.findByRole('link', { name: 'Microsoft 계정으로 로그인' })
    const href = new URL(link.getAttribute('href')!, window.location.origin)
    expect(href.pathname).toBe('/api/v1/auth/sso/start')
    expect(href.searchParams.get('returnTo')).toBe('/')
  })

  test('SSO 미설정이면 버튼을 숨긴다', async () => {
    renderAuthRoutes('/login', loginPageHandlers(false))
    await screen.findByRole('button', { name: '로그인' })
    // sso/status 응답이 도착한 뒤에도 없어야 한다.
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Microsoft 계정으로 로그인' })).not.toBeInTheDocument())
  })

  // 코드별 문구는 sso.test(ssoErrorMessage)가 지킨다 — 여기선 주소 → 배너 연결.
  test('sso_error=denied 면 등록되지 않은 계정 배너를 보인다', async () => {
    renderAuthRoutes('/login?sso_error=denied', loginPageHandlers(true))
    expect(await screen.findByRole('alert')).toHaveTextContent('등록되지 않은 Microsoft 계정입니다. 관리자에게 등록을 요청하세요.')
  })

  test('sso_notice=consented 면 관리자 동의 완료 안내를 보인다', async () => {
    renderAuthRoutes('/login?sso_notice=consented', loginPageHandlers(true))
    expect(await screen.findByRole('status')).toHaveTextContent('관리자 승인이 완료되었습니다.')
  })
})

describe('SSO 완료 라우트(WP-48)', () => {
  const ssoHandlers = (memberships: unknown[]) => [
    http.post(`${API}/auth/refresh`, () => HttpResponse.json(createTokenResponse())),
    http.get(`${API}/auth/memberships`, () => HttpResponse.json(memberships)),
  ]

  test('여러 워크스페이스면 선택 카드를 보여준다', async () => {
    renderAuthRoutes('/login/sso/complete?returnTo=%2F', ssoHandlers([T1, T2]))
    expect(await screen.findByText('워크스페이스 선택')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-option-2')).toBeInTheDocument()
  })

  test('워크스페이스가 없으면 안내한다', async () => {
    renderAuthRoutes('/login/sso/complete', ssoHandlers([]))
    expect(await screen.findByText('접속 가능한 워크스페이스가 없습니다. 관리자에게 문의하세요.')).toBeInTheDocument()
  })

  // 외부 returnTo 정제는 sso.test(safeReturnTo)가 지킨다.
  test('refresh 가 실패하면 로그인으로 되돌리며 retry 오류를 붙인다', async () => {
    const { location } = renderAuthRoutes('/login/sso/complete', [
      http.post(`${API}/auth/refresh`, () => HttpResponse.json({ message: 'x' }, { status: 401 })),
      ...loginPageHandlers(false),
    ])
    await waitFor(() => expect(location()).toBe('/login?sso_error=retry'))
    expect(await screen.findByRole('alert')).toHaveTextContent('로그인 처리 중 문제가 발생했습니다. 다시 시도해 주세요.')
  })
})

describe('M365 OAuth 콜백(팝업)', () => {
  // 콜백 페이지는 실제로 늘 팝업이라 opener 가 있다 — 없으면 /settings/mail 로 가는 다른 경로를 탄다.
  function withOpener() {
    const postMessage = vi.fn()
    Object.defineProperty(window, 'opener', { configurable: true, value: { postMessage } })
    return postMessage
  }
  afterEach(() => {
    Object.defineProperty(window, 'opener', { configurable: true, value: null })
  })

  test('동의 거부(error 파라미터)면 백엔드 호출 없이 실패 UI 와 opener 통지', async () => {
    const posted = withOpener()
    let completes = 0
    renderScreen(<M365CallbackPage />, {
      // 실제 AAD 거부 응답처럼 state 를 함께 받는다 — error 만 보고 교환을 건너뛰는지 본다.
      path: '/oauth/m365/callback?error=access_denied&state=STATE123',
      handlers: [http.post(`${API}/mail/oauth/m365/complete`, () => (completes++, HttpResponse.json({ connected: true })))],
    })
    expect(await screen.findByText('연결에 실패했습니다.')).toBeInTheDocument()
    expect(posted).toHaveBeenCalledWith({ source: 'm365-oauth', ok: false, error: 'access_denied' }, window.location.origin)
    expect(completes).toBe(0)
  })

  test('백엔드가 400 이면 실패 UI 와 connect_failed 통지', async () => {
    const posted = withOpener()
    const bodies: unknown[] = []
    renderScreen(<M365CallbackPage />, {
      path: '/oauth/m365/callback?code=AUTHCODE&state=BAD',
      handlers: [
        http.post(`${API}/mail/oauth/m365/complete`, async ({ request }) => {
          bodies.push(await request.json())
          return HttpResponse.json({ connected: false, error: 'invalid_request' }, { status: 400 })
        }),
      ],
    })
    expect(await screen.findByText('연결에 실패했습니다.')).toBeInTheDocument()
    expect(bodies).toEqual([{ code: 'AUTHCODE', state: 'BAD' }])
    expect(posted).toHaveBeenCalledWith({ source: 'm365-oauth', ok: false, error: 'connect_failed' }, window.location.origin)
  })
})

describe('알림 탭 진입점 /push-open', () => {
  const pushRoutes = (
    <Routes>
      <Route path="/push-open" element={<PushOpenPage />} />
      <Route path="*" element={<div>도착</div>} />
    </Routes>
  )
  const memberships = http.get(`${API}/auth/memberships`, () => HttpResponse.json([T1, T2]))

  test('소속되지 않은 테넌트면 안내하고 홈으로 보낸다', async () => {
    const { location } = renderScreen(pushRoutes, {
      path: '/push-open?t=77&to=' + encodeURIComponent('/chat/dms/42'),
      handlers: [memberships],
      auth: { activeTenant: T1 },
    })
    expect(await screen.findByText('해당 워크스페이스에 접근할 수 없습니다')).toBeInTheDocument()
    expect(location()).toBe('/')
  })

  // 같은 origin 상대경로만 — 알림 payload 의 url 로 외부 사이트에 보내지 않는다.
  test('외부 url 은 홈으로 보낸다', async () => {
    const { location } = renderScreen(pushRoutes, { path: '/push-open?t=1&to=' + encodeURIComponent('//evil.com'), auth: { activeTenant: T1 } })
    await waitFor(() => expect(location()).toBe('/'))
  })

  test('미로그인이면 목적지를 보관하고 로그인으로 보낸다', async () => {
    const { location } = renderScreen(pushRoutes, {
      path: '/push-open?t=1&to=' + encodeURIComponent('/calendar'),
      auth: { user: null, isAuthenticated: false, activeTenant: null },
    })
    await waitFor(() => expect(location()).toBe('/login'))
    expect(JSON.parse(window.sessionStorage.getItem(PENDING_PUSH_TARGET_KEY)!)).toEqual({ tenantId: 1, url: '/calendar' })
  })

  // 다른 테넌트면 select-tenant 로 토큰을 다시 받고 목적지로 전체 리로드한다. jsdom 은 location.assign 이동을 하지 않으므로
  // 실제 AuthProvider 의 selectTenant 를 감싸 넘긴 목적지를 기록한다(요청 payload 는 MSW 로 본다).
  test('다른 테넌트면 그 테넌트로 전환하고 목적지를 넘긴다', async () => {
    window.localStorage.setItem('hasSession', 'true')
    window.localStorage.setItem('activeTenant', JSON.stringify(T1))
    const selected: unknown[] = []
    const redirects: string[] = []
    function RecordSelect({ children }: { children: ReactNode }) {
      const auth = useAuth()
      const selectTenant: typeof auth.selectTenant = async (m, to) => {
        redirects.push(to ?? '/')
        await auth.selectTenant(m, to)
      }
      return <AuthContext.Provider value={{ ...auth, selectTenant }}>{children}</AuthContext.Provider>
    }
    renderScreen(
      <AuthProvider>
        <RecordSelect>{pushRoutes}</RecordSelect>
      </AuthProvider>,
      {
        path: '/push-open?t=2&to=' + encodeURIComponent('/chat/dms/42'),
        handlers: [
          memberships,
          http.post(`${API}/auth/refresh`, () => HttpResponse.json(createTokenResponse())),
          http.get(`${API}/users/me`, () => HttpResponse.json({ ...createUser(), roles: [] })),
          http.post(`${API}/auth/select-tenant`, async ({ request }) => {
            selected.push(await request.json())
            return HttpResponse.json(createTokenResponse())
          }),
        ],
      },
    )
    await waitFor(() => expect(selected).toEqual([{ tenantId: 2 }]))
    expect(redirects).toEqual(['/chat/dms/42'])
  })
})
