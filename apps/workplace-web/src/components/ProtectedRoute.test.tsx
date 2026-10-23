// 보호 라우트의 로그인 뒤 복귀 대상(WP-579) — 미인증으로 걸린 주소 중 공유 링크 진입(/wiki/share/·/wiki/open/)만 남긴다.
// 다른 보호 경로까지 남기면 로그아웃·세션 만료 직후 같은 탭에서 다른 계정으로 로그인했을 때 이전 사용자의 화면으로 튄다.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AuthContext, type AuthContextValue } from '@/hooks/auth-context-value'
import { PENDING_PUSH_TARGET_KEY } from '@/lib/push/openTarget'

import { ProtectedRoute } from './ProtectedRoute'

const noop = async () => {}

/** 로그인하지 않은(로그아웃·세션 만료 직후) 상태의 고정 AuthContext 값. */
const signedOut: AuthContextValue = {
  user: null,
  roles: [],
  isLoading: false,
  isAuthenticated: false,
  activeTenant: null,
  tenantOptions: null,
  authNotice: null,
  connectionError: false,
  retryAuth: () => {},
  login: noop,
  signup: noop,
  logout: noop,
  selectTenant: noop,
  completeSsoLogin: async () => 'entered',
  hasRole: () => false,
  isAdmin: false,
  refreshUser: noop,
}

/** 미인증으로 path 를 열어 ProtectedRoute 가 로그인으로 보내게 한다. overrides 로 인증 상태 일부를 바꾼다(WP-859 연결 실패 등). */
function openSignedOut(path: string, overrides: Partial<AuthContextValue> = {}) {
  render(
    <AuthContext.Provider value={{ ...signedOut, ...overrides }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<div>로그인 화면</div>} />
          <Route element={<ProtectedRoute />}>
            <Route path="*" element={<div>보호된 화면</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

afterEach(() => sessionStorage.clear())

describe('ProtectedRoute — 로그인 뒤 복귀 대상', () => {
  it('일반 보호 경로는 남기지 않는다(로그아웃 뒤 다른 계정 로그인이 홈으로 가게)', () => {
    openSignedOut('/projects/WP/issues/12')
    expect(screen.getByText('로그인 화면')).toBeInTheDocument()
    expect(sessionStorage.getItem(PENDING_PUSH_TARGET_KEY)).toBeNull()
  })

  it('알림 진입(/wiki/open/:pageId)은 남겨 로그인 뒤 그 노트로 돌아온다', () => {
    openSignedOut('/wiki/open/5?share=1')
    expect(screen.getByText('로그인 화면')).toBeInTheDocument()
    expect(JSON.parse(sessionStorage.getItem(PENDING_PUSH_TARGET_KEY) ?? 'null')).toEqual({
      tenantId: null,
      url: '/wiki/open/5?share=1',
    })
  })
})

// WP-859: 세션 확인이 일시 오류로 실패하면 로그인으로 보내지 않고 연결 실패 안내 + 다시 시도.
describe('ProtectedRoute — 세션 확인 일시 실패', () => {
  it('로그인 화면 대신 「서버에 연결하지 못했습니다」를 보이고, 다시 시도는 retryAuth 를 부른다', async () => {
    const retryAuth = vi.fn()
    openSignedOut('/projects/WP', { connectionError: true, retryAuth })
    expect(screen.getByTestId('auth-connection-error')).toHaveTextContent('서버에 연결하지 못했습니다')
    expect(screen.queryByText('로그인 화면')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('auth-connection-retry'))
    expect(retryAuth).toHaveBeenCalledOnce()
  })

  it('「다른 계정으로 로그인」은 로그아웃 뒤 로그인 화면으로 보낸다', async () => {
    const logout = vi.fn(async () => {})
    openSignedOut('/projects/WP', { connectionError: true, logout })
    await userEvent.click(screen.getByTestId('auth-connection-login'))
    expect(logout).toHaveBeenCalledOnce()
    expect(await screen.findByText('로그인 화면')).toBeInTheDocument()
  })

  it('이미 로그인된 상태면(안내가 남았어도) 보호된 화면을 그대로 보인다', () => {
    openSignedOut('/projects/WP', {
      connectionError: true,
      isAuthenticated: true,
      user: { id: 1 } as AuthContextValue['user'],
    })
    expect(screen.getByText('보호된 화면')).toBeInTheDocument()
    expect(screen.queryByTestId('auth-connection-error')).not.toBeInTheDocument()
  })
})
