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
  },
})

createRoot(document.getElementById('root')!).render(
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
  </StrictMode>,
)
