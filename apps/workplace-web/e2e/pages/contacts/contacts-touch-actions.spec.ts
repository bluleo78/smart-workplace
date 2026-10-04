// 터치 태블릿(≥1024px, pointer: coarse) 연락처 행 액션(WP-237) — hover 가 없는 기기에서
// 조직도 노드·내 그룹의 편집 액션은 ⋯ 드롭다운으로 모이고, 안 보이는 즐겨찾기 ★ 는 탭되지 않는다.
// 마우스 데스크톱 hover 동작은 user-groups.spec / contacts-favorites.spec 가 회귀를 맡는다.
import type { Page } from '@playwright/test'

import { external, member, page as makePage } from '../../factories/contacts.factory'
import { personalDetail, sharedDetail, tree } from '../../factories/userGroups.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'
import { expectStays } from '../../fixtures/wait'

test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true })

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

/** 연락처 목록·그룹 트리·그룹 상세 스텁. 그룹 상세 경로는 GET 만 응답하고 나머지 메서드는 뒤 핸들러로 넘긴다. */
async function stubBase(page: Page, contacts = makePage([])) {
  await page.route((u) => u.pathname === '/api/v1/contacts', (r) => r.fulfill(json(contacts)))
  await page.route((u) => u.pathname === '/api/v1/user-groups', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json(tree())) : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/user-groups/10', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json(sharedDetail())) : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/user-groups/20', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json(personalDetail())) : r.fallback())
}

async function expectCoarse(page: Page) {
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
}

test('조직도 노드: hover 아이콘 대신 ⋯ 드롭다운 → 삭제 확인 → DELETE', async ({ adminPage: page }) => {
  const deletes = trackRequests(page, 'DELETE', '/api/v1/user-groups/10')
  // 먼저 등록한 GET 스텁보다 뒤에 등록한 핸들러가 우선 — DELETE 만 가로채고 나머지는 앞 스텁으로.
  await stubBase(page)
  await page.route((u) => u.pathname === '/api/v1/user-groups/10', (r) => {
    if (r.request().method() !== 'DELETE') return r.fallback()
    return r.fulfill({ status: 204, body: '' })
  })
  await page.goto('/contacts')
  await expectCoarse(page)
  await page.getByTestId('group-node-10').click()
  await expect(page.getByTestId('org-chart-view')).toBeVisible()

  // coarse 에선 hover 아이콘 묶음을 렌더하지 않는다.
  await expect(page.getByTestId('org-edit-10')).toHaveCount(0)
  const more = page.getByTestId('org-more-10')
  const box = (await more.boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(44)
  expect(box.height).toBeGreaterThanOrEqual(44)

  await more.tap()
  await expect(page.getByTestId('row-action-org-add')).toBeVisible()
  await expect(page.getByTestId('row-action-org-edit')).toBeVisible()
  const del = page.getByTestId('row-action-org-delete')
  await expect(del).toHaveAttribute('data-variant', 'destructive')
  await del.click()
  // 바로 지우지 않고 기존 확인 다이얼로그를 거친다.
  await expect(page.getByTestId('org-delete-confirm')).toBeVisible()
  expect(deletes.count()).toBe(0)
  await page.getByTestId('org-delete-confirm-btn').click()
  await deletes.waitFor()
})

test('내 그룹: ⋯ 드롭다운 → 수정 → PATCH 본문', async ({ authenticatedPage: page }) => {
  const patches = trackRequests(page, 'PATCH', '/api/v1/user-groups/20')
  await stubBase(page)
  await page.route((u) => u.pathname === '/api/v1/user-groups/20', (r) => {
    if (r.request().method() !== 'PATCH') return r.fallback()
    return r.fulfill(json(personalDetail({ name: '내 분류(수정)' })))
  })
  await page.goto('/contacts')
  await expectCoarse(page)
  await expect(page.getByTestId('group-node-20')).toBeVisible()
  await expect(page.getByTestId('group-edit-20')).toHaveCount(0)

  await page.getByTestId('group-more-20').tap()
  await page.getByTestId('row-action-group-edit').click()
  await expect(page.getByTestId('group-form-dialog')).toBeVisible()
  await page.getByTestId('g-name').fill('내 분류(수정)')
  await page.getByTestId('g-save').click()
  await expect(page.getByTestId('group-form-dialog')).toBeHidden()
  expect(patches.lastBody()).toMatchObject({ name: '내 분류(수정)' })
})

test('즐겨찾기 ★: 안 보이는 ★ 는 탭해도 요청이 없고, 즐겨찾기된 ★ 는 탭으로 해제된다', async ({ authenticatedPage: page }) => {
  const calls = trackRequests(page, 'ANY', '/api/v1/contacts/favorites')
  await stubBase(page, makePage([member({ isFavorite: true }), external()]))
  await page.route((u) => u.pathname === '/api/v1/contacts/favorites', (r) => r.fulfill({ status: 204, body: '' }))
  await page.goto('/contacts')
  await expectCoarse(page)

  // 즐겨찾기 안 된 행: ★ 는 투명 + 탭 차단.
  const hidden = page.getByTestId('contact-fav-EXTERNAL-100')
  await expect(hidden).toHaveCSS('opacity', '0')
  await expect(hidden).toHaveCSS('pointer-events', 'none')
  const hb = (await hidden.boundingBox())!
  await page.touchscreen.tap(hb.x + hb.width / 2, hb.y + hb.height / 2)
  // 부재 확인 — 요청이 일정 시간 "일어나지 않음"을 지켜본다(WP-225 expectStays).
  await expectStays(page, calls.count, 0, { ms: 500 })

  // 양성 대조: 즐겨찾기된 ★ 는 보이고 탭하면 해제(DELETE) 요청이 나간다 — 위 탭이 실제로 일어났음을 보증.
  const shown = page.getByTestId('contact-fav-MEMBER-1')
  await expect(shown).toHaveCSS('opacity', '1')
  const sb = (await shown.boundingBox())!
  await page.touchscreen.tap(sb.x + sb.width / 2, sb.y + sb.height / 2)
  await expect.poll(() => calls.requests().map((r) => r.method())).toEqual(['DELETE'])
})
