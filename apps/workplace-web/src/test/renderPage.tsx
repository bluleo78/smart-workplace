// 페이지 테스트(*.test.tsx) 렌더 도우미(WP-971) — 실제 라우트 트리(App)·인증(AuthProvider)·토스트를 그대로 띄운다.
// renderWithProviders 는 고정 AuthContext 와 vi.mock 한 훅으로 컴포넌트 하나를 보지만, 여기서는 앱 부팅부터
// refresh → /users/me → 라우트 → 페이지 → API 를 MSW 응답으로 지나 E2E 의 setupAuthMocks + goto 와 같은 상태가 된다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RequestHandler } from 'msw'
import { useEffect } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'

import App from '@/App'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider } from '@/hooks/AuthContext'
import type { UserResponse } from '@/types/auth'
import type { RoleResponse } from '@/types/role'

import { createUser } from '../../e2e/factories/auth.factory'
import { authHandlers, MOCK_USER_ROLE, shellHandlers } from './msw/baseHandlers'
import { server } from './msw/server'

/**
 * 첫 화면을 기다리는 시간 — 워커가 페이지 모듈 그래프를 처음 변환·불러올 때(프로젝트 화면 약 5~6초) 기본 1초로는 모자란다.
 * 테스트의 첫 findBy* 에만 쓰고, 그 뒤 단언은 기본값을 쓴다(진짜 실패가 길게 늘어지지 않게).
 */
export const PAGE_LOAD_TIMEOUT = 20_000

type RenderPageOptions = {
  /** 로그인 사용자 — 기본은 AI 사용 가능한 일반 사용자(id 1, E2E authenticatedPage 와 같음). */
  user?: UserResponse
  /** 역할 — 기본 USER. 관리자는 [MOCK_ADMIN_ROLE, MOCK_USER_ROLE]. */
  roles?: RoleResponse[]
  /** 이 테스트의 API 응답 — 기본값(앱 셸)보다 우선한다. */
  handlers?: RequestHandler[]
}

/** 주소가 바뀔 때마다 알린다 — 이동을 단언할 때 쓴다(location.pathname + search). */
function LocationProbe({ onChange }: { onChange: (location: string) => void }) {
  const loc = useLocation()
  useEffect(() => onChange(loc.pathname + loc.search), [loc, onChange])
  return null
}

/**
 * path 로 앱을 띄운다. 반환값의 user 는 userEvent 인스턴스, location() 은 지금 주소다.
 * 화면이 다 뜨기를 기다리는 것은 테스트가 findBy* 로 한다.
 */
export function renderPage(path: string, { user, roles = [MOCK_USER_ROLE], handlers = [] }: RenderPageOptions = {}) {
  server.use(...handlers, ...authHandlers(user ?? createUser({ aiAvailable: true }), roles), ...shellHandlers)
  // AuthProvider 는 이 표식이 있을 때만 refresh 로 세션을 되살린다(E2E 의 hasSession 주입과 같음).
  window.localStorage.setItem('hasSession', '1')
  window.history.replaceState(null, '', path)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false }, mutations: { retry: false, networkMode: 'always' } },
  })
  let current = path
  const onLocation = (location: string) => {
    current = location
  }
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <App />
        </AuthProvider>
        <LocationProbe onChange={onLocation} />
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...view, user: userEvent.setup(), queryClient, location: () => current }
}
