// 프로젝트 탭 화면 테스트 도우미(WP-1477) — 탭 레이아웃(머리줄·탭 줄·새 태스크 대화상자)과 탭 본문을 App 과 같은 라우트 모양으로 띄운다.
// 이슈 탭(/projects/:key)은 조건 없이 들어오면 기억한 탭으로 되돌리고, 기억이 없으면 기본 탭(개요, WP-1478)으로 간다.
// 이슈 목록·보드를 보는 테스트는 「전에 이슈 탭을 쓰던 사용자」로 연다 — 렌더 도우미(renderScreen·renderPage)가 렌더 전에 앱이 쓰는
// 실제 기억(localStorage project-tab:*)에 이슈 탭을 심는다(src/test/projectTabMemory, 기본 WP). 다른 탭을 미리 심는 테스트는
// 그 모듈의 rememberProjectTab 을 렌더 전에 부른다. 앱 모듈은 끊지 않는다.
import type { ReactElement } from 'react'
import { Route, Routes } from 'react-router-dom'

import ProjectDetailPage from '@/pages/projects/ProjectDetailPage'
import { ProjectTabsLayout } from '@/pages/projects/tabs/ProjectTabsLayout'

/**
 * 탭 레이아웃 라우트 아래 index(탭 본문) 하나. path 를 주면(기본 /projects/:key) renderRoutesScreen 에 넘기고,
 * null 이면 길 없는 레이아웃 라우트라 바깥 라우트(atRoute·renderMobileRoute 의 패턴) 안 Routes 에서 쓴다.
 */
export function projectTabsRoute(index: ReactElement, path: string | null = '/projects/:key') {
  return (
    <Route path={path ?? undefined} element={<ProjectTabsLayout />}>
      <Route index element={index} />
    </Route>
  )
}

/**
 * 탭 본문(사이클·버전·타임라인 등)을 탭 레이아웃 아래에서 그린다 — 라우트 패턴 하나의 element 로 넘긴다
 * (atRoute·renderMobileRoute 처럼 패턴 하나만 받는 도우미용). 탭 화면은 레이아웃이 불러온 프로젝트를 컨텍스트로 받으므로
 * 레이아웃 없이 띄우지 않는다. 안쪽 Routes 는 남은 길이 없을 때 index 를 잡는다.
 */
export function InProjectTabs({ children }: { children: ReactElement }) {
  return <Routes>{projectTabsRoute(children, null)}</Routes>
}

/**
 * 이슈 탭(ProjectDetailPage)을 탭 레이아웃 아래에서 그린다 — `/projects/:key` 라우트 하나의 element 로 넘긴다.
 * 조건 없는 주소를 이슈 탭으로 열려면 렌더 도우미가 그 키의 기억을 심어야 한다(기본 WP, 다른 키는 projectTabs 옵션).
 */
export function ProjectIssuesTab() {
  return (
    <InProjectTabs>
      <ProjectDetailPage />
    </InProjectTabs>
  )
}
