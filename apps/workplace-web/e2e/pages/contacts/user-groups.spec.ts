// 사용자 그룹·조직도 E2E — 조직도 선택 → 트리·직속 멤버 배선(@wiring), 새 그룹 창의 긴 이름 폭(@layout) (page.route 모킹).
// 선택 표시·퀵필터·버튼 이름, 개인/공유 그룹 생성·수정·하위 추가·삭제 payload, 관리자 전용 노출, 오류 토스트·인라인 오류는
// src/components/contacts/userGroups.test.tsx 가 지킨다(WP-966).
import type { Page } from '@playwright/test'

import { personalDetail, sharedDetail, tree } from '../../factories/userGroups.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { expectGroupHeadersAligned } from '../../fixtures/group-tree-header'

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
  await expect(page.getByTestId('group-contact-view')).toBeVisible()
  await expect(page.getByTestId('group-member-MEMBER-2')).toContainText('이개발')

  // 사이드바 「전체」를 누르면 그룹 선택이 저절로 풀리고 통합 목록(빈 상태)이 돌아온다(WP-976 — 같은 노드 재클릭 토글 없음).
  await page.getByTestId('contact-filter-ALL').click()
  await expect(page.getByTestId('group-contact-view')).toBeHidden()
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

// WP-1870: 사이드바 머리 「＋」(새 그룹)은 데스크톱 32×32 로 눌리고(14px 맨 아이콘이던 것), 단추가 머리 줄 안에 들어
// 바로 아래 줄(첫 그룹 줄·빈 안내)을 덮지 않는다 — 덮으면 그 줄의 탭·클릭을 가로챈다(코드 리뷰 지적). jsdom 이 못 재는 기하.
test('사이드바 머리 ＋ 단추는 32×32 이고 아래 줄을 덮지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubContacts(page)
  await stubTree(page)
  await page.goto('/contacts')
  const add = page.getByTestId('group-create')
  await expect(add).toBeVisible()
  const box = (await add.boundingBox())!
  expect(Math.round(box.width)).toBe(32)
  expect(Math.round(box.height)).toBe(32)
  // 머리 줄(단추의 부모)이 단추를 세로로 다 품고, 그다음 형제(머리 아래 첫 요소)는 단추 아래에서 시작한다.
  const header = add.locator('..')
  const row = (await header.boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(row.y - 0.5)
  expect(box.y + box.height).toBeLessThanOrEqual(row.y + row.height + 0.5)
  const below = (await header.locator('xpath=following-sibling::*[1]').boundingBox())!
  expect(below.y).toBeGreaterThanOrEqual(box.y + box.height - 0.5)
  // 관리자가 아니라 조직도 머리에 ＋ 가 없어도 두 머리는 같은 높이(32 + 아래 여백 4)이고, ＋ 아이콘은 머리 글자 끝선에 맞는다.
  await expectGroupHeadersAligned(page.getByTestId('contact-sidebar'), add, 36)
})

// WP-1870: 마우스로 연 새 그룹 창을 「취소」로 닫으면 초점이 ＋ 로 돌아오지만, 키보드 초점이 아니라서 툴팁이 저절로 뜨지 않는다
// (그룹 삭제 뒤 초점 복원도 같은 경로) — :focus-visible 판정은 실제 브라우저의 입력 방식에 달려 jsdom 이 가릴 수 없다.
test('마우스로 연 새 그룹 창을 닫아 ＋ 로 초점이 돌아와도 툴팁이 뜨지 않는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await stubContacts(page)
  await stubTree(page)
  await page.goto('/contacts')
  const add = page.getByTestId('group-create')
  await add.click()
  const dialog = page.getByTestId('group-form-dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '취소' }).click()
  await expect(dialog).toBeHidden()
  await expect(add).toBeFocused()
  // 툴팁 지연(200ms)이 지나도 뜨지 않는지 — 부재 확인이라 짧게 기다린다.
  // eslint-disable-next-line playwright/no-wait-for-timeout -- 툴팁이 「뜨지 않음」 부재 확인이라 조건 대기로 바꿀 수 없다
  await page.waitForTimeout(400)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  // 키보드 초점이면 뜬다(대조) — Tab 으로 나갔다가 Shift+Tab 으로 돌아온다.
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(add).toBeFocused()
  await expect(page.getByRole('tooltip')).toHaveText('새 그룹')
})
