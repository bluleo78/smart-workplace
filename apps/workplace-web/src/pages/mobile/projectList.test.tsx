// 모바일 프로젝트 목록(WP-197) — 페이지 테스트(WP-981).
// 보조줄 문구 분기(OPEN 「접수함」·이슈 0건 「이슈 없음」)·개인 프로젝트 별 없음·행 탭 이동은 브라우저 없이 판정되므로
// e2e/pages/mobile/project-list.spec.ts 에서 옮겼다. 행 높이·말줄임·별 44px 같은 기하는 그 E2E 가 지킨다.
// 앱 셸을 보지 않으므로 프로젝트 목록 화면만 renderScreen 으로 띄운다 — 행 탭 뒤 상세는 그리지 않고 이동 주소만 본다(WP-1002).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { renderMobileRoute } from '@/test/kits/mobile/mobileScreen'
import { mockViewport } from '@/test/viewport'

import { createProject } from '../../../e2e/factories/project.factory'
import ProjectListPage from '../projects/ProjectListPage'

// 모바일 셸(iPhone 13 폭·터치) — 첫 렌더 전에 한 번.
mockViewport()

const PROJECTS = [
  createProject({ id: 1, key: 'WEB', name: '고객 포털 리뉴얼', type: 'TEAM', issueTotal: 12, issueDone: 5 }),
  createProject({ id: 2, key: 'OPN', name: '고객 요청 접수', type: 'OPEN', issueTotal: 0, issueDone: 0 }),
  createProject({ id: 3, key: 'EMP', name: '빈 팀 프로젝트', type: 'TEAM', issueTotal: 0, issueDone: 0 }),
  createProject({ id: 4, key: 'PME', name: '개인 작업', type: 'PERSONAL', isDefault: true, issueTotal: 3, issueDone: 1 }),
]

const handlers = [
  http.get('/api/v1/projects', () =>
    HttpResponse.json({ content: PROJECTS, page: 0, size: 20, totalElements: PROJECTS.length, totalPages: 1 }),
  ),
]

test('보조줄 — 팀은 키·%·개수, OPEN 은 「접수함」(이슈 0건이어도), 이슈 0건 팀은 「이슈 없음」, 개인은 별 없음', async () => {
  renderMobileRoute('/projects', <ProjectListPage />, { path: '/projects', handlers })
  // 진행률 42% = 5/12 반올림 — 보조줄 조합이 바뀌면 깨진다.
  expect(await screen.findByTestId('project-row-meta-WEB')).toHaveTextContent(
    /WEB\s*·\s*42%\s*·\s*12개/,
  )
  expect(screen.getByTestId('project-row-meta-OPN')).toHaveTextContent(/OPN\s*·\s*접수함/)
  expect(screen.getByTestId('project-row-meta-EMP')).toHaveTextContent(/EMP\s*·\s*이슈 없음/)
  expect(screen.getByTestId('fav-toggle-WEB')).toBeInTheDocument()
  expect(screen.queryByTestId('fav-toggle-PME')).not.toBeInTheDocument()
})

test('행(이름 영역)을 누르면 그 프로젝트 상세로 이동한다', async () => {
  const { user, location } = renderMobileRoute('/projects', <ProjectListPage />, { path: '/projects', handlers })
  const row = await screen.findByTestId('project-row-EMP')
  await user.click(within(row).getByRole('link'))
  await waitFor(() => expect(location()).toBe('/projects/EMP'))
})
