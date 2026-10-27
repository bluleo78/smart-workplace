// 작업 관리 2차 사이드바의 즐겨찾기 팀 프로젝트(WP-701) — 화면 테스트(WP-980, WP-1002 에서 사이드바만 띄우게 바꿈).
// API 응답(name/key) → 사이드바 링크(text/href)·이니셜 배지, 즐겨찾기 안 한 프로젝트 숨김은 브라우저 없이 판정되므로
// e2e/pages/projects/issue-sidebar.spec.ts 에서 옮겼다. 사이드바가 이슈 모듈에만 뜨는 배선은 그 spec 의 @wiring 이 지킨다.
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { IssueSidebar } from '@/components/issue/IssueSidebar'
import { renderScreen } from '@/test/renderScreen'

import { createProject } from '../../../e2e/factories/project.factory'

test('사이드바가 즐겨찾기한 팀 프로젝트만 링크로 렌더한다 (name → href, 이니셜 배지)', async () => {
  const eng = createProject({ id: 1, key: 'ENG', name: 'Engineering', type: 'TEAM' })
  // OPS 는 즐겨찾기 안 함 — 사이드바에 노출되지 않아야 한다(전체 보기로만 접근).
  const ops = createProject({ id: 2, key: 'OPS', name: 'Operations', type: 'TEAM' })
  // 즐겨찾기 키는 사용자·워크스페이스별(WP-701) — 목 사용자 id 1, 워크스페이스는 목 토큰에 따라 1 또는 없음.
  window.localStorage.setItem('project-favorites:1:1', JSON.stringify(['ENG']))
  window.localStorage.setItem('project-favorites:1:-', JSON.stringify(['ENG']))
  // 사이드바만 띄운다 — 화면이 부르는 조회는 전체 프로젝트·고정한 뷰 둘이다.
  renderScreen(<IssueSidebar />, {
    path: '/projects',
    handlers: [
      http.get('/api/v1/me/pinned-views', () => HttpResponse.json([])),
      http.get('/api/v1/projects', () => HttpResponse.json({ content: [eng, ops], page: 0, size: 20, totalElements: 2, totalPages: 1 })),
    ],
  })
  const sidebar = await screen.findByTestId('issue-sidebar')
  const link = await within(sidebar).findByRole('link', { name: 'Engineering' })
  expect(link).toHaveAttribute('href', '/projects/ENG')
  expect(within(sidebar).getByTestId('project-badge-ENG')).toHaveTextContent('EN')
  expect(within(sidebar).queryByTestId('team-project-OPS')).not.toBeInTheDocument()
})
