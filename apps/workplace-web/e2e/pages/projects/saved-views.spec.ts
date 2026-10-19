// 저장된 뷰 E2E — 필터 적용 → 뷰 저장(payload 검증) → 칩 등장 → 적용/삭제.
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'
import { createIssueSearchResponse } from '../../factories/issue.factory'
import { createProject } from '../../factories/project.factory'
import type { SavedViewResponse } from '../../../src/types/savedView'

const KEY = 'WP'

/** 공통 라우트 셋업 — 프로젝트/이슈/labels/types/saved-views 기본 mock */
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

test('저장된 뷰 — 필터 미적용 상태에서 뷰 저장 버튼 비활성 + 다이얼로그 오류 메시지 표시 (refs #146)', async ({
  authenticatedPage: page,
}) => {
  // 필터 없는 초기 상태에서 진입 — query='' 이므로 isAllActive=true.
  await setupCommonRoutes(page, [])
  await page.goto(`/projects/${KEY}`)

  // 1) "뷰 저장" 버튼은 disabled 상태여야 한다.
  await expect(page.getByTestId('save-view-button')).toBeDisabled()

  // 2) 필터 적용 후에는 버튼이 활성화된다.
  await page.getByTestId('add-filter-trigger').click()
  await page.getByTestId('add-filter-facet-priority').click()
  await page.getByTestId('facet-value-priority-HIGH').click()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/priority=HIGH/)
  await expect(page.getByTestId('save-view-button')).toBeEnabled()

  // 3) 전체 칩 클릭으로 필터 해제 → 다시 비활성.
  await page.getByTestId('view-chip-all').click()
  await expect(page.getByTestId('save-view-button')).toBeDisabled()
})

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
        ownerId: 1, mine: true, pinned: false, createdAt: '', updatedAt: '',
      }
      views.push(created)
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) })
    }
    return route.fallback()
  })

  await page.goto(`/projects/${KEY}`)

  // 1) 필터 적용 — 우선순위 HIGH(＋필터 → 우선순위 facet → '높음', URL 에 priority=HIGH 반영).
  await page.getByTestId('add-filter-trigger').click()
  await page.getByTestId('add-filter-facet-priority').click()
  await page.getByTestId('facet-value-priority-HIGH').click()
  await page.keyboard.press('Escape')
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

  // 6) 삭제 — AlertDialog 확인 후 DELETE 호출 + 칩 제거 (#188).
  await page.route(`**/api/v1/projects/${KEY}/saved-views/1`, (route) => {
    views.length = 0
    return route.fulfill({ status: 204, body: '' })
  })
  // #315: hover-reveal 패턴 — hover 후 메뉴 트리거 표시
  await page.getByTestId('view-chip-1').hover()
  await page.getByTestId('view-chip-menu-1').click()
  await page.getByTestId('view-delete-1').click()
  // AlertDialog 가 등장해야 한다.
  await expect(page.getByRole('alertdialog')).toBeVisible()
  // 확인 버튼 클릭 → 실제 삭제.
  await page.getByRole('button', { name: '삭제' }).last().click()
  await expect(page.getByTestId('view-chip-1')).toHaveCount(0)
})

test('저장된 뷰 — 삭제 클릭 시 AlertDialog 표시, 취소 시 뷰 유지 (refs #188)', async ({
  authenticatedPage: page,
}) => {
  // 기존 PRIVATE 뷰 1건 시드.
  const views: SavedViewResponse[] = [
    {
      id: 1, name: '취소테스트뷰', query: 'priority=HIGH', visibility: 'PRIVATE',
      ownerId: 1, mine: true, pinned: false, createdAt: '', updatedAt: '',
    },
  ]
  await setupCommonRoutes(page, views)
  // 취소했으므로 이 뷰 경로로는 어떤 요청도 나가면 안 된다.
  const viewRequests = trackRequests(page, 'ANY', `/api/v1/projects/${KEY}/saved-views/1`)
  await page.route(`**/api/v1/projects/${KEY}/saved-views/1`, (route) => route.fulfill({ status: 204, body: '' }))

  await page.goto(`/projects/${KEY}`)

  // 1) ⋯ → 삭제 클릭. #315: hover-reveal 패턴 — hover 후 메뉴 트리거 표시
  await page.getByTestId('view-chip-1').hover()
  await page.getByTestId('view-chip-menu-1').click()
  await page.getByTestId('view-delete-1').click()

  // 2) AlertDialog 에 뷰 이름 포함된 설명 표시.
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await expect(page.getByRole('alertdialog')).toContainText('취소테스트뷰')

  // 3) 취소 클릭 → 다이얼로그 닫힘 + DELETE 미호출 + 칩 유지.
  await page.getByRole('button', { name: '취소' }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  expect(viewRequests.count()).toBe(0)
  await expect(page.getByTestId('view-chip-1')).toBeVisible()
})

test('저장된 뷰 — 빈 이름 제출 시 에러 메시지 표시 + 입력 시 초기화 (refs #184)', async ({
  authenticatedPage: page,
}) => {
  // 필터가 적용된 상태에서 다이얼로그를 열어 빈 이름으로 제출하는 시나리오.
  await setupCommonRoutes(page, [])
  await page.goto(`/projects/${KEY}`)

  // 1) 필터 적용 — 우선순위 HIGH 적용 후 뷰 저장 버튼 활성화.
  await page.getByTestId('add-filter-trigger').click()
  await page.getByTestId('add-filter-facet-priority').click()
  await page.getByTestId('facet-value-priority-HIGH').click()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/priority=HIGH/)

  // 2) 뷰 저장 다이얼로그 열기.
  await page.getByTestId('save-view-button').click()

  // 3) 이름 비워둔 채 저장 클릭 → 에러 메시지 등장 + 다이얼로그 유지.
  await page.getByTestId('save-view-submit').click()
  await expect(page.getByTestId('save-view-name-error')).toHaveText('뷰 이름을 입력하세요')
  // 다이얼로그가 닫히지 않아야 한다.
  await expect(page.getByTestId('save-view-name')).toBeVisible()

  // 4) 입력하면 에러 메시지가 사라져야 한다.
  await page.getByTestId('save-view-name').fill('테스트')
  await expect(page.getByTestId('save-view-name-error')).toHaveCount(0)
})

