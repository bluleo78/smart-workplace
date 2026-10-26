// 휴대폰(390px, 터치) 연락처 행 액션(WP-237) — 조직도 노드·내 그룹의 hover 액션은 ⋯ → 모바일 액션 시트로,
// 안 보이는 즐겨찾기 ★ 는 탭되지 않는다. 내 그룹은 ☰ 사이드바 바텀시트 안에서 액션 시트가 한 겹 더 열린다.
import type { Page } from '@playwright/test'

import { external, member, page as makePage } from '../../factories/contacts.factory'
import { personalDetail, sharedDetail, tree } from '../../factories/userGroups.factory'
import { json } from '../../fixtures/mobile-chat'
import { expect, test } from '../../fixtures/mobile.fixture'
import { trackRequests } from '../../fixtures/requests'
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
  const creates = trackRequests(page, 'POST', '/api/v1/user-groups')
  await stubBase(page)
  await page.route((u) => u.pathname === '/api/v1/user-groups', (r) => {
    if (r.request().method() !== 'POST') return r.fallback()
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
  expect(creates.lastBody()).toMatchObject({ name: '하위팀', visibility: 'SHARED', parentId: 10 })
})

test('내 그룹: 사이드바 시트 안 ⋯ → 액션 시트 → 삭제 확인 → DELETE', async ({ authenticatedPage: page }) => {
  const deletes = trackRequests(page, 'DELETE', '/api/v1/user-groups/20')
  await stubBase(page)
  await page.route((u) => u.pathname === '/api/v1/user-groups/20', (r) => {
    if (r.request().method() !== 'DELETE') return r.fallback()
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
  expect(deletes.count()).toBe(0)
  await page.getByTestId('group-delete-confirm-btn').click()
  await deletes.waitFor()
})

test('즐겨찾기 ★: 안 보이는 ★ 는 탭해도 요청이 없고, 즐겨찾기된 ★ 는 탭으로 해제된다', async ({ authenticatedPage: page }) => {
  const favs = trackRequests(page, 'ANY', '/api/v1/contacts/favorites')
  await stubBase(page, makePage([member({ isFavorite: true }), external()]))
  await page.route((u) => u.pathname === '/api/v1/contacts/favorites', (r) => r.fulfill({ status: 204, body: '' }))
  await page.goto('/contacts')

  const hidden = page.getByTestId('contact-fav-EXTERNAL-100')
  await expect(hidden).toHaveCSS('opacity', '0')
  await expect(hidden).toHaveCSS('pointer-events', 'none')
  const hb = (await hidden.boundingBox())!
  await page.touchscreen.tap(hb.x + hb.width / 2, hb.y + hb.height / 2)
  // 부재 확인 — 요청이 일정 시간 "일어나지 않음"을 지켜본다(WP-225 expectStays).
  await expectStays(page, favs.count, 0, { ms: 500 })
  // 탭이 상세를 열지도 않는다(행 선택 버튼 밖 영역).
  await expect(page.getByTestId('contact-detail-external')).toHaveCount(0)

  // 양성 대조: 즐겨찾기된 ★ 탭은 해제(DELETE) 요청을 보낸다 — 위 탭이 실제로 일어났음을 보증.
  const shown = page.getByTestId('contact-fav-MEMBER-1')
  await expect(shown).toHaveCSS('opacity', '1')
  const sb = (await shown.boundingBox())!
  await page.touchscreen.tap(sb.x + sb.width / 2, sb.y + sb.height / 2)
  await expect.poll(() => favs.requests().map((r) => r.method())).toEqual(['DELETE'])
})

// WP-578: 시트 안 타입 필터·그룹은 링크가 아닌 버튼이라 골라도 시트가 남아 바뀐 목록을 덮었다 — 고르면 닫혀야 한다.
// 외부 필터처럼 시트 안에서 이어 가는 동작은 닫지 않는다. 검색창은 헤더 🔍 로 옮겨 시트에 없다(WP-976).
test('☰ 시트 — 외부 필터는 시트를 두고(조직·직책 필터가 이어 나옴), 다른 타입 필터를 고르면 시트가 닫힌다', async ({ authenticatedPage: page }) => {
  await stubBase(page)
  await page.goto('/contacts')
  await openSidebar(page)
  const sheet = page.getByTestId('mobile-sidebar-sheet')
  await expect(sheet.getByTestId('contact-search')).toHaveCount(0)
  await sheet.getByTestId('contact-filter-EXTERNAL').click()
  await expect(page).toHaveURL(/type=EXTERNAL/)
  await expect(sheet.getByTestId('contact-advanced-filter')).toBeVisible()
  await sheet.getByTestId('contact-filter-FAVORITE').click()
  await expect(page).toHaveURL(/type=FAVORITE/)
  await expect(sheet).toBeHidden()
})

test('☰ 시트 — 그룹을 고르면 시트가 닫힌다', async ({ authenticatedPage: page }) => {
  await stubBase(page)
  await page.goto('/contacts')
  await openSidebar(page)
  const sheet = page.getByTestId('mobile-sidebar-sheet')
  await sheet.getByTestId('group-node-20').click()
  await expect(page).toHaveURL(/group=20/)
  await expect(sheet).toBeHidden()
})

// WP-976 — 모바일 검색은 헤더 🔍 로 편다. 펼치면 입력칸에 바로 초점이 가고, 한글을 이어 쳐도 조합이 끊기지 않으며
// URL q 는 완성된 글자로 반영된다(WP-974 방식). 「취소」는 검색어를 비우고 접는다. 초점·IME 는 브라우저에서만 판정된다.
test('헤더 🔍 → 입력칸 초점 → 한글 연속 입력이 끊기지 않고, 「취소」로 접힌다 (WP-976)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await stubBase(page, makePage([member({ id: 1, name: '김멤버' })]))
  await page.goto('/contacts?group=10')
  await expect(page.getByTestId('org-chart-view')).toBeVisible()
  await page.getByTestId('contact-search-open').click()
  const input = page.getByTestId('contact-search')
  await expect(input).toBeFocused()
  await expect(page.getByTestId('contact-search-scope')).toBeVisible()
  // pressSequentially — 키 입력마다 input 이벤트가 나가 URL 왕복이 조합을 끊던 결함(WP-974)을 재현한다.
  await input.pressSequentially('이개발', { delay: 30 })
  await expect(input).toHaveValue('이개발')
  await expect(page).toHaveURL(/q=%EC%9D%B4%EA%B0%9C%EB%B0%9C/)
  await expect(page.getByTestId('group-member-MEMBER-2')).toBeVisible()

  await page.getByTestId('contact-search-cancel').click()
  await expect(page.getByTestId('contact-mobile-search')).toHaveCount(0)
  await expect(page).not.toHaveURL(/q=/)
  await expect(page.getByTestId('contact-search-open')).toBeVisible()
})
