// 화면 테스트(renderScreen) 라우트 감싸개(WP-1002) — 페이지 컴포넌트가 useParams 로 읽는 라우트 패턴을 준다.
// App 의 라우트 트리 전체 대신 패턴 하나만 깔아, 화면 모듈만 불러오고 인증 부팅·앱 셸은 건너뛴다.
import type { ReactElement } from 'react'
import { Route, Routes } from 'react-router-dom'

/** element 를 pattern(예: /projects/:key/timeline) 라우트 하나로 감싼다 — 다른 주소로 이동하면 아무것도 그리지 않는다. */
export function atRoute(pattern: string, element: ReactElement) {
  return (
    <Routes>
      <Route path={pattern} element={element} />
      {/* 이동한 뒤 빈 화면 — 이동 자체는 location() 으로 단언한다. */}
      <Route path="*" element={null} />
    </Routes>
  )
}
