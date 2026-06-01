// 저장된 뷰 E2E — 필터 적용 → 뷰 저장(payload 검증) → 칩 등장 → 적용/삭제.
import { expect, test } from '../../fixtures/auth.fixture'
import { createIssueSearchResponse } from '../../factories/issue.factory'
import { createProject } from '../../factories/project.factory'
import type { SavedViewResponse } from '../../../src/types/savedView'

const KEY = 'WP'

test('저장된 뷰 — 필터 저장 → 칩 등장 → 클릭 시 필터 복원 → 삭제', async ({
  authenticatedPage: page,
}) => {
  const views: SavedViewResponse[] = []

  await page.route(`**/api/v1/projects/${KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  )
  await page.route(`**/api/v1/projects/${KEY}/labels`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  // 유형 목록 엔드포인트는 /types (listIssueTypes 와 동일 경로) — /issue-types 아님.
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
        ownerId: 1, mine: true, createdAt: '', updatedAt: '',
      }
      views.push(created)
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) })
    }
    return route.fallback()
  })

  await page.goto(`/projects/${KEY}`)

  // 1) 필터 적용 — 우선순위 HIGH('높음' 버튼, URL 에 priority=HIGH 반영).
  //    IssueFilterBar 의 priority 버튼은 텍스트가 고유('높음') 하므로 role 셀렉터로 직접 클릭한다.
  await page.getByRole('button', { name: '높음' }).click()
  await expect(page).toHaveURL(/priority=HIGH/)

  // 2) ＋뷰 저장 → 다이얼로그 → 이름 입력 → 저장. POST payload 검증.
  const posted = page.waitForRequest(
    (r) => r.url().endsWith(`/projects/${KEY}/saved-views`) && r.method() === 'POST',
  )
  await page.getByTestId('save-view-button').click()
  await page.getByTestId('save-view-name').fill('내 HIGH')
  await page.getByTestId('save-view-submit').click()
  const req = await posted
  expect(req.postDataJSON()).toMatchObject({ name: '내 HIGH', visibility: 'PRIVATE' })
  expect((req.postDataJSON() as { query: string }).query).toContain('priority=HIGH')

  // 3) 칩 등장.
  await expect(page.getByTestId('view-chip-1')).toContainText('내 HIGH')

  // 4) 필터 해제(전체) → URL 에서 priority 제거.
  await page.getByTestId('view-chip-all').click()
  await expect(page).not.toHaveURL(/priority=HIGH/)

  // 5) 저장된 칩 클릭 → 필터 복원.
  await page.getByTestId('view-chip-1').click()
  await expect(page).toHaveURL(/priority=HIGH/)

  // 6) 삭제 — DELETE 호출 + 칩 제거.
  await page.route(`**/api/v1/projects/${KEY}/saved-views/1`, (route) => {
    views.length = 0
    return route.fulfill({ status: 204, body: '' })
  })
  await page.getByTestId('view-chip-menu-1').click()
  await page.getByTestId('view-delete-1').click()
  await expect(page.getByTestId('view-chip-1')).toHaveCount(0)
})
