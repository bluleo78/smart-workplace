// 휴대폰(390px, 터치) 연락처 행 액션(WP-237) — 조직도 노드·내 그룹의 hover 액션은 ⋯ → 모바일 액션 시트로,
// 안 보이는 즐겨찾기 ★ 는 탭되지 않는다. 내 그룹은 ☰ 사이드바 바텀시트 안에서 액션 시트가 한 겹 더 열린다.
import type { Page } from '@playwright/test'

import { external, member, page as makePage } from '../../factories/contacts.factory'
import { personalDetail, sharedDetail, tree } from '../../factories/userGroups.factory'
import { json } from '../../fixtures/mobile-chat'
import { expect, test } from '../../fixtures/mobile.fixture'
import { expectStays } from '../../fixtures/wait'

/** 연락처 목록·그룹 트리·그룹 상세 GET 스텁. 그 외 메서드는 뒤에 등록한 핸들러로 넘긴다. */
async function stubBase(page: Page, contacts = makePage([])) {
  await page.route((u) => u.pathname === '/api/v1/contacts', (r) => r.fulfill(json(contacts)))
  await page.route((u) => u.pathname === '/api/v1/user-groups', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json(tree())) : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/user-groups/10', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json(sharedDetail())) : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/user-groups/20', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json(personalDetail())) : r.fallback())
}

async function openSidebar(page: Page) {
  await page.getByTestId('mobile-sidebar-trigger').click()
  await expect(page.getByTestId('mobile-sidebar-sheet')).toBeVisible()
}

test('조직도 노드: ⋯ → 액션 시트 → 하위 그룹 추가 → POST parentId', async ({ adminPage: page }) => {
  let createBody: unknown = null
  await stubBase(page)
  await page.route((u) => u.pathname === '/api/v1/user-groups', (r) => {
    if (r.request().method() !== 'POST') return r.fallback()
    createBody = r.request().postDataJSON()
    return r.fulfill({ ...json(sharedDetail({ id: 97, name: '하위팀', parentId: 10, members: [] })), status: 201 })
  })
  // 그룹 뷰는 딥링크(?group=10)로 연다 — 사이드바 시트에서 그룹을 골라도 시트가 자동으로 닫히지 않는다(이번 범위 밖).
  await page.goto('/contacts?group=10')
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
  await expect(page.getByTestId('org-chart-view')).toBeVisible()
  await expect(page.getByTestId('org-add-10')).toHaveCount(0)

  await page.getByTestId('org-more-10').tap()
  const sheet = page.getByTestId('mobile-action-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByTestId('mobile-action-org-edit')).toBeVisible()
  await expect(sheet.getByTestId('mobile-action-org-delete')).toHaveClass(/text-destructive/)
  await sheet.getByTestId('mobile-action-org-add').click()
  await expect(sheet).toBeHidden()
  await expect(page.getByTestId('group-form-dialog')).toBeVisible()
  await page.getByTestId('g-name').fill('하위팀')
  await page.getByTestId('g-save').click()
  await expect(page.getByTestId('group-form-dialog')).toBeHidden()
  expect(createBody).toMatchObject({ name: '하위팀', visibility: 'SHARED', parentId: 10 })
})

test('내 그룹: 사이드바 시트 안 ⋯ → 액션 시트 → 삭제 확인 → DELETE', async ({ authenticatedPage: page }) => {
  let deleted = false
  await stubBase(page)
  await page.route((u) => u.pathname === '/api/v1/user-groups/20', (r) => {
    if (r.request().method() !== 'DELETE') return r.fallback()
    deleted = true
    return r.fulfill({ status: 204, body: '' })
  })
  await page.goto('/contacts')
  await openSidebar(page)
  await expect(page.getByTestId('group-delete-20')).toHaveCount(0)
  const more = page.getByTestId('group-more-20')
  const box = (await more.boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(44)
  expect(box.height).toBeGreaterThanOrEqual(44)

  await more.tap()
  const sheet = page.getByTestId('mobile-action-sheet')
  await expect(sheet).toBeVisible()
  await sheet.getByTestId('mobile-action-group-delete').click()
  // 바로 지우지 않고 기존 확인 다이얼로그를 거친다.
  await expect(page.getByTestId('group-delete-confirm')).toBeVisible()
  expect(deleted).toBe(false)
  await page.getByTestId('group-delete-confirm-btn').click()
  await expect.poll(() => deleted).toBe(true)
})

test('즐겨찾기 ★: 안 보이는 ★ 는 탭해도 요청이 없고, 즐겨찾기된 ★ 는 탭으로 해제된다', async ({ authenticatedPage: page }) => {
  const calls: string[] = []
  await stubBase(page, makePage([member({ isFavorite: true }), external()]))
  await page.route((u) => u.pathname === '/api/v1/contacts/favorites', (r) => {
    calls.push(r.request().method())
    return r.fulfill({ status: 204, body: '' })
  })
  await page.goto('/contacts')

  const hidden = page.getByTestId('contact-fav-EXTERNAL-100')
  await expect(hidden).toHaveCSS('opacity', '0')
  await expect(hidden).toHaveCSS('pointer-events', 'none')
  const hb = (await hidden.boundingBox())!
  await page.touchscreen.tap(hb.x + hb.width / 2, hb.y + hb.height / 2)
  // 부재 확인 — 요청이 일정 시간 "일어나지 않음"을 지켜본다(WP-225 expectStays).
  await expectStays(page, () => calls.length, 0, { ms: 500 })
  // 탭이 상세를 열지도 않는다(행 선택 버튼 밖 영역).
  await expect(page.getByTestId('contact-detail-external')).toHaveCount(0)

  // 양성 대조: 즐겨찾기된 ★ 탭은 해제(DELETE) 요청을 보낸다 — 위 탭이 실제로 일어났음을 보증.
  const shown = page.getByTestId('contact-fav-MEMBER-1')
  await expect(shown).toHaveCSS('opacity', '1')
  const sb = (await shown.boundingBox())!
  await page.touchscreen.tap(sb.x + sb.width / 2, sb.y + sb.height / 2)
  await expect.poll(() => calls).toEqual(['DELETE'])
})
