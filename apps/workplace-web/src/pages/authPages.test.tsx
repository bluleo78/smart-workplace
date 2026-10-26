// 로그인·가입·세션 확인 화면 — 화면 컴포넌트 테스트(WP-971, WP-995).
// 다중/단일/무소속 로그인 분기와 select-tenant 요청·실패 안내(#219), 가입 가용성 게이트(#495), 제출·검증 오류의 알림 영역·입력칸 연결(WP-733),
// 세션 확인 일시 오류(5xx)와 만료(401)의 갈림(WP-859)은 브라우저 없이 판정되므로
// e2e/pages/tenant-selection.spec.ts · signup-availability.spec.ts · form-error-a11y.spec.ts · auth-transient-error.spec.ts 에서 옮겼다.
// 고정 AuthContext 가 아니라 실제 AuthProvider 를 화면과 함께 띄워 login()·selectTenant()·initAuth 가 MSW 응답을 지나게 한다
// (App 전체를 띄우는 renderPage 보다 가볍다). 로그인 → 전체 리로드 → 홈 착지 흐름은 tenant-selection.spec.ts 의 @flow 가 지킨다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import type { ReactNode } from 'react'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'

import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AddMemberDialog } from '@/components/users/AddMemberDialog'
import { AuthProvider } from '@/hooks/AuthContext'
import LoginPage from '@/pages/LoginPage'
import SignupPage from '@/pages/SignupPage'
import { renderScreen } from '@/test/renderScreen'

import {
  createLoginResponse,
  createMembership,
  createTokenResponse,
  createUserDetail,
} from '../../e2e/factories/auth.factory'

const ACME = createMembership({ tenantId: 10, tenantName: 'Acme', tenantSlug: 'acme' })
const GLOBEX = createMembership({ tenantId: 20, tenantName: 'Globex', tenantSlug: 'globex' })

/** 로그인·가입 화면이 마운트 때 묻는 가용성(가입·SSO). */
function availability(signup = true) {
  return [
    http.get('/api/v1/auth/signup-available', () => HttpResponse.json({ available: signup })),
    http.get('/api/v1/auth/sso/status', () => HttpResponse.json({ m365: false })),
  ]
}

/** 실제 AuthProvider 와 로그인·가입·보호 라우트를 띄운다(고정 AuthContext 를 안쪽 AuthProvider 가 덮는다). */
function Auth({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>
}

function renderAuthRoutes(path: string, handlers: RequestHandler[]) {
  return renderScreen(
    <Auth>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<div data-testid="home-landed">홈</div>} />
        </Route>
      </Routes>
    </Auth>,
    { path, handlers },
  )
}

/** 로그인 폼을 채워 제출한다 — 아이디는 zod 이메일 검증을 통과해야 요청이 나간다. */
async function submitLogin(user: ReturnType<typeof renderScreen>['user']) {
  await user.click(await screen.findByLabelText('아이디'))
  await user.paste('user@example.com')
  await user.click(document.getElementById('password') as HTMLElement)
  await user.paste('Workplace1')
  await user.click(screen.getByRole('button', { name: '로그인' }))
}

