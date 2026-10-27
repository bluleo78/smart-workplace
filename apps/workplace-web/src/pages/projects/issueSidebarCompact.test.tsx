// 좁은 데스크톱 창(1280px 미만)의 작업 관리 사이드바 아이콘 줄(WP-506 B안) — 화면 테스트(WP-971, WP-1002 에서 작업 모듈 레이아웃만 띄우게(「내 작업」 이동 1건은 앱 라우트가 필요해 renderPage) 바꿈).
// 접힘 분기(data-compact·폭 조절 손잡이 없음·섹션 라벨 대신 구분선)·이름을 숨겨도 남는 링크 이름과 주소·
// 아이콘으로 남은 「새 프로젝트」가 생성 창을 여는 것은 브라우저 없이 판정되므로
// e2e/pages/projects/issue-sidebar-compact.spec.ts 에서 옮겼다. 56px·224px 폭과 창 넓히기(@layout)·호버 Tooltip(@input)은 E2E 에 남는다.
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { expect, test } from 'vitest'

import { IssueModuleLayout } from '@/components/issue/IssueModuleLayout'
import { projectFavoriteHandlers } from '@/test/kits/projects/projectFavorites'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { renderScreen } from '@/test/renderScreen'
import { mockViewport } from '@/test/viewport'
import type { ProjectResponse } from '@/types/project'

// 1100px 데스크톱(마우스) — 1280px 미만이라 사이드바가 아이콘 줄로 접힌다. matchMedia 결과가 파일 안에서 캐시되므로 맨 위에서 한 번.
mockViewport({ width: 1100, height: 800, pointer: 'fine' })

const eng: ProjectResponse = {
  id: 1,
  key: 'ENG',
  name: 'Engineering',
  description: null,
  ownerId: 1,
  type: 'TEAM',
  isDefault: false,
  createdAt: '',
  updatedAt: '',
  issueTotal: 0,
  issueDone: 0,
  memberCount: 0,
  memberNames: [],
  viewerIsMember: true,
}

/** ENG 를 즐겨찾기에 둔 채 /projects 를 열고 접힌 사이드바를 돌려준다. */
async function openProjects() {
  // 즐겨찾기는 서버에 저장한다(WP-1001) — ENG 만 담은 서버 목.
  const favorites = projectFavoriteHandlers(['ENG'])
  // 작업 모듈 레이아웃(사이드바 접힘 판정·폭 조절 손잡이)만 띄운다 — 본문 라우트는 비워 둔다.
  const view = renderScreen(
    <Routes>
      <Route element={<IssueModuleLayout />}>
        <Route path="/projects" element={null} />
      </Route>
    </Routes>,
    {
      path: '/projects',
      handlers: [
        ...favorites.handlers,
        http.get('/api/v1/projects', () => HttpResponse.json({ content: [eng], page: 0, size: 20, totalElements: 1, totalPages: 1 })),
        http.get('/api/v1/me/pinned-views', () => HttpResponse.json([])),
      ],
    },
  )
  const sidebar = await screen.findByTestId('issue-sidebar')
  return { ...view, sidebar }
}

test('1280px 미만이면 사이드바가 접히고(data-compact) 폭 조절 손잡이·섹션 라벨 글자가 없다', async () => {
  const { sidebar } = await openProjects()
  expect(sidebar).toHaveAttribute('data-compact', 'true')
  expect(screen.queryByTestId('sidebar-resize-handle')).not.toBeInTheDocument()
  // 섹션 라벨 글자는 그리지 않는다(구분선으로 대신).
  expect(within(sidebar).queryByText('프로젝트', { exact: true })).not.toBeInTheDocument()
})

test('이름은 sr-only 로 숨겨도 링크 이름·주소·선택 표시는 남는다', async () => {
  const { sidebar } = await openProjects()
  const myTasks = within(sidebar).getByRole('link', { name: '내 작업' })
  expect(within(myTasks).getByText('내 작업')).toHaveClass('sr-only')
  expect(await within(sidebar).findByRole('link', { name: 'Engineering' })).toHaveAttribute('href', '/projects/ENG')
  expect(within(sidebar).getByTestId('project-badge-ENG')).toBeInTheDocument()
  // Tooltip 트리거(Radix Slot)가 NavLink 의 함수형 className 을 망가뜨리면 선택 표시가 사라진다(SidebarNavLink 가 막는 회귀).
  const all = within(sidebar).getByRole('link', { name: '전체 보기' })
  expect(all).toHaveAttribute('aria-current', 'page')
  expect(all.className).toMatch(/selection-bar|bg-selected/)
})

// 「내 작업」 링크(/me/tasks)가 앱 라우트의 기본 탭 리다이렉트를 거쳐 도착하는 주소를 본다 — 앱 라우트 트리가 필요해 renderPage 로 연다.
test('「내 작업」을 누르면 기본 탭(할당)으로 이동한다', async () => {
  // 즐겨찾기는 서버에 저장한다(WP-1001) — ENG 만 서버에 둔다.
  const favorites = projectFavoriteHandlers(['ENG'])
  const { user, location } = renderPage('/projects', {
    handlers: [...favorites.handlers, http.get('/api/v1/projects', () => HttpResponse.json({ content: [eng], page: 0, size: 20, totalElements: 1, totalPages: 1 }))],
  })
  const sidebar = await screen.findByTestId('issue-sidebar', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await user.click(within(sidebar).getByRole('link', { name: '내 작업' }))
  // 새 화면 모듈을 처음 불러오는 시간이 들어 첫 화면과 같은 여유를 준다.
  await expect.poll(location, { timeout: PAGE_LOAD_TIMEOUT }).toBe('/me/tasks/assigned')
})

test('새 프로젝트 버튼도 아이콘으로 남아 생성 창을 연다', async () => {
  const { sidebar, user } = await openProjects()
  await user.click(within(sidebar).getByRole('button', { name: '새 프로젝트' }))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
})