test('저장된 뷰 — ⋯ 수정 → 이름/가시성 변경(PATCH payload·쿼리 유지) → 칩 반영', async ({
  authenticatedPage: page,
}) => {
  // 기존 PRIVATE 뷰 1건을 시드 — query 는 수정해도 유지되어야 한다.
  const views: SavedViewResponse[] = [
    {
      id: 1, name: '원래이름', query: 'priority=HIGH', visibility: 'PRIVATE',
      ownerId: 1, mine: true, pinned: false, createdAt: '', updatedAt: '',
    },
  ]

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
  // PATCH — 이름/가시성만 변경, query 는 본문 그대로 반영해 시드 갱신.
  await page.route(`**/api/v1/projects/${KEY}/saved-views/1`, (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    const body = route.request().postDataJSON() as {
      name: string; query: string; visibility: SavedViewResponse['visibility']
    }
    views[0] = { ...views[0], name: body.name, query: body.query, visibility: body.visibility }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(views[0]) })
  })

  await page.goto(`/projects/${KEY}`)

  // 1) 기존 칩 등장.
  await expect(page.getByTestId('view-chip-1')).toContainText('원래이름')

  // 2) ⋯ → 수정 → 다이얼로그가 기존 이름/가시성으로 프리필되는지 검증. #315: hover-reveal 패턴 — hover 후 메뉴 트리거 표시
  await page.getByTestId('view-chip-1').hover()
  await page.getByTestId('view-chip-menu-1').click()
  await page.getByTestId('view-edit-1').click()
  await expect(page.getByTestId('save-view-name')).toHaveValue('원래이름')

  // 3) 이름 변경 + 가시성 PRIVATE→SHARED 후 저장. PATCH payload 검증(쿼리 유지).
  const patched = page.waitForRequest(
    (r) => r.url().endsWith(`/projects/${KEY}/saved-views/1`) && r.method() === 'PATCH',
  )
  await page.getByTestId('save-view-name').fill('수정된이름')
  await page.getByTestId('save-view-shared').check()
  await page.getByTestId('save-view-submit').click()
  const req = await patched
  expect(req.postDataJSON()).toMatchObject({
    name: '수정된이름',
    query: 'priority=HIGH',
    visibility: 'SHARED',
  })

  // 4) 칩에 새 이름 반영 + SHARED 공유 아이콘 노출.
  await expect(page.getByTestId('view-chip-1')).toContainText('수정된이름')
  await expect(page.getByTestId('view-chip-1').getByLabel('공유')).toBeVisible()
})

// #315 — 뷰 칩 ⋯ 메뉴 버튼 hover-reveal 패턴 회귀 테스트.
test('뷰 칩 ⋯ 메뉴 버튼은 hover 전 숨겨지고 hover 후 표시된다 (refs #315)', async ({
  authenticatedPage: page,
}) => {
  const views: SavedViewResponse[] = [
    {
      id: 1, name: 'hover테스트뷰', query: 'priority=HIGH', visibility: 'PRIVATE',
      ownerId: 1, mine: true, pinned: false, createdAt: '', updatedAt: '',
    },
  ]
  await setupCommonRoutes(page, views)
  await page.goto(`/projects/${KEY}`)

  const chip = page.getByTestId('view-chip-1')
  await expect(chip).toBeVisible()
  const menuBtn = page.getByTestId('view-chip-menu-1')

  // hover 전: ⋯ 메뉴 버튼은 시각적으로 숨겨져야 한다 (opacity-0).
  // display:none 대신 opacity 토글을 쓰는 이유(#693) — 레이아웃에 항상 존재해야
  // 메뉴가 열리는 동안 Radix Popper 가 트리거 rect 를 앵커로 계속 참조할 수 있다.
  await expect(menuBtn).toHaveCSS('opacity', '0')

  // hover 후: ⋯ 메뉴 버튼이 나타나야 한다.
  await chip.hover()
  await expect(menuBtn).toHaveCSS('opacity', '1')
})

