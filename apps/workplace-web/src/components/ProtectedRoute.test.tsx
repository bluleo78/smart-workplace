// 보호 라우트의 로그인 뒤 복귀 대상(WP-579) — 미인증으로 걸린 주소 중 공유 링크 진입(/wiki/share/·/wiki/open/)만 남긴다.
// 다른 보호 경로까지 남기면 로그아웃·세션 만료 직후 같은 탭에서 다른 계정으로 로그인했을 때 이전 사용자의 화면으로 튄다.
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

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
  login: noop,
  signup: noop,
  logout: noop,
  selectTenant: noop,
  completeSsoLogin: async () => 'entered',
  hasRole: () => false,
  isAdmin: false,
  refreshUser: noop,
}

/** 미인증으로 path 를 열어 ProtectedRoute 가 로그인으로 보내게 한다. */
function openSignedOut(path: string) {
  render(
    <AuthContext.Provider value={signedOut}>
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
