import type { ProjectResponse } from '../../../src/types/project'
import { expect, test } from '../../fixtures/auth.fixture'

test('이슈 모듈에 2차 사이드바가 보이고 홈에는 없다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  // useProjects 는 PageResponse<ProjectResponse> 형태(content 배열) 를 기대한다.
  await page.route('**/api/v1/projects**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }),
    }),
  )
  await page.goto('/projects')
  await expect(page.getByTestId('issue-sidebar')).toBeVisible()
  // 앱 타이틀 헤더("작업 관리")로 현재 앱을 식별할 수 있다(Slack 모델)
  await expect(page.getByTestId('issue-sidebar').getByText('작업 관리', { exact: true })).toBeVisible()
  await expect(page.getByTestId('issue-sidebar').getByRole('link', { name: '내 작업' })).toBeVisible()
  await expect(page.getByTestId('issue-sidebar').getByRole('link', { name: 'AI 위임 작업' })).toBeVisible()

  await page.goto('/')
  await expect(page.getByTestId('issue-sidebar')).toHaveCount(0)
})

test('사이드바가 즐겨찾기한 팀 프로젝트를 링크로 렌더한다 (name → href)', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  // 팀 프로젝트는 즐겨찾기한 것만 사이드바에 노출 — localStorage 에 ENG 를 미리 즐겨찾기로 시드.
  await page.addInitScript(() => {
    localStorage.setItem('project-favorites', JSON.stringify(['ENG']))
  })
  // API 응답(name/key) → 사이드바 NavLink(text/href) 매핑까지 검증한다.
  const project: ProjectResponse = {
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
  // 두 번째 팀 프로젝트(OPS)는 즐겨찾기 안 함 — 사이드바에 노출되지 않아야 한다.
  const ops: ProjectResponse = { ...project, id: 2, key: 'OPS', name: 'Operations' }
  await page.route('**/api/v1/projects**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ content: [project, ops], page: 0, size: 20, totalElements: 2, totalPages: 1 }),
    }),
  )
  await page.goto('/projects')
  const link = page.getByTestId('issue-sidebar').getByRole('link', { name: 'Engineering' })
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', '/projects/ENG')
  // 프로젝트 항목은 컬러 식별자(이니셜 배지)를 갖는다 — 아이콘 일관성. 사이드바 내로 스코핑.
  await expect(page.getByTestId('issue-sidebar').getByTestId('project-badge-ENG')).toHaveText('EN')
  // 즐겨찾기 안 한 OPS 는 사이드바에 없다(전체 보기로만 접근).
  await expect(page.getByTestId('issue-sidebar').getByTestId('team-project-OPS')).toHaveCount(0)
})