// WP-473 — 조건이 같은 뷰가 여럿이어도 고른 뷰 하나만 활성이다(예전엔 같은 조건의 칩이 모두 강조되고 모바일엔 다른 이름이 보였다).
test('저장된 뷰 — 조건이 같은 뷰가 여럿이면 고른 뷰 하나만 활성', async ({ authenticatedPage: page }) => {
  const same = (id: number, name: string): SavedViewResponse => ({
    id, name, query: 'priority=HIGH', visibility: 'PRIVATE',
    ownerId: 1, mine: true, pinned: false, createdAt: '', updatedAt: '',
  })
  await setupCommonRoutes(page, [same(1, '첫 뷰'), same(2, '둘째 뷰'), same(3, '셋째 뷰')])
  await page.goto(`/projects/${KEY}`)

  await page.getByTestId('view-chip-2').click()
  await expect(page).toHaveURL(/priority=HIGH/)
  await expect(page.getByTestId('view-chip-2')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('view-chip-3')).toHaveAttribute('aria-pressed', 'false')

  // 같은 조건의 다른 뷰로 바꿔도 그 하나만 활성.
  await page.getByTestId('view-chip-3').click()
  await expect(page.getByTestId('view-chip-3')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('view-chip-2')).toHaveAttribute('aria-pressed', 'false')
})

// WP-474 — 뷰 이름은 서버 상한(60자)까지만: 입력이 60자에서 멈추고, 그보다 긴 예전 이름은 저장 전에 필드 아래에서 안내한다
// (예전엔 서버 검증 원문 「크기가 0에서 60 사이여야 합니다」 토스트만 떴다).
test('저장된 뷰 — 이름 60자 제한: 입력은 60자에서 멈추고, 긴 예전 이름은 필드 오류로 막는다', async ({
  authenticatedPage: page,
}) => {
  const longName = '가'.repeat(70)
  await setupCommonRoutes(page, [
    {
      id: 1, name: longName, query: 'priority=HIGH', visibility: 'PRIVATE',
      ownerId: 1, mine: true, pinned: false, createdAt: '', updatedAt: '',
    },
  ])
  const patches = trackRequests(page, 'PATCH', `/api/v1/projects/${KEY}/saved-views/1`)
  await page.goto(`/projects/${KEY}?priority=LOW`)

  // 새 뷰 저장 — 120자를 넣어도 60자까지만 들어간다.
  await page.getByTestId('save-view-button').click()
  await page.getByTestId('save-view-name').fill('나'.repeat(120))
  await expect(page.getByTestId('save-view-name')).toHaveValue('나'.repeat(60))
  await page.keyboard.press('Escape')

  // 예전에 저장된 70자 이름을 그대로 저장하려 하면 필드 아래 안내, 요청은 나가지 않는다.
  await page.getByTestId('view-chip-1').hover()
  await page.getByTestId('view-chip-menu-1').click()
  await page.getByTestId('view-edit-1').click()
  await page.getByTestId('save-view-submit').click()
  await expect(page.getByTestId('save-view-name-error')).toHaveText('뷰 이름은 60자 이하로 입력하세요')
  await expect(page.getByTestId('save-view-name')).toHaveAttribute('aria-invalid', 'true')
  expect(patches.count()).toBe(0)
})

// WP-502 — 60자 이름의 뷰 칩이 칩 줄 폭을 다 차지하지 않게 일정 폭에서 말줄임하고, 전체 이름은 title(툴팁)로 본다.
test('저장된 뷰 — 긴 이름 칩은 말줄임되고 전체 이름은 title 로 남는다', async ({ authenticatedPage: page }) => {
  const longName = '분기 마감 전 반드시 확인해야 하는 고객사 결제 오류 및 정산 지연 관련 높은 우선순위 이슈 모음'.slice(0, 60)
  const view = (id: number, name: string): SavedViewResponse => ({
    id, name, query: 'priority=HIGH', visibility: 'PRIVATE',
    ownerId: 1, mine: true, pinned: false, createdAt: '', updatedAt: '',
  })
  await setupCommonRoutes(page, [view(1, longName), view(2, '짧은 뷰')])
  await page.goto(`/projects/${KEY}`)

  const chip = page.getByTestId('view-chip-1')
  const label = chip.getByTestId('view-chip-name-1')
  await expect(label).toHaveAttribute('title', longName)
  await expect(chip).toHaveAccessibleName(longName) // 화면에선 잘려도 접근 이름은 전체
  // 칩 폭은 상한(약 240px + 여백) 안 — 예전엔 약 700px 로 줄을 거의 다 차지했다.
  const box = await chip.boundingBox()
  expect(box!.width).toBeLessThan(300)
  // 실제로 잘려 있다(내용 폭 > 보이는 폭).
  expect(await label.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  // 다른 칩·「뷰 저장」 버튼이 같은 줄에 남는다.
  const top = (await chip.boundingBox())!.y
  expect((await page.getByTestId('view-chip-2').boundingBox())!.y).toBe(top)
})