describe('로그인 → 워크스페이스 선택 (#219)', () => {
  // 다중소속이면 폼 대신 선택 카드, 고르면 그 테넌트 id 로 select-tenant 를 요청한다(이후 전체 리로드는 @flow).
  test('다중소속이면 선택 카드를 보이고, 고른 워크스페이스로 select-tenant 를 요청한다', async () => {
    const bodies: unknown[] = []
    const { user } = renderAuthRoutes('/login', [
      ...availability(),
      http.post('/api/v1/auth/login', () => HttpResponse.json(createLoginResponse({ memberships: [ACME, GLOBEX] }))),
      http.post('/api/v1/auth/select-tenant', async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json(createTokenResponse())
      }),
    ])
    await submitLogin(user)
    expect(await screen.findByText('워크스페이스 선택')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-option-20')).toBeInTheDocument()
    await user.click(screen.getByTestId('workspace-option-10'))
    await waitFor(() => expect(bodies).toEqual([{ tenantId: 10 }]))
  })

  test('단일소속이면 선택 카드 없이 내 정보를 불러 홈으로 들어간다', async () => {
    const { user, location } = renderAuthRoutes('/login', [
      ...availability(),
      http.post('/api/v1/auth/login', () => HttpResponse.json(createLoginResponse())),
      http.get('/api/v1/users/me', () => HttpResponse.json(createUserDetail())),
    ])
    await submitLogin(user)
    expect(await screen.findByTestId('home-landed')).toBeInTheDocument()
    expect(location()).toBe('/')
    expect(screen.queryByText('워크스페이스 선택')).not.toBeInTheDocument()
    expect(window.localStorage.getItem('hasSession')).toBe('true')
  })

  // 소속이 없으면 비밀번호 오류로 오해되지 않는 전용 안내 — 인증 미완료라 로그인 화면에 남는다.
  test('무소속(NO_WORKSPACE)이면 선택 카드 없이 전용 안내를 보이고 로그인 화면에 남는다', async () => {
    const { user, location } = renderAuthRoutes('/login', [
      ...availability(),
      http.post('/api/v1/auth/login', () => HttpResponse.json(createLoginResponse({ memberships: [] }))),
    ])
    await submitLogin(user)
    expect(await screen.findByText('접속 가능한 워크스페이스가 없습니다. 관리자에게 문의하세요.')).toBeInTheDocument()
    expect(screen.queryByText('워크스페이스 선택')).not.toBeInTheDocument()
    expect(location()).toBe('/login')
  })

  test('select-tenant 가 5xx 면 전환 실패 안내를 보이고 카드가 남아 다시 고를 수 있다', async () => {
    const { user } = renderAuthRoutes('/login', [
      ...availability(),
      http.post('/api/v1/auth/login', () => HttpResponse.json(createLoginResponse({ memberships: [ACME, GLOBEX] }))),
      http.post('/api/v1/auth/select-tenant', () => HttpResponse.json({ message: '서버 오류' }, { status: 500 })),
    ])
    await submitLogin(user)
    await user.click(await screen.findByTestId('workspace-option-10'))
    expect(await screen.findByText('워크스페이스 전환에 실패했습니다. 다시 시도해 주세요.')).toBeInTheDocument()
    expect(screen.getByText('워크스페이스 선택')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-option-10')).toBeEnabled()
  })
})

describe('로그인 오류의 접근성 (WP-733)', () => {
  test('틀린 비밀번호(401)의 실패 문구가 알림(role=alert)으로 읽힌다', async () => {
    const { user } = renderAuthRoutes('/login', [
      ...availability(false),
      http.post('/api/v1/auth/login', () =>
        HttpResponse.json({ status: 401, error: 'Unauthorized', message: 'Invalid credentials' }, { status: 401 }),
      ),
    ])
    await submitLogin(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('아이디 또는 비밀번호가 올바르지 않습니다.')
  })

  // 빈 칸 오류는 알림이면서 입력칸의 설명(aria-describedby)으로 이어지고, 고치면 연결이 풀린다.
  test('빈 칸 오류는 알림으로 읽히고 입력칸 설명으로 연결되며, 고치면 풀린다', async () => {
    const { user } = renderAuthRoutes('/login', availability(false))
    await user.click(await screen.findByRole('button', { name: '로그인' }))
    const username = screen.getByLabelText('아이디')
    const password = document.getElementById('password') as HTMLElement
    await waitFor(() => expect(username).toHaveAttribute('aria-invalid', 'true'))
    expect(username).toHaveAccessibleDescription('아이디를 입력하세요')
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(password).toHaveAccessibleDescription('비밀번호를 입력하세요')
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(['아이디를 입력하세요', '비밀번호를 입력하세요'])

    await user.click(username)
    await user.paste('alice@t.local')
    await waitFor(() => expect(username).not.toHaveAttribute('aria-invalid', 'true'))
    expect(username).toHaveAccessibleDescription('')
  })
})

describe('가입 가용성 게이트 (#495)', () => {
  test('가용=false 면 가입 폼 대신 안내와 로그인 링크만 보인다', async () => {
    renderAuthRoutes('/signup', availability(false))
    expect(await screen.findByText('회원가입이 비활성화되어 있습니다. 관리자에게 문의하세요.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '로그인' })).toHaveAttribute('href', '/login')
    expect(screen.queryByLabelText('아이디 (이메일)')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '회원가입' })).not.toBeInTheDocument()
  })

  // 가용=true 인데 그 사이 가입이 닫혀 POST 가 403 — 입력한 값이 요청에 실리고, 서버 문구가 알림으로 읽힌다(WP-733).
  test('가용=true 라도 가입 POST 403 이면 서버 문구를 알림으로 보인다(payload 검증)', async () => {
    const bodies: { username: string; name: string }[] = []
    const { user } = renderAuthRoutes('/signup', [
      ...availability(true),
      http.post('/api/v1/auth/signup', async ({ request }) => {
        bodies.push((await request.json()) as { username: string; name: string })
        return HttpResponse.json({ status: 403, error: 'Forbidden', message: '회원가입이 비활성화되어 있습니다.' }, { status: 403 })
      }),
    ])
    const fill = async (label: string, value: string) => {
      await user.click(await screen.findByLabelText(label, { exact: true }))
      await user.paste(value)
    }
    await fill('아이디 (이메일)', 'first@example.com')
    await fill('비밀번호', 'Password1!')
    await fill('비밀번호 확인', 'Password1!')
    await fill('이름', '첫 사용자')
    await user.click(screen.getByRole('button', { name: '회원가입' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('회원가입이 비활성화되어 있습니다.')
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ username: 'first@example.com', name: '첫 사용자' })
  })

  test('로그인 화면은 가용=false 면 회원가입 링크를 숨기고, 가용=true 면 보인다', async () => {
    const { unmount } = renderAuthRoutes('/login', availability(false))
    expect(await screen.findByRole('button', { name: '로그인' })).toBeInTheDocument()
    // 가용성 응답을 받은 뒤에 판정해야 「아직 모름」으로 거짓 통과하지 않는다 — 양성 쪽을 같은 선택자로 확인한다.
    await waitFor(() => expect(screen.queryByRole('link', { name: /회원가입/ })).not.toBeInTheDocument())
    unmount()

    renderAuthRoutes('/login', availability(true))
    expect(await screen.findByRole('link', { name: /회원가입/ })).toHaveAttribute('href', '/signup')
  })
})

describe('세션 확인 일시 실패 (WP-859)', () => {
  /** 앱을 다시 연 상태 — 세션 표시가 남아 있어 AuthProvider 가 refresh 부터 한다. */
  function reopen(handlers: RequestHandler[]) {
    window.localStorage.setItem('hasSession', '1')
    return renderAuthRoutes('/', [...availability(), ...handlers])
  }

  test('/users/me 가 500 이면 로그인으로 보내지 않고 세션을 남긴 채 「서버에 연결하지 못했습니다」를 보인다', async () => {
    const { location } = reopen([
      http.post('/api/v1/auth/refresh', () => HttpResponse.json(createTokenResponse())),
      http.get('/api/v1/users/me', () => HttpResponse.json({ message: '서버 오류' }, { status: 500 })),
    ])
    expect(await screen.findByTestId('auth-connection-error')).toHaveTextContent('서버에 연결하지 못했습니다')
    expect(location()).toBe('/')
    expect(window.localStorage.getItem('hasSession')).not.toBeNull()
  })

  test('refresh 가 401(만료)이면 세션 표시를 지우고 로그인으로 간다', async () => {
    const { location } = reopen([
      http.post('/api/v1/auth/refresh', () => HttpResponse.json({ message: '만료' }, { status: 401 })),
    ])
    await waitFor(() => expect(location()).toBe('/login'))
    expect(await screen.findByRole('button', { name: '로그인' })).toBeInTheDocument()
    expect(screen.queryByTestId('auth-connection-error')).not.toBeInTheDocument()
    expect(window.localStorage.getItem('hasSession')).toBeNull()
  })
})

describe('구성원 추가 칸 오류 (WP-733)', () => {
  // 형식이 틀린 아이디·빈 이름 — 각 칸이 aria-invalid 이고 오류 문구가 설명으로 이어지며 알림으로 읽힌다.
  test('칸 오류가 알림으로 읽히고 입력칸과 연결된다', async () => {
    const { user } = renderScreen(<AddMemberDialog open onOpenChange={() => {}} />, {
      handlers: [http.get('/api/v1/admin/sso', () => HttpResponse.json({ enabled: false }))],
      auth: { isAdmin: true },
    })
    await user.click(await screen.findByTestId('add-member-username'))
    await user.paste('not-an-email')
    await user.click(screen.getByTestId('add-member-submit'))

    const username = screen.getByTestId('add-member-username')
    await waitFor(() => expect(username).toHaveAttribute('aria-invalid', 'true'))
    expect(username).toHaveAccessibleDescription(/아이디는 이메일 형식이어야 합니다/)
    const name = screen.getByTestId('add-member-name')
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('이름을 입력하세요')
    expect(within(screen.getByRole('dialog')).getAllByRole('alert').length).toBeGreaterThan(0)
  })
})
