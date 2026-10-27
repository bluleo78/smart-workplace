// 데스크톱 AI 표면 화면 테스트 도우미(WP-1002) — AppLayout 의 AI 조립(상태 Provider·통합 SSE 구독·딥링크·AI 칩·사이드 패널·
// 전체 화면)만 renderScreen 으로 띄운다. App 라우트 트리·인증 부팅(refresh → /users/me)·앱 레일·모바일 셸은 건너뛴다.
// 화면 참고(screenContext)를 등록하는 화면이 필요하면 page 로 넘긴다(라우트 패턴이 필요하면 c-route 의 atRoute 로 감싼다).
// 셸 자체(레일 이동·aiAvailable 게이트·인박스·모바일 시트)를 보는 판정은 여기서 하지 않는다 — 그건 renderPage 몫이다.
// 표면 모듈은 renderPage 처럼 미리 불러 둔다(Lazy 표면이 처음 열릴 때 모듈 변환으로 기다리지 않게).
import '@/components/ai/AIFullscreen'
import '@/components/ai/AISidePanel'

import { screen } from '@testing-library/react'
import type { RequestHandler } from 'msw'
import type { ReactElement, ReactNode } from 'react'
import { onTestFinished } from 'vitest'

import { setAccessToken } from '@/api/client'
import { AiChatDeepLink } from '@/components/ai/AiChatDeepLink'
import { AIChip } from '@/components/ai/AIChip'
import { LazyAIFullscreen, LazyAISidePanel } from '@/components/ai/LazyAiSurfaces'
import { useAuth } from '@/hooks/useAuth'
import { useEventStream } from '@/hooks/useEventStream'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'

import { withAppProviders } from '../appProviders'

/** 통합 SSE(/api/v1/events)를 AppLayout 처럼 로그인 사용자로 한 번 구독한다 — home.chat.* 프레임이 실제 파서를 지난다. */
function EventStreamHost() {
  const { user } = useAuth()
  useEventStream(user?.id ?? 0)
  return null
}

/** AppLayout 데스크톱 분기와 같은 자리 배치 — 본문(main) 안 전체 화면, 옆 패널은 형제, 칩은 바깥. */
function AiSurfaces({ children }: { children?: ReactNode }) {
  return (
    <>
      <EventStreamHost />
      <AiChatDeepLink />
      <div data-ai-page-root className="flex h-screen overflow-hidden">
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {children}
          <LazyAIFullscreen />
        </main>
        <LazyAISidePanel />
      </div>
      <AIChip />
    </>
  )
}

type AiShellOptions = { path?: string; handlers?: RequestHandler[]; page?: ReactElement | null }

/**
 * AI 표면과 page(없으면 빈 본문)를 띄운다. handlers 가 앱 셸 기본 응답(shellHandlers)보다 먼저 등록돼 우선한다.
 * 반환값은 renderScreen 과 같다(user·location()·queryClient).
 */
export function renderAiShell({ path = '/', handlers = [], page = null }: AiShellOptions = {}) {
  // 통합 SSE 는 액세스 토큰이 있어야 연결한다 — renderPage 의 refresh 가 넣던 토큰 대신 고정값을 넣고 테스트 끝에 비운다.
  setAccessToken('test-access-token')
  onTestFinished(() => setAccessToken(null))
  // 활성 테넌트 없음 — renderPage 의 로그인(토큰에 테넌트 없음)과 같은 대화·추천 저장소 키(사용자id:0)를 쓰게 한다.
  return renderScreen(withAppProviders(<AiSurfaces>{page}</AiSurfaces>), {
    path,
    handlers: [...handlers, ...shellHandlers],
    auth: { activeTenant: null },
  })
}

/** AI 표면을 띄우고 칩(chat-launcher)으로 옆 패널을 연다. */
export async function openAiPanel(handlers: RequestHandler[], options: Omit<AiShellOptions, 'handlers'> = {}) {
  const view = renderAiShell({ ...options, handlers })
  await view.user.click(await screen.findByTestId('chat-launcher'))
  return { ...view, panel: await screen.findByTestId('chat-panel') }
}
