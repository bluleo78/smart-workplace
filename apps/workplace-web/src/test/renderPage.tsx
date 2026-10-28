// 페이지 테스트(*.test.tsx) 렌더 도우미(WP-971) — 실제 라우트 트리(App)·인증(AuthProvider)·토스트를 그대로 띄운다.
// renderWithProviders 는 고정 AuthContext 와 vi.mock 한 훅으로 컴포넌트 하나를 보지만, 여기서는 앱 부팅부터
// refresh → /users/me → 라우트 → 페이지 → API 를 MSW 응답으로 지나 E2E 의 setupAuthMocks + goto 와 같은 상태가 된다.
// 앱이 열 때 불러오는(lazy, WP-970) 전역 UI — AI 패널·메일 작성 도크·새 소식·프로젝트 만들기. 운영 번들에서는 첫 부팅을 줄이려고
// 나눴지만, 테스트 워커는 처음 여는 순간 그 모듈 트리를 변환·불러오느라 전체 실행 부하에서 5초 대기를 넘겼다. 페이지 테스트는
// 예전처럼 App 과 함께 미리 불러 둔다(lazy 는 한 틱 뒤 바로 풀린다 — 여는 단언은 findBy* 로 기다린다).
import '@/components/ai/AIFullscreen'
import '@/components/ai/AISidePanel'
import '@/components/ai/MobileAiSheet'
import '@/components/mail/MailComposeDock'
import '@/components/whats-new/WhatsNewDialog'
import '@/pages/projects/components/ProjectCreateDialog'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { configure, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RequestHandler } from 'msw'
import { BrowserRouter } from 'react-router-dom'

import App from '@/App'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider } from '@/hooks/AuthContext'
import type { UserResponse } from '@/types/auth'
import type { RoleResponse } from '@/types/role'

import { createUser } from '../../e2e/factories/auth.factory'
import { PAGE_ASYNC_TIMEOUT } from './asyncTimeout'
import { trackLocation } from './locationProbe'
import { authHandlers, MOCK_USER_ROLE, shellHandlers } from './msw/baseHandlers'
import { server } from './msw/server'

export { settleHistory } from './history'

/**
 * 첫 화면을 기다리는 시간 — 워커가 페이지 모듈 그래프를 처음 변환·불러올 때(프로젝트 화면 약 5~6초) 기본 1초로는 모자란다.
 * 테스트의 첫 findBy* 에만 쓴다. 다른 세션의 E2E·게이트와 겹쳐 부하가 크면(load 50 안팎) 변환만 20초를 넘겨 첫 화면에서
 * 실패했다(WP-1006) — 그래서 dom 프로젝트 testTimeout(60초) 안에서 넉넉히 둔다.
 */
export const PAGE_LOAD_TIMEOUT = 45_000

export { PAGE_ASYNC_TIMEOUT }

type RenderPageOptions = {
  /** 로그인 사용자 — 기본은 AI 사용 가능한 일반 사용자(id 1, E2E authenticatedPage 와 같음). */
  user?: UserResponse
  /** 역할 — 기본 USER. 관리자는 [MOCK_ADMIN_ROLE, MOCK_USER_ROLE]. */
  roles?: RoleResponse[]
  /** 이 테스트의 API 응답 — 기본값(앱 셸)보다 우선한다. */
  handlers?: RequestHandler[]
}

/**
 * path 로 앱을 띄운다. 반환값의 user 는 userEvent 인스턴스, location() 은 지금 주소다.
 * 화면이 다 뜨기를 기다리는 것은 테스트가 findBy* 로 한다.
 */
export function renderPage(path: string, { user, roles = [MOCK_USER_ROLE], handlers = [] }: RenderPageOptions = {}) {
  // 컴포넌트 테스트(renderWithProviders)는 RTL 기본값 그대로 두고 페이지 테스트만 늘린다 — 되돌리기는 setup.ts afterEach.
  configure({ asyncUtilTimeout: PAGE_ASYNC_TIMEOUT })
  server.use(...handlers, ...authHandlers(user ?? createUser({ aiAvailable: true }), roles), ...shellHandlers)
  // AuthProvider 는 이 표식이 있을 때만 refresh 로 세션을 되살린다(E2E 의 hasSession 주입과 같음).
  window.localStorage.setItem('hasSession', '1')
  // 라우터는 jsdom 의 실제 세션 히스토리(window.history)를 쓴다(WP-995) — MemoryRouter 는 window.history 를 건드리지 않아
  // history.state 로 「앱 안에서 연 항목」을 알아보는 닫기(useHistoryParam·useIssueOrigin)·뒤로 가기·window.location 을 읽는
  // 코드가 jsdom 에서 무동작이었다. 시작 주소는 현재 항목을 바꿔 둔다 — state 가 비어 있어 라우터는 이 항목을 첫 항목(idx 0)으로 본다.
  window.history.replaceState(null, '', path)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false }, mutations: { retry: false, networkMode: 'always' } },
  })
  const { Tracked, location } = trackLocation(path)
  const view = render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Tracked>
          <AuthProvider>
            <App />
          </AuthProvider>
          <Toaster />
        </Tracked>
      </BrowserRouter>
    </QueryClientProvider>,
  )
  return { ...view, user: userEvent.setup(), queryClient, location }
}
