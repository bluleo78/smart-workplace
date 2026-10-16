// 컴포넌트 테스트(*.test.tsx) 공통 렌더 헬퍼 — 앱 루트가 감싸는 공급자를 테스트용으로 최소 구성한다.
// 실제 AuthProvider 는 마운트 시 refresh API 를 부르므로 쓰지 않고, 고정 값의 AuthContext 를 넣는다.
// 데이터 훅은 테스트 파일에서 vi.mock 으로 끊는 것이 기본 — 여기의 QueryClient 는 끊지 않은 훅이 있어도
// 재시도 없이 바로 실패하게 해 테스트가 느려지거나 흔들리지 않게 하는 안전망이다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthContext, type AuthContextValue } from '@/hooks/auth-context-value'

const noop = async () => {}

/** 로그인된 일반 사용자(id 1) 상태의 고정 AuthContext 값 — e2e auth.factory 의 기본 사용자와 같은 모양. */
const authValue: AuthContextValue = {
  user: {
    id: 1,
    username: 'tester',
    email: 'tester@example.com',
    name: 'Tester',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    kind: 'HUMAN',
    aiAvailable: true,
    hasPassword: true,
  },
  roles: [],
  isLoading: false,
  isAuthenticated: true,
  activeTenant: { tenantId: 1, tenantName: 'Test', tenantSlug: 'test' },
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

/** QueryClient(재시도 끔) + MemoryRouter + AuthContext + TooltipProvider 로 감싸 렌더한다. */
export function renderWithProviders(ui: ReactElement) {
  // 테스트마다 새 QueryClient — 캐시가 테스트 사이에 새지 않게.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authValue}>
          <MemoryRouter>
            <TooltipProvider>{children}</TooltipProvider>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>
    )
  }
  return render(ui, { wrapper: Wrapper })
}
