// 마우스 데스크톱의 연락처 행 동작을 키보드로도 쓴다(WP-844).
// 내 그룹 행 ⋯(WP-978 전엔 수정·삭제 아이콘). 예전엔 hover 때만 생겨(display:none) Tab 순서에 없었고, 목록 행 ☆ 는 초점을 받아도 투명했다.
// 투명도는 transition 이 있어 toHaveCSS 가 끝값이 될 때까지 기다린다.
import type { Page } from '@playwright/test'

import { external, page as makePage } from '../../factories/contacts.factory'
import { personalDetail, personalNode, tree } from '../../factories/userGroups.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

/** 연락처 목록·그룹 트리·내 그룹 상세 스텁. */
async function stub(page: Page) {
  await page.route((u) => u.pathname === '/api/v1/contacts', (r) => r.fulfill(json(makePage([external()]))))
  await page.route((u) => u.pathname === '/api/v1/user-groups', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json(tree())) : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/user-groups/20', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json(personalDetail())) : r.fallback())
}

test('내 그룹 — 키보드로 그룹 이름에 오면 ⋯ 가 나타나고 Tab·Enter 로 메뉴를 열어 수정 창을 연다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await stub(page)
  await page.goto('/contacts')
  const name = page.getByTestId('group-node-20')
  await expect(name).toBeVisible()
  // 평소엔 투명 — 마우스를 올리거나 행에 초점이 올 때만 보인다(WP-978: 수정·삭제는 행 ⋯ 메뉴 안).
  const more = page.getByTestId('group-more-20')
  await expect(more).toHaveCSS('opacity', '0')

  // 바로 앞 버튼(「내 그룹」 머리의 새 그룹)에서 Tab — 마우스 없이 키보드로 그룹 이름에 초점을 준다.
  // 하위 그룹이 없는 노드엔 접기 버튼이 없어(WP-923) 머리 버튼에서 출발한다.
  await page.getByTestId('group-create').focus()
  await page.keyboard.press('Tab')
  await expect(name).toBeFocused()
  await expect(more).toHaveCSS('opacity', '1')

  await page.keyboard.press('Tab')
  await expect(more).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('group-edit-20')).toBeVisible()
  await expect(page.getByTestId('group-delete-20')).toBeVisible()
  await page.getByTestId('group-edit-20').press('Enter')
  await expect(page.getByTestId('group-form-dialog')).toBeVisible()
})

test('내 그룹 — 마우스로 누른 뒤 포인터가 떠나면 ⋯ 는 다시 숨는다(키보드 초점일 때만 남는다)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await stub(page)
  await page.goto('/contacts')
  const more = page.getByTestId('group-more-20')
  await page.getByTestId('group-node-20').click()
  await expect(page.getByTestId('group-node-20')).toBeFocused()
  await page.mouse.move(900, 700)
  await expect(more).toHaveCSS('opacity', '0')
  // 안 보이는 동안은 눌리지 않는다.
  await expect(more).toHaveCSS('pointer-events', 'none')
})

test('하위 그룹을 키보드로 ⋯ → 삭제하면 초점이 body 로 빠지지 않고 부모 노드로 간다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  // 내 분류(20) 아래 하위(21). 삭제 뒤 트리 조회는 하위가 빠진 트리를 돌려준다.
  let deleted = false
  const withChild = tree({ personal: [personalNode({ children: [personalNode({ id: 21, name: '하위 분류', parentId: 20 })] })] })
  await page.route((u) => u.pathname === '/api/v1/contacts', (r) => r.fulfill(json(makePage([external()]))))
  await page.route((u) => u.pathname === '/api/v1/user-groups', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json(deleted ? tree() : withChild)) : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/user-groups/21', (r) => {
    if (r.request().method() !== 'DELETE') return r.fallback()
    deleted = true
    return r.fulfill({ status: 204, body: '' })
  })
  await page.goto('/contacts')

  // 하위 노드 이름에 초점 → Tab 으로 ⋯ → Enter 로 메뉴를 열고 「삭제」.
  await page.getByTestId('group-node-21').focus()
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('group-more-21')).toBeFocused()
  await page.keyboard.press('Enter')
  await page.getByTestId('group-delete-21').press('Enter')
  const confirm = page.getByTestId('group-delete-confirm-btn')
  await expect(confirm).toBeVisible()
  await confirm.press('Enter')

  await expect(page.getByTestId('group-node-21')).toHaveCount(0)
  await expect(page.getByTestId('group-delete-confirm')).toHaveCount(0)
  // ⋯ 트리거가 있던 행은 사라졌다 — 초점은 남은 부모 노드에 있어야 한다(body 가 아니라).
  await expect(page.getByTestId('group-node-20')).toBeFocused()
})

test('연락처 목록 — ☆ 는 키보드 초점을 받으면 보이고 Enter 로 즐겨찾기한다', async ({ authenticatedPage: page }) => {
  await stub(page)
  const posts = trackRequests(page, 'POST', '/api/v1/contacts/favorites')
  await page.route((u) => u.pathname === '/api/v1/contacts/favorites', (r) =>
    r.request().method() === 'POST' ? r.fulfill({ status: 204, body: '' }) : r.fallback())
  await page.goto('/contacts')

  const fav = page.getByTestId('contact-fav-EXTERNAL-100')
  await expect(fav).toHaveCSS('opacity', '0')
  await page.getByTestId('contact-row-EXTERNAL-100').locator('button').first().focus()
  await page.keyboard.press('Tab')
  await expect(fav).toBeFocused()
  await expect(fav).toHaveCSS('opacity', '1')

  await page.keyboard.press('Enter')
  await posts.waitFor()
  expect(posts.lastBody()).toMatchObject({ targetType: 'EXTERNAL', targetId: 100 })
})
