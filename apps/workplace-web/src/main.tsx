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
  __e2eRemount?: (path: string, storage: Record<string, string> | null) => Promise<void>
  __e2eUnmount?: () => void
}
const e2eWindow = window as E2EWindow
if (e2eWindow.__E2E_REUSE_APP__) {
  // 시트·뷰어는 닫힐 때 자기 히스토리 항목을 history.go(-1)(비동기)로 걷는다 — 언마운트 정리나 그 뒤 타이머가 부르면
  // 다시 띄우기의 replaceState 뒤에 popstate 가 도착해 새 테스트를 앞 테스트의 주소로 되돌린다. 주소를 통째로 바꾸므로
  // 걷을 항목도 없다 — 내리기부터 주소 바꾸기까지는 이동을 막는다.
  const { go, back } = window.history
  let mounted = true
  // 앞 테스트가 끝날 때 fixture 가 먼저 부른다 — 언마운트 정리가 보내는 요청(채팅 읽음 처리 등)이 앞 테스트의 목에 닿게,
  // 다음 테스트가 라우트·요청 추적을 깔기 전에 내린다. 다시 띄우기에서 다시 불러도 한 번만 내린다.
  e2eWindow.__e2eUnmount = () => {
    if (!mounted) return
    mounted = false
    window.history.go = () => {}
    window.history.back = () => {}
    root.unmount()
  }
  e2eWindow.__e2eRemount = async (path, storage) => {
    e2eWindow.__e2eUnmount!()
    queryClient.clear()
    // 모듈 안에 남는 상태도 새 문서처럼 비운다 — 메모리 액세스 토큰, 노트 동시 편집 세션(페이지 번호로 재사용돼 앞 테스트의 문서가 남는다),
    // AI 첫 화면 추천 저장소(오늘 받은 결과면 다시 부르지 않는다), 메일 이동 대기열, AI 대화 스트림 저장소(같은 대화 id 면 앞 테스트의 대화가 보인다),
    // 첨부 다운로드 재저장 막기(같은 파일을 1초 안에 다시 받으면 무시한다).
    // 동적으로 불러와 메인 번들에 싣지 않는다(이미 떠 있는 같은 모듈이라 새 비용도 없다).
    const [{ setAccessToken }, { resetCollabSessionsForTest }, { clearStarterStorage }, { resetMailMoveQueueForTest }, { chatStreams }, { resetDownloadInFlightForTest }] =
      await Promise.all([
        import('./api/client'),
        import('./lib/collab/collabSession'),
        import('./lib/ai/starterStorage'),
        import('./lib/mailMoveQueue'),
        import('./lib/ai/chatStreams'),
        import('./components/viewer/downloadViewerItem'),
      ])
    setAccessToken(null)
    resetCollabSessionsForTest()
    clearStarterStorage()
    resetMailMoveQueueForTest()
    resetDownloadInFlightForTest()
    // storage 가 있으면 새 테스트의 시작이다 — 저장소를 비우고 시작 값을 넣는다. null 이면 같은 테스트 안의 다시 열기(새로고침과 같다)라 둔다.
    if (storage) {
      window.localStorage.clear()
      window.sessionStorage.clear()
      for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value)
    }
    // 대화 저장소는 저장소를 맞춘 뒤 비운다(미확인 완료를 localStorage 에서 다시 읽는다) — 앱이 뜨며 owner 를 다시 정한다.
    chatStreams.setPanelOpen(false)
    chatStreams.setOwner(null)
    // 모달·스크롤 잠금이 body·html 에 남긴 흔적을 지운다(언마운트 정리가 비동기로 늦게 도는 경우 대비).
    document.body.removeAttribute('style')
    document.body.removeAttribute('data-scroll-locked')
    // <html> 에 앱이 단 표식·CSS 변수(키보드 높이 --vvh·--kb-inset, data-keyboard-open 등)도 지운다 — 테마 class 는 ThemeProvider 가 다시 단다.
    const html = document.documentElement
    html.removeAttribute('style')
    for (const attr of Array.from(html.attributes)) if (attr.name.startsWith('data-')) html.removeAttribute(attr.name)
    for (const el of Array.from(document.body.children)) if (el !== rootElement && el.tagName !== 'SCRIPT') el.remove()
    window.history.replaceState(null, '', path)
    window.history.go = go
    window.history.back = back
    window.scrollTo(0, 0)
    root = createRoot(rootElement)
    root.render(appTree)
    mounted = true
  }
}
