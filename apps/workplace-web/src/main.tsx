import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import './index.css'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { ThemeProvider } from 'next-themes'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App.tsx'
import { Toaster } from './components/ui/sonner.tsx'
import { AuthProvider } from './hooks/AuthContext'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 4xx 클라이언트 오류(404·403·422 등)는 재시도해도 결과가 같으므로 즉시 실패시켜
      // 오류 표시 지연(기본 backoff ~1초)을 없앤다. 5xx·네트워크 오류만 1회 재시도.
      retry: (failureCount, error) => {
        const status = isAxiosError(error) ? error.response?.status : undefined
        if (status !== undefined && status < 500) return false
        return failureCount < 1
      },
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
          <Toaster position="top-right" />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
