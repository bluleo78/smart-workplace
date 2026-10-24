// 할 일 범주 기본(GRAY) 상태 아이콘 대비(WP-809 디자이너 리뷰 M1) — WCAG 1.4.11 UI 아이콘 3:1.
// 상태 색을 고를 수 있게 되면서 할 일 아이콘은 상태를 구분하는 필수 아이콘이 됐다(목록 상태 열은 아이콘만 있다).
// 예전 muted/60 은 2.5~2.9:1 로 미달 — muted/80 으로 올렸다. 라이트·다크 모두 실제로 칠해진 색(svg currentColor)으로 잰다.
import { createIssueSearchResponse } from '../../factories/issue.factory'
import { createMember, createProject } from '../../factories/project.factory'
import { inServerOrder, seedStatuses } from '../../factories/projectStatus.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { expectTheme, textContrast, withTheme } from '../../fixtures/contrast'
import { mockProjectSettings, mockStatusManagement } from '../../fixtures/project-settings-mocks'

const KEY = 'WP'
const UI_ICON = 3

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme}`, () => {
    test('설정 상태 행 — 할 일 아이콘', async ({ authenticatedPage: page }) => {
      await withTheme(page, theme)
      await mockProjectSettings(page, [createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'OWNER' })])
      await mockStatusManagement(page, { statuses: seedStatuses() })
      await page.goto(`/projects/${KEY}/settings`)
      await expectTheme(page, theme)
      const icon = page.getByTestId('status-row-1').locator('svg.lucide-circle')
      await expect(icon).toBeVisible()
      const ratio = await textContrast(icon)
      // 측정값을 보고서에 남길 수 있게 주석으로 싣는다(JSON 리포터).
      test.info().annotations.push({ type: 'contrast', description: ratio.toFixed(2) })
      expect(ratio).toBeGreaterThanOrEqual(UI_ICON)
    })

    test('보드 컬럼 헤더 — 할 일 아이콘', async ({ authenticatedPage: page }) => {
      await withTheme(page, theme)
      await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, createProject())
      await mockApi(page, 'GET', `/api/v1/projects/${KEY}/members`, [createMember({ userId: 1, role: 'OWNER' })])
      await mockApi(page, 'GET', `/api/v1/projects/${KEY}/statuses`, inServerOrder(seedStatuses()))
      await page.route(
        (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
        (route) => (route.request().method() === 'GET' ? route.fulfill({ json: createIssueSearchResponse([]) }) : route.fallback()),
      )
      await page.goto(`/projects/${KEY}?view=board`)
      await expectTheme(page, theme)
      // 헤더의 상태 아이콘은 개수 표시(board-col-count-1)와 같은 묶음 안 첫 svg.
      const icon = page.getByTestId('board-col-count-1').locator('xpath=..').locator('svg').first()
      await expect(icon).toBeVisible()
      const ratio = await textContrast(icon)
      // 측정값을 보고서에 남길 수 있게 주석으로 싣는다(JSON 리포터).
      test.info().annotations.push({ type: 'contrast', description: ratio.toFixed(2) })
      expect(ratio).toBeGreaterThanOrEqual(UI_ICON)
    })
  })
}
