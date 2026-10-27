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

// WP-976 — 모바일 검색은 헤더 🔍 로 편다. 펼치면 입력칸에 바로 초점이 가고, 한글을 이어 쳐도 조합이 끊기지 않으며
// URL q 는 완성된 글자로 반영된다(WP-974 방식). 「취소」는 검색어를 비우고 접는다. 초점·IME 는 브라우저에서만 판정된다.
test('헤더 🔍 → 입력칸 초점 → 한글 연속 입력이 끊기지 않고, 「취소」로 접힌다 (WP-976)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await stubBase(page, makePage([member({ id: 1, name: '김멤버' })]))
  await page.goto('/contacts?group=10')
  await expect(page.getByTestId('group-contact-view')).toBeVisible()
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
