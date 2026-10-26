// 휴대폰(390px, 터치) 연락처 행 액션(WP-237) — 조직도 노드·내 그룹의 hover 액션은 ⋯ → 모바일 액션 시트로,
// 안 보이는 즐겨찾기 ★ 는 탭되지 않는다. 내 그룹은 ☰ 사이드바 바텀시트 안에서 액션 시트가 한 겹 더 열린다.
// 브라우저가 있어야 판정되는 것만 남긴다 — ⋯ 터치 크기(@layout), 숨은 ★ 의 실제 터치 탭 무시(@input).
// ⋯ → 액션 시트의 항목·요청(하위 그룹 추가·내 그룹 삭제)과 ☰ 시트 닫힘 분기는
// 페이지 테스트 src/pages/mobile/mobileContactsTouchActions.test.tsx 가 지킨다(WP-981).
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

test('내 그룹: 사이드바 시트 안 ⋯ 는 터치 타깃 44px 이상', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubBase(page)
  await page.goto('/contacts')
  await openSidebar(page)
  const box = (await page.getByTestId('group-more-20').boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(44)
  expect(box.height).toBeGreaterThanOrEqual(44)
})

test('즐겨찾기 ★: 안 보이는 ★ 는 탭해도 요청이 없고, 즐겨찾기된 ★ 는 탭으로 해제된다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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
