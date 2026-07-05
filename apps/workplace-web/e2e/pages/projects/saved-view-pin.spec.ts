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
    // #315: hover-reveal 패턴 — hover 후 메뉴 트리거 표시
    await page.getByTestId('view-chip-10').hover()
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

  test('뷰 메뉴 트리거 rect — 열림 중에도 유효해 Radix 앵커가 좌상단으로 폴백하지 않음 (#693)', async ({
    authenticatedPage: page,
  }) => {
    // 트리거가 hidden→inline-flex 토글이면 메뉴가 열리는 순간 :hover 판정이 사라져
    // display:none(rect 전부 0)이 되고, Radix Popper 가 앵커를 잃어 뷰포트(0,0) 폴백으로 렌더링된다.
    // opacity 토글(레이아웃엔 항상 존재)로 고치면 트리거 rect 가 항상 유효해야 한다.
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
    await page.route(`**/api/v1/projects/${KEY}/saved-views`, (route) => {
      const views: SavedViewResponse[] = [
        {
          id: 10, name: '높은 우선순위', query: 'priority=HIGH', visibility: 'PRIVATE',
          ownerId: 1, mine: true, pinned: false, createdAt: '', updatedAt: '',
        },
      ]
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(views) })
    })
    await page.route('**/api/v1/me/pinned-views', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )

    await page.goto(`/projects/${KEY}`)

    await page.getByTestId('view-chip-10').hover()
    const trigger = page.getByTestId('view-chip-menu-10')
    await trigger.click()

    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()

    // 트리거 rect 가 붕괴(width/height 0)돼 있으면 앵커 상실 신호.
    const triggerBox = await trigger.boundingBox()
    expect(triggerBox).not.toBeNull()
    expect(triggerBox!.width).toBeGreaterThan(0)
    expect(triggerBox!.height).toBeGreaterThan(0)

    // 메뉴는 트리거 근처(뷰 칩 바, 화면 상단)에 떠야 한다 — 좌상단(사이드바 위) 폴백 좌표(x<10,y<10)가 아니어야 함.
    const menuBox = await menu.boundingBox()
    expect(menuBox).not.toBeNull()
    expect(menuBox!.x).toBeGreaterThan(50)
    expect(Math.abs(menuBox!.y - triggerBox!.y)).toBeLessThan(200)
  })

  test('고정된 뷰 삭제 → 사이드바 고정 뷰 섹션도 즉시 갱신됨 (#614)', { tag: '@smoke' }, async ({
    authenticatedPage: page,
  }) => {
    // 뷰가 이미 고정된 상태로 시작 — 삭제 시 pinnedViews invalidate 여부만 검증.
    let deleted = false

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

    // 저장된 뷰 목록 — 삭제 후에는 빈 배열 반환.
    await page.route(`**/api/v1/projects/${KEY}/saved-views`, (route) => {
      const views: SavedViewResponse[] = deleted
        ? []
        : [
            {
              id: 10, name: '높은 우선순위', query: 'priority=HIGH', visibility: 'PRIVATE',
              ownerId: 1, mine: true, pinned: true, createdAt: '', updatedAt: '',
            },
          ]
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(views) })
    })

    // 삭제 DELETE.
    await page.route(`**/api/v1/projects/${KEY}/saved-views/10`, (route) => {
      deleted = true
      return route.fulfill({ status: 204, body: '' })
    })

    // 사이드바 고정뷰 — 삭제 전엔 1건, 삭제 후엔 0건.
    await page.route('**/api/v1/me/pinned-views', (route) => {
      const items: PinnedSavedViewResponse[] = deleted
        ? []
        : [
            {
              id: 10, projectId: 1, projectKey: KEY, projectName: '워크플레이스',
              name: '높은 우선순위', query: 'priority=HIGH', createdAt: '',
            },
          ]
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(items) })
    })

    await page.goto(`/projects/${KEY}`)

    // 삭제 전 — 사이드바 고정 뷰 섹션에 노출됨.
    await expect(page.getByTestId('sidebar-pinned-views')).toBeVisible()
    await expect(page.getByTestId('pinned-view-10')).toBeVisible()

    // 삭제 — AlertDialog 확인 후 DELETE.
    await page.getByTestId('view-chip-10').hover()
    await page.getByTestId('view-chip-menu-10').click()
    await page.getByTestId('view-delete-10').click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page.getByRole('button', { name: '삭제' }).last().click()

    // 삭제 후 — 상단 칩뿐 아니라 사이드바 고정 뷰 섹션도 즉시 사라져야 한다(pinnedViews invalidate).
    await expect(page.getByTestId('view-chip-10')).toHaveCount(0)
    await expect(page.getByTestId('sidebar-pinned-views')).toHaveCount(0)
  })
})
