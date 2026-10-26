// 마우스 데스크톱의 연락처 행 동작을 키보드로도 쓴다(WP-844).
// 예전엔 내 그룹의 수정·삭제가 hover 때만 생겨(display:none) Tab 순서에 없었고, 목록 행 ☆ 는 초점을 받아도 투명했다.
// 투명도는 transition 이 있어 toHaveCSS 가 끝값이 될 때까지 기다린다.
// 실제 Tab 초점 이동·포인터 이탈과 :focus-visible 계열 CSS 투명도는 jsdom 이 판정할 수 없어 모두 @input 으로 남는다.
import type { Page } from '@playwright/test'

import { external, page as makePage } from '../../factories/contacts.factory'
import { personalDetail, tree } from '../../factories/userGroups.factory'
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

test('내 그룹 — 키보드로 그룹 이름에 오면 수정·삭제가 나타나고 Tab·Enter 로 수정 창을 연다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await stub(page)
  await page.goto('/contacts')
  const name = page.getByTestId('group-node-20')
  await expect(name).toBeVisible()
  // 평소엔 투명 — 마우스를 올리거나 행에 초점이 올 때만 보인다.
  const actions = page.getByTestId('group-edit-20').locator('xpath=..')
  await expect(actions).toHaveCSS('opacity', '0')

  // 바로 앞 버튼(「내 그룹」 머리의 새 그룹)에서 Tab — 마우스 없이 키보드로 그룹 이름에 초점을 준다.
  // 하위 그룹이 없는 노드엔 접기 버튼이 없어(WP-923) 머리 버튼에서 출발한다.
  await page.getByTestId('group-create').focus()
  await page.keyboard.press('Tab')
  await expect(name).toBeFocused()
  await expect(actions).toHaveCSS('opacity', '1')

  await page.keyboard.press('Tab')
  await expect(page.getByTestId('group-edit-20')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('group-delete-20')).toBeFocused()
  await expect(actions).toHaveCSS('opacity', '1')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('group-form-dialog')).toBeVisible()
})

test('내 그룹 — 마우스로 누른 뒤 포인터가 떠나면 수정·삭제는 다시 숨는다(키보드 초점일 때만 남는다)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await stub(page)
  await page.goto('/contacts')
  const actions = page.getByTestId('group-edit-20').locator('xpath=..')
  await page.getByTestId('group-node-20').click()
  await expect(page.getByTestId('group-node-20')).toBeFocused()
  await page.mouse.move(900, 700)
  await expect(actions).toHaveCSS('opacity', '0')
  // 안 보이는 동안은 눌리지 않는다.
  await expect(actions).toHaveCSS('pointer-events', 'none')
})

test('연락처 목록 — ☆ 는 키보드 초점을 받으면 보이고 Enter 로 즐겨찾기한다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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
