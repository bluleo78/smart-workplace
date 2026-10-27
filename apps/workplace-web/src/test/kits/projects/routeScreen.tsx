// 프로젝트·이슈 화면 테스트 렌더 도우미(WP-1002) — 화면 컴포넌트를 App·인증 부팅·앱 셸 없이 renderScreen 으로 띄운다.
// renderPage 는 App 전체(refresh → /users/me → 레일·인박스 → lazy 라우트)를 거쳐 파일마다 수 초가 더 든다. 여기서는 화면 컴포넌트를
// App 과 같은 라우트 모양(useParams)으로만 감싸고, 화면이 쓰는 공급자 중 앱 셸(AppLayout)이 까는 AIAssistantProvider 만 함께 둔다.
// 로그인 사용자는 renderPage 기본(createUser — id 1·「테스트 사용자」·AI 사용 가능)과 같게 맞춰 작성자·멘션 판정이 그대로 통한다.
// 화면 모듈은 여기서 불러오지 않는다 — 한 파일이 쓰지 않는 화면 모듈 트리까지 불러오지 않게 화면별 도우미(issueDetailScreen·
// projectDetailScreen)나 테스트 파일이 넘긴다.
import type { RequestHandler } from 'msw'
import type { ReactElement, ReactNode } from 'react'
import { Route, Routes } from 'react-router-dom'
import { onTestFinished } from 'vitest'

import { setAccessToken } from '@/api/client'
import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import type { AuthContextValue } from '@/hooks/auth-context-value'
import { useEventStream } from '@/hooks/useEventStream'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'
import { testAuthValue } from '@/test/renderWithProviders'

import { createUser } from '../../../../e2e/factories/auth.factory'

/**
 * 첫 화면을 기다리는 시간 — renderPage 의 PAGE_LOAD_TIMEOUT 과 같은 값. renderPage 모듈은 App 전체를 정적으로 불러오므로
 * 이 상수 하나 때문에 그 모듈을 import 하지 않도록 여기 따로 둔다(그러면 화면 테스트도 App 을 불러오는 비용을 다시 낸다).
 */
export const SCREEN_LOAD_TIMEOUT = 20_000

export type ScreenOptions = {
  /** 이 테스트의 API 응답 — 앱 셸 기본값보다 앞에 둔다(MSW 는 한 번에 넘긴 목록에서 앞의 것이 먼저 잡는다). */
  handlers?: RequestHandler[]
  /** 로그인 사용자·역할 — 기본은 renderPage 와 같은 사용자(createUser, AI 사용 가능). */
  auth?: Partial<AuthContextValue>
  /** 화면 옆에 함께 그릴 것 — 앱 셸이 맡던 배선 하나만 필요할 때(예: 통합 SSE 를 여는 useEventStream). */
  extra?: ReactNode
}

/**
 * renderPage 의 기본 로그인 사용자와 같은 AuthContext 값 — 사용자(createUser)와, 테넌트 클레임 없는 토큰이라 활성 워크스페이스 없음
 * (본문 초안 키 `…:1:-:…` 처럼 테넌트를 키에 넣는 판정이 renderPage 때와 같게).
 */
export const pageAuth: Partial<AuthContextValue> = {
  user: { ...testAuthValue.user!, ...createUser({ aiAvailable: true }) },
  activeTenant: null,
}

/**
 * 화면 하나를 AIAssistantProvider(단축키 끔) + 라우트(routePath)로 감싸 path 에서 띄운다 — 다른 주소로 가면 아무것도 그리지 않는다
 * (이동은 location() 으로 본다). 화면 전체를 띄우므로 상태·유형·관계 유형 같은 부가 조회는 앱 셸 기본값(shellHandlers)을
 * 테스트 핸들러 뒤에 깐다.
 */
export function renderRouteScreen(routePath: string, element: ReactElement, path: string, { handlers = [], auth, extra }: ScreenOptions = {}) {
  return renderScreen(
    <AIAssistantProvider hotkeysEnabled={false}>
      {extra}
      <Routes>
        <Route path={routePath} element={element} />
        <Route path="*" element={null} />
      </Routes>
    </AIAssistantProvider>,
    { path, handlers: [...handlers, ...shellHandlers], auth: { ...pageAuth, ...auth } },
  )
}

/** 앱 셸(AppLayout)이 여는 통합 SSE 구독 — 같은 훅(useEventStream)을 화면 옆에 둔다. */
function AppEventStream({ userId }: { userId: number }) {
  useEventStream(userId)
  return null
}

/**
 * 통합 SSE(/api/v1/events)를 여는 앱 셸 배선 하나만 붙일 때 ScreenOptions.extra 로 넘긴다 — 실시간 프레임이 캐시·화면에 닿는 판정용.
 * 스트림은 액세스 토큰이 있어야 연결하므로(인증 부팅이 하던 일) 이 테스트 동안만 토큰을 넣는다.
 */
export function appEventStream(userId = 1): ReactNode {
  setAccessToken('test-access-token')
  onTestFinished(() => setAccessToken(null))
  return <AppEventStream userId={userId} />
}
