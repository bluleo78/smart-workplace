import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import './index.css'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App.tsx'
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt.tsx'
import { Toaster } from './components/ui/sonner.tsx'
import { AuthProvider } from './hooks/AuthContext'
import { shouldRetryQuery } from './lib/queryRetry'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 4xx 는 즉시 실패, 5xx·네트워크 오류만 1회 재시도(정책은 shouldRetryQuery).
      retry: shouldRetryQuery,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      // 저장 요청은 오프라인이어도 바로 보내 실패를 알린다(WP-927). 기본값(online)은 오프라인 동안 요청을 멈춰 두었다가
      // 다시 연결되면 보내 — 화면엔 아무 안내 없이 기다리기만 하고, 대화상자를 닫아 취소한 줄 안 저장이 뒤늦게 실행됐다.
      networkMode: 'always',
    },
  },
})

/** 앱 트리 — 처음 띄울 때와 E2E 의 다시 띄우기(아래)가 같은 트리를 쓴다. */
const appTree = (
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
          {/* top-right — 메일 컴포즈 도크 등 화면 하단에 고정되는 UI와 겹쳐 액션 버튼을 가리는 것을 방지 (#692) */}
          {/* bottom 오프셋은 모바일 복귀 토스트(wikiAwayToast — 06 §D 예외)만 쓴다: 홈 인디케이터(safe-area)나 열린 키보드(--kb-inset,
              useVisualViewport) 중 큰 쪽 위로 띄운다. 기본값 16px(≤600px)·24px(그 위)에 더한다. top·좌우는 sonner 기본값 그대로. */}
          <Toaster
            position="top-right"
            mobileOffset={{ bottom: 'calc(16px + max(env(safe-area-inset-bottom, 0px), var(--kb-inset, 0px)))' }}
            offset={{ bottom: 'calc(24px + max(env(safe-area-inset-bottom, 0px), var(--kb-inset, 0px)))' }}
          />
          <PwaUpdatePrompt />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
)

const rootElement = document.getElementById('root')!
let root = createRoot(rootElement)
root.render(appTree)

// E2E 전용 — 페이지를 새로 열지 않고 React 앱만 처음부터 다시 띄운다(WP-1002).
// 테스트마다 page.goto 로 문서를 새로 열면 번들 해석·실행에 약 0.4초가 든다. 같은 워커의 다음 테스트는 문서를 그대로 두고
// 트리를 내렸다 다시 올려 쿼리 캐시·인증·화면 상태를 처음 상태로 돌린다. E2E fixture 가 페이지 시작 스크립트로
// __E2E_REUSE_APP__ 를 켤 때만 생기고, 운영에서는 이 값이 없어 아무 일도 하지 않는다.
type E2EWindow = Window & {
  __E2E_REUSE_APP__?: boolean
  __e2eRemount?: (path: string, storage: Record<string, string> | null) => void
}
const e2eWindow = window as E2EWindow
if (e2eWindow.__E2E_REUSE_APP__) {
  e2eWindow.__e2eRemount = (path, storage) => {
    root.unmount()
    queryClient.clear()
    // storage 가 있으면 새 테스트의 시작이다 — 저장소를 비우고 시작 값을 넣는다. null 이면 같은 테스트 안의 다시 열기(새로고침과 같다)라 둔다.
    if (storage) {
      window.localStorage.clear()
      window.sessionStorage.clear()
      for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value)
    }
    // 모달·스크롤 잠금이 body·html 에 남긴 흔적을 지운다(언마운트 정리가 비동기로 늦게 도는 경우 대비).
    document.body.removeAttribute('style')
    document.body.removeAttribute('data-scroll-locked')
    for (const el of Array.from(document.body.children)) if (el !== rootElement && el.tagName !== 'SCRIPT') el.remove()
    window.history.replaceState(null, '', path)
    window.scrollTo(0, 0)
    root = createRoot(rootElement)
    root.render(appTree)
  }
}
