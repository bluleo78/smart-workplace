// 프로젝트 상세(이슈 목록·보드) 화면 테스트 도우미(WP-1002) — ProjectDetailPage 를 App·앱 셸 없이 renderScreen 으로 띄운다.
// 필터 바·뷰 전환·목록/보드·에픽 패널·만들기 대화상자가 한 화면에서 URL 상태를 나눠 쓰므로 화면 단위로 띄운다.
// 이슈 탭은 프로젝트 탭 레이아웃(머리줄·탭 줄·새 태스크 대화상자, WP-1477) 아래에서 그려지므로 레이아웃째 띄운다
// 기본 탭은 개요라(WP-1478) 조건 없는 /projects/:key 는 기억한 탭이 있어야 이슈 탭으로 열린다 — 렌더 도우미(renderScreen)가 렌더 전에
// 기억을 심는다(기본 WP, 다른 키는 options.projectTabs 로 넘긴다).
import ProjectDetailPage from '@/pages/projects/ProjectDetailPage'

import { projectTabsRoute } from './projectTabs'
import { renderRoutesScreen, type ScreenOptions } from './routeScreen'

/** 프로젝트 상세 화면(/projects/:key)만 띄운다. 검색 파라미터(?view=board 등)는 path 에 붙인다. WP 가 아닌 키는 options.projectTabs 로 이슈 탭을 심는다. */
export function renderProjectScreen(path: string, options: ScreenOptions = {}) {
  return renderRoutesScreen(projectTabsRoute(<ProjectDetailPage />), path, options)
}
