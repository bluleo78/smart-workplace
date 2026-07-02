// 뷰칩 활성 판정 — 리스트/보드 전환이 저장된 뷰 쿼리와 view 파라미터만으로 우연히
// 일치해 "전체" 대신 저장뷰가 활성으로 표시되는 회귀 방지 (#599).
import { expect, test } from '../../fixtures/auth.fixture'
import { createIssueSearchResponse } from '../../factories/issue.factory'
import { createProject } from '../../factories/project.factory'
import type { SavedViewResponse } from '../../../src/types/savedView'

const KEY = 'WP'

async function setupCommonRoutes(page: import('@playwright/test').Page, views: SavedViewResponse[]) {
  await page.route(`**/api/v1/projects/${KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  )
  await page.route(`**/api/v1/projects/${KEY}/labels`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route(`**/api/v1/projects/${KEY}/types`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([], null)),
      }),
  )
  await page.route(`**/api/v1/projects/${KEY}/saved-views`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(views) }),
  )
}

test('뷰칩 — 필터 없이 view=board 인 저장뷰가 있어도 보드 전환 시 "전체"만 활성 (#599)', async ({
  authenticatedPage: page,
}) => {
  // 필터 없이 view=board 만 저장된 뷰 — 리스트/보드 토글이 만드는 URL과 우연히 충돌하는 케이스.
  const views: SavedViewResponse[] = [
    {
      id: 1, name: '탐색 테스트 뷰', query: 'view=board', visibility: 'PRIVATE',
      ownerId: 1, mine: true, pinned: false, createdAt: '', updatedAt: '',
    },
  ]
  await setupCommonRoutes(page, views)
  await page.goto(`/projects/${KEY}`)

  // 1) 초기 리스트뷰 — "전체" 활성, 저장뷰 칩은 비활성.
  await expect(page.getByTestId('view-chip-all')).toHaveClass(/border-foreground/)
  await expect(page.getByTestId('view-chip-1')).not.toHaveClass(/border-foreground/)

  // 2) 보드 뷰로 전환 — URL 은 view=board 로 바뀌지만, 필터가 없으므로 "전체"가 계속 활성이어야
  //    하고 저장뷰("탐색 테스트 뷰")는 활성화되면 안 된다.
  await page.getByRole('button', { name: '보드' }).click()
  await expect(page).toHaveURL(/view=board/)
  await expect(page.getByTestId('view-chip-all')).toHaveClass(/border-foreground/)
  await expect(page.getByTestId('view-chip-1')).not.toHaveClass(/border-foreground/)

  // 3) 다시 리스트로 전환해도 동일.
  await page.getByRole('button', { name: '리스트' }).click()
  await expect(page.getByTestId('view-chip-all')).toHaveClass(/border-foreground/)
  await expect(page.getByTestId('view-chip-1')).not.toHaveClass(/border-foreground/)
})

test('뷰칩 — 필터가 있는 저장뷰는 view 와 무관하게 필터 일치 시 활성화 (#599)', async ({
  authenticatedPage: page,
}) => {
  // priority=HIGH 필터를 가진 저장뷰 — view 파라미터 없이 저장됨(list 뷰에서 저장).
  const views: SavedViewResponse[] = [
    {
      id: 1, name: 'HIGH 필터 뷰', query: 'priority=HIGH', visibility: 'PRIVATE',
      ownerId: 1, mine: true, pinned: false, createdAt: '', updatedAt: '',
    },
  ]
  await setupCommonRoutes(page, views)
  await page.goto(`/projects/${KEY}?priority=HIGH`)

  // 1) 리스트뷰에서 필터가 저장뷰와 일치 — 저장뷰 칩 활성, "전체"는 비활성.
  await expect(page.getByTestId('view-chip-1')).toHaveClass(/border-foreground/)
  await expect(page.getByTestId('view-chip-all')).not.toHaveClass(/border-foreground/)

  // 2) 보드로 전환해도(view 만 바뀜, 필터는 그대로) 저장뷰가 계속 활성 상태를 유지해야 한다 —
  //    view 는 활성 판정에서 제외되는 축이므로.
  await page.getByRole('button', { name: '보드' }).click()
  await expect(page).toHaveURL(/view=board/)
  await expect(page).toHaveURL(/priority=HIGH/)
  await expect(page.getByTestId('view-chip-1')).toHaveClass(/border-foreground/)
  await expect(page.getByTestId('view-chip-all')).not.toHaveClass(/border-foreground/)
})
