import { expect, test } from '../fixtures/auth.fixture'

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
  await expect(page.getByTestId('issue-sidebar').getByRole('link', { name: '내 태스크' })).toBeVisible()

  await page.goto('/')
  await expect(page.getByTestId('issue-sidebar')).toHaveCount(0)
})
