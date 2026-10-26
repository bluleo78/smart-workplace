// 저장된 뷰 칩 E2E — 호버 때만 보이는 ⋯ 메뉴(@input)와 긴 이름 칩 말줄임 폭(@layout)만 남긴다.
// 저장·수정 payload, 칩 적용 → URL, 삭제 확인·취소, 이름 검증, 단일 활성, status 복원, 소유자 권한은
// src/pages/projects/savedViews.test.tsx 페이지 테스트가 지킨다(WP-971).
import { expect, test } from '../../fixtures/auth.fixture'
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

// #315 — 뷰 칩 ⋯ 메뉴 버튼 hover-reveal 패턴 회귀 테스트.
test('뷰 칩 ⋯ 메뉴 버튼은 hover 전 숨겨지고 hover 후 표시된다 (refs #315)', { tag: '@input' }, async ({
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

// WP-502 — 60자 이름의 뷰 칩이 칩 줄 폭을 다 차지하지 않게 일정 폭에서 말줄임하고, 전체 이름은 title(툴팁)로 본다.
test('저장된 뷰 — 긴 이름 칩은 말줄임되고 전체 이름은 title 로 남는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
