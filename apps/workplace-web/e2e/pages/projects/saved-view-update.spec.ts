// 저장된 뷰 필터 갱신 E2E (#777) — 뷰 생성 → 필터 변경(dirty) → "뷰 업데이트" → 동일 id PATCH →
// 새로고침 후에도 갱신된 필터 유지. 필터 미변경 상태에서는 저장 버튼이 비활성이어야 한다.
import { expect, test } from '../../fixtures/auth.fixture'
import { createIssueSearchResponse } from '../../factories/issue.factory'
import { createProject } from '../../factories/project.factory'
import type { SavedViewResponse } from '../../../src/types/savedView'

const KEY = 'WP'

test('저장된 뷰 — 필터 변경 후 "뷰 업데이트" 클릭 시 동일 id 로 PATCH, 새로고침 후에도 유지 (#777)', async ({
  authenticatedPage: page,
}) => {
  // 서버측 상태를 흉내내는 로컬 배열 — GET/POST/PATCH 가 이를 공유해 새로고침 시에도 갱신값이 반영된다.
  const views: SavedViewResponse[] = []

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
  await page.route(`**/api/v1/projects/${KEY}/saved-views`, async (route) => {
    const m = route.request().method()
    if (m === 'GET')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(views) })
    if (m === 'POST') {
      const body = route.request().postDataJSON() as { name: string; query: string; visibility: string }
      const created: SavedViewResponse = {
        id: views.length + 1, name: body.name, query: body.query,
        visibility: body.visibility as SavedViewResponse['visibility'],
        ownerId: 1, mine: true, pinned: false, createdAt: '', updatedAt: '',
      }
      views.push(created)
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) })
    }
    return route.fallback()
  })
  // PATCH — id 는 항상 1로 고정되어야 한다(재생성이 아니라 갱신임을 뒷받침).
  await page.route(`**/api/v1/projects/${KEY}/saved-views/1`, (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    const body = route.request().postDataJSON() as {
      name: string; query: string; visibility: SavedViewResponse['visibility']
    }
    views[0] = { ...views[0], name: body.name, query: body.query, visibility: body.visibility }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(views[0]) })
  })

  await page.goto(`/projects/${KEY}`)

  // 1) 필터 적용(HIGH) 후 뷰 저장.
  await page.getByTestId('add-filter-trigger').click()
  await page.getByTestId('add-filter-facet-priority').click()
  await page.getByTestId('facet-value-priority-HIGH').click()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/priority=HIGH/)

  const posted = page.waitForRequest(
    (r) => r.url().endsWith(`/projects/${KEY}/saved-views`) && r.method() === 'POST',
  )
  await page.getByTestId('save-view-button').click()
  await page.getByTestId('save-view-name').fill('내 뷰')
  await page.getByTestId('save-view-submit').click()
  await posted
  await expect(page.getByTestId('view-chip-1')).toContainText('내 뷰')

  // 2) 저장 직후(필터 미변경) — "뷰 저장" 버튼은 비활성이어야 한다(저장할 변경 없음).
  await expect(page.getByTestId('save-view-button')).toBeDisabled()
  await expect(page.getByTestId('update-view-button')).toHaveCount(0)

  // 3) 필터 변경(HIGH → MID 추가) → dirty 상태 → "뷰 업데이트" 버튼 등장.
  await page.getByTestId('add-filter-trigger').click()
  await page.getByTestId('add-filter-facet-priority').click()
  await page.getByTestId('facet-value-priority-MID').click()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/priority=HIGH%2CMID|priority=MID%2CHIGH/)
  await expect(page.getByTestId('update-view-button')).toBeVisible()

  // 4) "뷰 업데이트" 클릭 → 동일 id(1) 로 PATCH, query 는 현재 필터.
  const patched = page.waitForRequest(
    (r) => r.url().endsWith(`/projects/${KEY}/saved-views/1`) && r.method() === 'PATCH',
  )
  await page.getByTestId('update-view-button').click()
  const req = await patched
  const payload = req.postDataJSON() as { name: string; query: string; visibility: string }
  expect(payload.name).toBe('내 뷰')
  expect(payload.query).toContain('priority=')
  expect(payload.query).toContain('HIGH')
  expect(payload.query).toContain('MID')

  // 5) 업데이트 후 다시 필터 미변경 상태 — 저장 버튼 비활성으로 복귀.
  await expect(page.getByTestId('save-view-button')).toBeDisabled()

  // 6) 새로고침 — 뷰 id 는 여전히 1(재생성 아님)이고, 칩 클릭 시 갱신된 필터가 복원되어야 한다.
  await page.reload()
  await expect(page.getByTestId('view-chip-1')).toContainText('내 뷰')
  await page.getByTestId('view-chip-all').click()
  await expect(page).not.toHaveURL(/priority=/)
  await page.getByTestId('view-chip-1').click()
  await expect(page).toHaveURL(/priority=HIGH%2CMID|priority=MID%2CHIGH/)
})
