// 모바일 화면 테스트 공용 렌더(WP-1002) — 앱 셸(탭바·AI 시트·레일)을 보지 않는 모바일 판정을 renderPage 대신 renderScreen 으로 띄운다.
// 모바일 헤더(‹·✦ AI 버튼)·탭바 숨김 요청·메일 작성·인박스 같은 화면 부품은 AppLayout 의 상태 Provider 를 읽으므로,
// 네트워크를 부르지 않는 그 Provider 들만 AppLayout 과 같은 순서로 감싼다(MobileShell·AI 시트·이벤트 스트림은 띄우지 않는다).
// 모바일 헤더가 늘 부르는 부가 조회(진행 중 AI 대화·안 읽은 알림 등)는 앱 셸 기본 응답(shellHandlers)을 테스트 응답 뒤에 깐다.
import type { ReactElement } from 'react'
import { Route, Routes } from 'react-router-dom'

import { withAppProviders } from '@/test/kits/appProviders'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'


/**
 * 모바일 화면을 AppLayout 상태 Provider 와 함께 renderScreen 으로 띄운다. 옵션은 renderScreen 과 같다.
 * handlers 가 먼저 등록돼 앱 셸 기본 응답보다 우선한다(renderPage 와 같은 순서).
 */
export function renderMobileScreen(ui: ReactElement, { handlers = [], ...options }: Parameters<typeof renderScreen>[1] = {}) {
  return renderScreen(withAppProviders(ui), { ...options, handlers: [...handlers, ...shellHandlers] })
}

/**
 * element 를 라우트 패턴 하나(예: /projects/:key)로 감싸 모바일 화면으로 띄운다 — 화면이 useParams 를 읽을 때 쓴다.
 * 다른 주소로 이동하면 빈 화면이 된다(이동 자체는 location() 으로 단언한다).
 */
export function renderMobileRoute(pattern: string, element: ReactElement, options: Parameters<typeof renderScreen>[1] = {}) {
  return renderMobileScreen(
    <Routes>
      <Route path={pattern} element={element} />
      <Route path="*" element={null} />
    </Routes>,
    options,
  )
}

/**
 * 모듈 레이아웃(Outlet) 아래에 화면 라우트를 깔아 모바일 화면으로 띄운다 — 앱과 같은 「레이아웃 → 화면」 모양.
 * 모바일 상세 헤더(‹·✦)·☰ 사이드바 시트·모듈 루트 목록은 레이아웃이 그리므로, 그것을 보는 판정은 이 모양으로 띄운다.
 * routes 는 [패턴, 화면] 목록(예: [['/mail', <MailInboxPage />], ['/mail/:accountId', <MailInboxPage />]]).
 */
export function renderMobileModule(
  layout: ReactElement,
  routes: [pattern: string, element: ReactElement][],
  options: Parameters<typeof renderScreen>[1] = {},
) {
  return renderMobileScreen(
    <Routes>
      <Route element={layout}>
        {routes.map(([pattern, element]) => (
          <Route key={pattern} path={pattern} element={element} />
        ))}
      </Route>
      <Route path="*" element={null} />
    </Routes>,
    options,
  )
}
