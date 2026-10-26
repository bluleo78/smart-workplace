// 작업 관리 2차 사이드바 E2E — 라우트별 노출 배선(@wiring) 한 줄기만 남긴다.
// 즐겨찾기 팀 프로젝트 링크(name → href·배지·비즐겨찾기 숨김)는 페이지 테스트 src/pages/projects/issueSidebar.test.tsx 가 지킨다(WP-980).
import { expect, test } from '../../fixtures/auth.fixture'

test('이슈 모듈에 2차 사이드바가 보이고 홈에는 없다', { tag: ['@wiring', '@smoke'] }, async ({ authenticatedPage: page }) => {
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
