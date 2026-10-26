// 사용자 그룹·조직도 E2E — 조직도 선택 → 트리·직속 멤버 배선(@wiring), 새 그룹 창의 긴 이름 폭(@layout) (page.route 모킹).
// 선택 표시·퀵필터·버튼 이름, 개인/공유 그룹 생성·수정·하위 추가·삭제 payload, 관리자 전용 노출, 오류 토스트·인라인 오류는
// src/components/contacts/userGroups.test.tsx 가 지킨다(WP-966).
import type { Page } from '@playwright/test'

import { personalDetail, sharedDetail, tree } from '../../factories/userGroups.factory'
import { expect, test } from '../../fixtures/auth.fixture'

// GET /api/v1/user-groups → 트리(기본: 공유 1개 + 개인 1개)
async function stubTree(page: Page, body = tree()) {
  await page.route(
    (url) => url.pathname === '/api/v1/user-groups',
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  )
}

// GET /api/v1/user-groups/:id → 각 그룹 상세
async function stubDetail(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/user-groups/10',
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sharedDetail()) }),
  )
  await page.route(
    (url) => url.pathname === '/api/v1/user-groups/20',
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(personalDetail()) }),
  )
}

// ContactsPage 마운트 시 useContacts 가 GET /contacts 를 페치하므로 ECONNREFUSED 누수 방지
async function stubContacts(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/contacts',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
      }),
  )
}

test('조직도(공유) 선택 시 트리+직속 멤버 렌더', { tag: ['@wiring', '@smoke'] }, async ({ authenticatedPage: page }) => {
  await stubContacts(page)
  await stubTree(page)
  await stubDetail(page)
  await page.goto('/contacts')
  await expect(page.getByTestId('group-node-10')).toBeVisible()
  await page.getByTestId('group-node-10').click()
  await expect(page.getByTestId('org-chart-view')).toBeVisible()
  await expect(page.getByTestId('group-member-MEMBER-2')).toContainText('이개발')

  // 같은 노드 재클릭 → 선택 해제, 통합 목록(빈 상태) 복원
  await page.getByTestId('group-node-10').click()
  await expect(page.getByTestId('org-chart-view')).toBeHidden()
  await expect(page.getByTestId('contact-empty')).toBeVisible()
})

// WP-548: 멤버 검색 결과·선택 칩의 이름이 아주 길어도 창이 옆으로 늘어나지 않고 저장 버튼이 창 안에 남는다(데스크톱·모바일).
for (const viewport of [
  { name: '데스크톱', width: 1440, height: 900 },
  { name: '모바일', width: 390, height: 844 },
]) {
  test(`새 그룹 창 — 긴 이름 검색 결과·선택 칩이 창 폭을 넘기지 않는다 (${viewport.name})`, { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    const longName =
      '남궁민수 (주)대한글로벌에너지솔루션 해외사업개발본부 중동아프리카 신규시장개척팀 수석컨설턴트 겸 파트너십 총괄'
    await stubTree(page)
    await stubDetail(page)
    await page.route(
      (url) => url.pathname === '/api/v1/contacts',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [{ type: 'EXTERNAL', id: 7, name: longName, email: null, title: null, organization: null }],
            nextCursor: null,
            hasMore: false,
          }),
        }),
    )

    await page.goto('/contacts')
    if (viewport.width < 1024) await page.getByTestId('mobile-sidebar-trigger').click()
    await page.getByTestId('group-create').click()
    const dialog = page.getByTestId('group-form-dialog')
    await expect(dialog).toBeVisible()
    const before = (await dialog.boundingBox())!.width

    await page.getByTestId('g-member-search').fill('남궁')
    await page.getByTestId('g-member-result-EXTERNAL-7').click()
    await expect(page.getByTestId('g-picked-remove-EXTERNAL-7')).toBeVisible()

    const box = (await dialog.boundingBox())!
    expect(box.width).toBeLessThanOrEqual(before + 1)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    // 저장 버튼이 창 안에 있다(창 밖으로 밀려나지 않음)
    const save = (await page.getByTestId('g-save').boundingBox())!
    expect(save.x + save.width).toBeLessThanOrEqual(box.x + box.width)
    // 창 내용이 가로로 스크롤되지 않는다
    expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
  })
}
