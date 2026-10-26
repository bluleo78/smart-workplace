// 노트 화면 테스트 공용 라우트(WP-983) — renderScreen 은 라우트 트리를 띄우지 않으므로 useParams 를 읽는 화면을 App 과 같은 주소 모양으로 감싼다.
import { Route, Routes } from 'react-router-dom'

import { WikiModuleLayout } from '@/components/wiki/WikiModuleLayout'
import { WikiSidebar } from '@/components/wiki/WikiSidebar'

import { WikiIndexRedirect } from './WikiIndexRedirect'
import { WikiPage } from './WikiPage'

/** 사이드바만 — 공간·페이지 주소에서 같은 사이드바를 그린다(다른 주소로 가면 아무것도 그리지 않는다). */
export function WikiSidebarRoutes() {
  return (
    <Routes>
      <Route path="/wiki/spaces/:spaceId" element={<WikiSidebar />} />
      <Route path="/wiki/spaces/:spaceId/pages/:pageId" element={<WikiSidebar />} />
      <Route path="*" element={null} />
    </Routes>
  )
}

/** 노트 모듈 전체(사이드바 + /wiki 진입 + 페이지) — App 의 wiki 라우트와 같은 모양. 앱 셸·인증 부팅은 없다. */
export function WikiModuleRoutes() {
  return (
    <Routes>
      <Route element={<WikiModuleLayout />}>
        <Route path="/wiki" element={<WikiIndexRedirect />} />
        <Route path="/wiki/spaces/:spaceId" element={<WikiPage />} />
        <Route path="/wiki/spaces/:spaceId/pages/:pageId" element={<WikiPage />} />
      </Route>
      <Route path="*" element={null} />
    </Routes>
  )
}
