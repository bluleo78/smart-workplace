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
import { Toaster } from './components/ui/sonner.tsx'
import { PlatformAuthProvider } from './hooks/PlatformAuthContext.tsx'

// 운영자 콘솔 진입점.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <PlatformAuthProvider>
            <App />
            {/* 토스트 영역 이름을 sonner 영어 기본값 「Notifications」 대신 한국어로(WP-1428 — web 의 AppToaster 와 같은 이름) */}
            <Toaster containerAriaLabel="알림 토스트" />
          </PlatformAuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
