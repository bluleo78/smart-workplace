// 프로젝트 상세(이슈 목록·보드) 화면 테스트 도우미(WP-1002) — ProjectDetailPage 만 App·앱 셸 없이 renderScreen 으로 띄운다.
// 필터 바·뷰 전환·목록/보드·에픽 패널·만들기 대화상자가 한 화면에서 URL 상태를 나눠 쓰므로 화면 단위로 띄운다.
import ProjectDetailPage from '@/pages/projects/ProjectDetailPage'

import { renderRouteScreen, type ScreenOptions } from './routeScreen'

/** 프로젝트 상세 화면(/projects/:key)만 띄운다. 검색 파라미터(?view=board 등)는 path 에 붙인다. */
export function renderProjectScreen(path: string, options: ScreenOptions = {}) {
  return renderRouteScreen('/projects/:key', <ProjectDetailPage />, path, options)
}
