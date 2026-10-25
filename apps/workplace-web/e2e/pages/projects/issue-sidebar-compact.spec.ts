// 좁은 데스크톱 창(1280px 미만)에서 작업 관리 사이드바를 아이콘 줄로 접는다(WP-506 B안).
// 이름은 숨기되 링크의 접근 가능한 이름은 남고, 마우스를 올리면 Tooltip 으로 보인다. 넓은 창은 예전과 같다(폭 조절 틀).
import type { ProjectResponse } from '../../../src/types/project'
import { expect, test } from '../../fixtures/auth.fixture'

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

test.beforeEach(async ({ authenticatedPage: page }) => {
  // 즐겨찾기 키는 사용자·워크스페이스별(WP-701) — 목 사용자 id 1, 워크스페이스는 목 토큰에 따라 1 또는 없음.
  await page.addInitScript(() => {
    localStorage.setItem('project-favorites:1:1', JSON.stringify(['ENG']))
    localStorage.setItem('project-favorites:1:-', JSON.stringify(['ENG']))
  })
  await page.route('**/api/v1/projects**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ content: [eng], page: 0, size: 20, totalElements: 1, totalPages: 1 }),
    }),
  )
})

test.describe('좁은 데스크톱 창(1100px)', () => {
  test.use({ viewport: { width: 1100, height: 800 } })

  test('사이드바가 56px 아이콘 줄로 접히고 폭 조절 손잡이가 없다', async ({ authenticatedPage: page }) => {
    await page.goto('/projects')
    const sidebar = page.getByTestId('issue-sidebar')
    await expect(sidebar).toHaveAttribute('data-compact', 'true')
    expect(Math.round((await sidebar.boundingBox())!.width)).toBe(56)
    await expect(page.getByTestId('sidebar-resize-handle')).toHaveCount(0)
    // 섹션 라벨 글자는 그리지 않는다(구분선으로 대신).
    await expect(sidebar.getByText('프로젝트', { exact: true })).toHaveCount(0)
  })

  test('이름은 숨겨도 링크 이름은 남고, 마우스를 올리면 Tooltip 으로 보이며 누르면 이동한다', async ({ authenticatedPage: page }) => {
    await page.goto('/projects')
    const sidebar = page.getByTestId('issue-sidebar')
    const myTasks = sidebar.getByRole('link', { name: '내 작업' })
    await expect(myTasks).toBeVisible()
    // 링크 글자는 sr-only — 화면에 이름 글자가 그려지지 않는다.
    await expect(sidebar.getByText('내 작업', { exact: true })).not.toBeInViewport()

    await myTasks.hover()
    await expect(page.getByRole('tooltip', { name: '내 작업' })).toBeVisible()

    const team = sidebar.getByRole('link', { name: 'Engineering' })
    await expect(team).toHaveAttribute('href', '/projects/ENG')
    await expect(sidebar.getByTestId('project-badge-ENG')).toBeVisible()
    // 마우스를 한 번에 옮기면 Radix 는 첫 Tooltip 내용으로 가는 길(유예 영역)로 보고 닫지도, 다음을 열지도 않는다 —
    // 사람처럼 빈 곳을 거쳐 옮긴다.
    await page.mouse.move(700, 600, { steps: 5 })
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await team.hover()
    await expect(page.getByRole('tooltip', { name: 'Engineering' })).toBeVisible()

    // 접힌 링크도 선택 표시를 지킨다 — Tooltip 트리거(Radix Slot)가 NavLink 의 함수형 className 을 문자열로 망가뜨리면
    // 여백·선택 배경이 사라진다(SidebarNavLink 가 막는 회귀). 현재 경로(/projects)의 「전체 보기」가 선택이고 아이콘 칸 크기다.
    const all = sidebar.getByRole('link', { name: '전체 보기' })
    await expect(all).toHaveAttribute('aria-current', 'page')
    await expect(all).toHaveClass(/selection-bar|bg-selected/)
    expect(Math.round((await all.boundingBox())!.height)).toBeGreaterThanOrEqual(32)

    await myTasks.click()
    await expect(page).toHaveURL(/\/me\/tasks$/)
  })

  test('새 프로젝트 버튼도 아이콘으로 남아 생성 창을 연다', async ({ authenticatedPage: page }) => {
    await page.goto('/projects')
    await page.getByTestId('issue-sidebar').getByRole('button', { name: '새 프로젝트' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })
})

test('창을 1280px 이상으로 넓히면 예전처럼 펼친 사이드바(224px·폭 조절)로 돌아온다', async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  await page.goto('/projects')
  await expect(page.getByTestId('issue-sidebar')).toHaveAttribute('data-compact', 'true')

  await page.setViewportSize({ width: 1280, height: 800 })
  const sidebar = page.getByTestId('issue-sidebar')
  await expect(sidebar).not.toHaveAttribute('data-compact')
  await expect(page.getByTestId('sidebar-resize-handle')).toBeVisible()
  expect(Math.round((await sidebar.boundingBox())!.width)).toBe(224)
  await expect(sidebar.getByText('작업 관리', { exact: true })).toBeVisible()
})
