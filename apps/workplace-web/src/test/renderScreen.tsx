// 화면 컴포넌트 테스트 렌더 도우미(WP-995) — 동작을 가진 가장 작은 컴포넌트(사이드바·대화상자·섹션)를 MSW 와 함께 띄운다.
// renderPage 는 App 전체(인증 부팅·앱 셸·라우트)를 띄워 파일마다 모듈 불러오기·첫 화면에 10초 안팎이 든다. 여기서는 App·AuthProvider 를
// 거치지 않고(고정 AuthContext) 컴포넌트만 그려, 같은 단언이 절반 가까이 빨라진다(driveSpaceCreate: 11.7초 → 6.3초).
// 데이터 훅은 끊지 않고 MSW 로 네트워크 계층에서 모킹한다 — 폼 → payload, 응답 → 화면, 이동 주소를 renderPage 와 같은 깊이로 본다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RequestHandler } from 'msw'
import { type ReactElement, useEffect } from 'react'
import { BrowserRouter, useLocation } from 'react-router-dom'

import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthContext, type AuthContextValue } from '@/hooks/auth-context-value'

import { server } from './msw/server'
import { testAuthValue } from './renderWithProviders'

type RenderScreenOptions = {
  /** 시작 주소 — 컴포넌트가 useParams·검색 파라미터를 읽으면 그 모양으로 준다. 라우트 패턴이 필요하면 ui 를 Routes 로 감싼다. */
  path?: string
  /** 이 테스트의 API 응답. 앱 셸 기본 조회(baseHandlers)는 깔지 않는다 — 컴포넌트가 부르는 것만 준다. */
  handlers?: RequestHandler[]
  /** 로그인 사용자·역할 — 기본은 testAuthValue(일반 사용자 id 1). */
  auth?: Partial<AuthContextValue>
}

/** 주소가 바뀔 때마다 알린다 — 이동을 단언할 때 쓴다(location.pathname + search). */
function LocationProbe({ onChange }: { onChange: (location: string) => void }) {
  const loc = useLocation()
  useEffect(() => onChange(loc.pathname + loc.search), [loc, onChange])
  return null
}

/**
 * ui 를 QueryClient(재시도 끔)·고정 AuthContext·BrowserRouter(jsdom 세션 히스토리)·툴팁·토스트로 감싸 그린다.
 * 반환값의 user 는 userEvent 인스턴스, location() 은 지금 주소다. 모듈을 정적으로 불러오므로 첫 findBy* 에 긴 timeout 이 필요 없다.
 */
export function renderScreen(ui: ReactElement, { path = '/', handlers = [], auth }: RenderScreenOptions = {}) {
  server.use(...handlers)
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
      <AuthContext.Provider value={{ ...testAuthValue, ...auth }}>
        <BrowserRouter>
          <TooltipProvider>{ui}</TooltipProvider>
          <LocationProbe onChange={onLocation} />
          <Toaster />
        </BrowserRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
  return { ...view, user: userEvent.setup(), queryClient, location: () => current }
}
