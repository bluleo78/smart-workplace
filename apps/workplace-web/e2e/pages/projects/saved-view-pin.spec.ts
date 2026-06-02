// Saved View 사이드바 고정 E2E — 칩 메뉴 고정 토글(payload) → 사이드바 노출 → 클릭 이동.
import { expect, test } from '../../fixtures/auth.fixture'
import { createIssueSearchResponse } from '../../factories/issue.factory'
import { createProject } from '../../factories/project.factory'
import type { PinnedSavedViewResponse, SavedViewResponse } from '../../../src/types/savedView'

const KEY = 'WP'

test.describe('Saved View 사이드바 고정', () => {
  test('고정 토글 → 사이드바 노출 → 이동', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    // 고정 상태는 PATCH 시점에 토글되고, /saved-views·/me/pinned-views 응답이 이를 반영한다.
    let pinned = false

    // --- 사이드바 프로젝트 목록(useProjects) — 인증 fixture/참조 spec 에 없으므로 직접 모킹 ---
    await page.route('**/api/v1/projects?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          content: [createProject({ id: 1, key: KEY, name: '워크플레이스' })],
          page: 0,
          size: 20,
          totalElements: 1,
          totalPages: 1,
        }),
      }),
    )

    // --- 프로젝트 페이지 렌더에 필요한 side-route (참조 saved-views.spec.ts 와 동일 세트) ---
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

    // --- 저장된 뷰 목록(내 뷰 1건, 초기엔 미고정) — pinned 플래그를 요청 시점에 반영 ---
    await page.route(`**/api/v1/projects/${KEY}/saved-views`, (route) => {
      const views: SavedViewResponse[] = [
        {
          id: 10, name: '높은 우선순위', query: 'priority=HIGH', visibility: 'PRIVATE',
          ownerId: 1, mine: true, pinned, createdAt: '', updatedAt: '',
        },
      ]
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(views) })
    })

    // --- 고정 토글 PATCH — 본문 검증은 waitForRequest 로(핸들러 내 throw 시 hang 방지) ---
    await page.route(`**/api/v1/projects/${KEY}/saved-views/10/pin`, (route) => {
      pinned = true
      const updated: SavedViewResponse = {
        id: 10, name: '높은 우선순위', query: 'priority=HIGH', visibility: 'PRIVATE',
        ownerId: 1, mine: true, pinned: true, createdAt: '', updatedAt: '',
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) })
    })

    // --- 프로젝트 교차 고정뷰(사이드바) — 고정 후에만 1건 반환 ---
    await page.route('**/api/v1/me/pinned-views', (route) => {
      const items: PinnedSavedViewResponse[] = pinned
        ? [
            {
              id: 10, projectId: 1, projectKey: KEY, projectName: '워크플레이스',
              name: '높은 우선순위', query: 'priority=HIGH', createdAt: '',
            },
          ]
        : []
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(items) })
    })

    await page.goto(`/projects/${KEY}`)

    // 초기엔 고정 뷰 섹션이 없다(빈 목록 → 조건부 미렌더).
    await expect(page.getByTestId('sidebar-pinned-views')).toHaveCount(0)

    // (a) 칩 드롭다운 열고 고정 → PATCH payload { pinned: true } 검증.
    const pinReq = page.waitForRequest(
      (r) => r.url().endsWith(`/saved-views/10/pin`) && r.method() === 'PATCH',
    )
    await page.getByTestId('view-chip-menu-10').click()
    await page.getByTestId('view-pin-10').click()
    const req = await pinReq
    expect(req.postDataJSON()).toMatchObject({ pinned: true })

    // (b) 고정 후 /me/pinned-views 재조회(pinnedViews invalidate) → 사이드바 항목 노출 + 이름.
    await expect(page.getByTestId('sidebar-pinned-views')).toBeVisible()
    const pinnedLink = page.getByTestId('pinned-view-10')
    await expect(pinnedLink).toBeVisible()
    await expect(pinnedLink).toContainText('높은 우선순위')

    // (c) 사이드바 링크 클릭 → URL 이 /projects/{key}?{query} 로 이동.
    await pinnedLink.click()
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}\\?priority=HIGH`))
  })
})
