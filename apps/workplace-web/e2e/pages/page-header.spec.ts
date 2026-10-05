// 컨텐츠 헤더(PageHeader) 표준 — 프로젝트 목록·이슈 상세에 헤더 바가 제목·메타·액션과 함께 렌더.
import { createIssue, createIssueDetail } from '../factories/issue.factory'
import { createProject } from '../factories/project.factory'
import { createPageResponse, mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

test.describe('PageHeader — 프로젝트 목록', () => {
  test('헤더 바에 제목 "프로젝트" + 새 프로젝트 액션', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([createProject({ key: 'EX', name: '예제' })]))
    await page.goto('/projects')

    const header = page.getByTestId('page-header')
    await expect(header).toBeVisible()
    await expect(header).toContainText('프로젝트')
    await expect(header).toHaveClass(/h-14/)
    // 제목이 a11y heading(level 1)으로 노출돼야 한다 — span 이 아니라 h1 (refs #121).
    await expect(header.getByRole('heading', { level: 1, name: '프로젝트' })).toBeVisible()
    await expect(header.getByRole('button', { name: '+ 새 프로젝트' })).toBeVisible()
  })
})

test.describe('PageHeader — 이슈 상세', () => {
  const PROJECT_KEY = 'WP'

  test('헤더엔 브레드크럼(키)+watch/삭제 액션, 본문엔 제목이 렌더된다', async ({
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

    // 헤더엔 브레드크럼(키)만 — 제목은 헤더에서 빠졌다(본문 상단으로 이동, Jira 스타일).
    await expect(header).toContainText(`${PROJECT_KEY}-1`)
    await expect(header).not.toContainText('헤더 검증 이슈')

    // 제목은 본문 상단 heading 에서 렌더.
    await expect(page.getByTestId('issue-title-heading')).toContainText('헤더 검증 이슈')

    // 액션(watch 토글·삭제)이 헤더 안에 위치 — getByTestId 를 header 로 스코프.
    const watch = header.getByTestId('watch-toggle')
    await expect(watch).toBeVisible()
    await expect(watch).toHaveAttribute('aria-pressed', 'false')
    await expect(header.getByTestId('issue-delete')).toBeVisible()
  })
})

test.describe('PageHeader — 전체폭 본문 페이지 정렬 (#880)', () => {
  // 넓은 화면에서 contained(container mx-auto) 헤더는 제목·액션이 가운데로 몰려 전체폭 본문과 어긋난다.
  // 전체폭 본문 페이지는 헤더도 전체폭이어야 한다 — 제목은 좌측 끝, 액션은 우측 끝에 붙는지 검증.
  // container 최대폭(1536px)보다 넓어야 어긋남이 드러난다.
  test.use({ viewport: { width: 2000, height: 900 } })

  for (const path of ['/projects/WP', '/projects/WP/timeline?period=all']) {
    test(`${path} 헤더 제목·액션이 헤더 좌우 끝에 붙는다`, async ({ authenticatedPage: page }) => {
      await mockApi(page, 'GET', '/api/v1/projects/WP', createProject())
      await page.goto(path)

      const header = page.getByTestId('page-header')
      const heading = header.getByRole('heading', { level: 1 })
      await expect(heading).toBeVisible()
      const [h, title, lastAction] = (await Promise.all([
        header.boundingBox(),
        heading.boundingBox(),
        header.getByRole('button').last().boundingBox(),
      ])).map((b) => b!)
      // px-4(16px) + 아이콘/여유 — container 축이면 수백 px 벌어진다.
      expect(title.x - h.x).toBeLessThan(80)
      expect(h.x + h.width - (lastAction.x + lastAction.width)).toBeLessThan(40)
    })
  }
})
