// 컨텐츠 헤더(PageHeader) 표준 — 프로젝트 목록·이슈 상세에 헤더 바가 제목·메타·액션과 함께 렌더.
import { createIssue, createIssueDetail } from '../factories/issue.factory'
import { createProject } from '../factories/project.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

test.describe('PageHeader — 프로젝트 목록', () => {
  test('헤더 바에 제목 "프로젝트" + 새 프로젝트 액션', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/projects', {
      content: [{ key: 'EX', name: '예제', description: '샘플' }],
      totalPages: 1,
      totalElements: 1,
    })
    await page.goto('/projects')

    const header = page.getByTestId('page-header')
    await expect(header).toBeVisible()
    await expect(header).toContainText('프로젝트')
    await expect(header).toHaveClass(/h-14/)
    await expect(header.getByRole('button', { name: '+ 새 프로젝트' })).toBeVisible()
  })
})

test.describe('PageHeader — 이슈 상세', () => {
  const PROJECT_KEY = 'WP'

  test('헤더 안에 제목·키 + watch/삭제 액션이 렌더된다', async ({
    authenticatedPage: page,
  }) => {
    // 프로젝트 단건(이슈 상세 진입 시 키 검증용 등).
    await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createProject()),
      }),
    )

    // 이슈 상세 — 제목/키가 헤더에 노출됨(projectKey-number = WP-1).
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1`,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback()
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            createIssueDetail({
              summary: createIssue({
                id: 1,
                number: 1,
                projectKey: PROJECT_KEY,
                title: '헤더 검증 이슈',
              }),
              body: '본문',
              comments: [],
              history: [],
            }),
          ),
        })
      },
    )

    // watchers 목록(헤더 watch 토글이 개수 표시 + aria 반영에 사용).
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/watchers`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )

    await page.goto(`/projects/${PROJECT_KEY}/issues/1`)

    const header = page.getByTestId('page-header')
    await expect(header).toBeVisible()
    await expect(header).toHaveClass(/h-14/)

    // 제목·키가 헤더 안에서 렌더(메타에 projectKey-number).
    await expect(header).toContainText('헤더 검증 이슈')
    await expect(header).toContainText(`${PROJECT_KEY}-1`)

    // 액션(watch 토글·삭제)이 헤더 안에 위치 — getByTestId 를 header 로 스코프.
    const watch = header.getByTestId('watch-toggle')
    await expect(watch).toBeVisible()
    await expect(watch).toHaveAttribute('aria-pressed', 'false')
    await expect(header.getByTestId('issue-delete')).toBeVisible()
  })
})
