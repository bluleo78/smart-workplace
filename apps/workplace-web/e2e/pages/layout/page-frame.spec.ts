// 페이지 틀(Page) 정렬 E2E — 헤더 제목과 본문 첫 요소가 같은 16px 축에서 시작하는지, reading 폭이 왼쪽 정렬·768px 이하인지.
import { createProject } from '../../factories/project.factory'
import { createPageResponse, mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { DESKTOP_WIDTHS, boxOf, expectHeaderBottomAt56, expectStartAligned } from '../../fixtures/layout'

for (const width of DESKTOP_WIDTHS) {
  test.describe(`Page 정렬 @${width}px`, () => {
    test.use({ viewport: { width, height: 1000 } })

    test('프로젝트 목록(full) — 헤더 제목과 목록이 같은 x', async ({ authenticatedPage: page }) => {
      await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([createProject({ key: 'EX', name: '예제' })]))
      await page.goto('/projects')
      const header = page.getByTestId('page-header')
      await expectHeaderBottomAt56(header)
      await expectStartAligned(
        header.getByRole('heading', { level: 1 }),
        page.getByRole('list', { name: '프로젝트 목록' }),
      )
    })

    test('사이클(reading) — 본문 왼쪽 정렬, 폭 ≤ 768', async ({ authenticatedPage: page }) => {
      await mockApi(page, 'GET', '/api/v1/projects/WP', createProject({ key: 'WP' }))
      await mockApi(page, 'GET', '/api/v1/projects/WP/cycles', [])
      await mockApi(page, 'GET', '/api/v1/projects/WP/cycles/progress', [])
      await page.goto('/projects/WP/cycles')
      const header = page.getByTestId('page-header')
      await expectHeaderBottomAt56(header)
      const body = page.getByTestId('page-body-content')
      // 헤더의 ← 버튼과 본문 첫 요소(사이클 목록) 시작 x 일치(둘 다 16px 축).
      // page-body-content 자신의 상자는 여백(px-4)을 포함해 16px 앞에서 시작하므로 첫 자식으로 비교한다.
      await expectStartAligned(header.getByRole('button', { name: '프로젝트로 돌아가기' }), body.locator('> *').first())
      expect((await boxOf(body)).width).toBeLessThanOrEqual(768)
    })
  })
}
