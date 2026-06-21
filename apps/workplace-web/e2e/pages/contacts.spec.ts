// 연락처 E2E — 통합 목록·검색·타입필터·상세 패널 (백엔드 없이 page.route 모킹).
import type { Page } from '@playwright/test'

import { external, member, memberDetail, page as makePage } from '../factories/contacts.factory'
import { expect, test } from '../fixtures/auth.fixture'

// /api/v1/contacts 목록 — search·type·favorite 쿼리에 따라 분기.
async function stubList(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/contacts',
    (route, req) => {
      const u = new URL(req.url())
      const type = u.searchParams.get('type') ?? 'ALL'
      const q = (u.searchParams.get('search') ?? '').toLowerCase()
      const favorite = u.searchParams.get('favorite') === 'true'
      // 첫 번째 멤버를 즐겨찾기 표시 — 즐겨찾기 필터 테스트용
      let items = [member({ isFavorite: true }), external()]
      if (type === 'MEMBER') items = items.filter((c) => c.type === 'MEMBER')
      if (type === 'EXTERNAL') items = items.filter((c) => c.type === 'EXTERNAL')
      if (q)
        items = items.filter(
          (c) => c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q),
        )
      if (favorite) items = items.filter((c) => c.isFavorite)
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makePage(items)),
      })
    },
  )
}

async function stubMemberDetail(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/contacts/members/1',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(memberDetail()),
      }),
  )
}

test('통합 목록·검색·타입필터·상세', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await stubList(page)
  await stubMemberDetail(page)

  await page.goto('/contacts')

  // 목록에 멤버·외부 모두 노출
  await expect(page.getByTestId('contact-row-MEMBER-1')).toBeVisible()
  await expect(page.getByTestId('contact-row-EXTERNAL-100')).toBeVisible()

  // 타입필터 = 외부 → 멤버 숨김
  await page.getByTestId('contact-filter-EXTERNAL').click()
  await expect(page.getByTestId('contact-row-EXTERNAL-100')).toBeVisible()
  await expect(page.getByTestId('contact-row-MEMBER-1')).toHaveCount(0)

  // 검색 → 박외부만 (ALL 클릭 후 멤버 행이 렌더링되길 기다린 뒤 검색 — setParams 배치 경쟁 조건 방지)
  await page.getByTestId('contact-filter-ALL').click()
  await expect(page.getByTestId('contact-row-MEMBER-1')).toBeVisible()
  await page.getByTestId('contact-search').fill('박외부')
  await expect(page.getByTestId('contact-row-MEMBER-1')).toHaveCount(0)
  await expect(page.getByTestId('contact-row-EXTERNAL-100')).toBeVisible()

  // 검색 초기화 후 멤버 클릭 → 상세 패널
  await page.getByTestId('contact-search').fill('')
  await expect(page.getByTestId('contact-row-MEMBER-1')).toBeVisible()
  await page.getByTestId('contact-row-MEMBER-1').click()
  await expect(page.getByTestId('contact-detail-member')).toContainText('김멤버')
  await expect(page.getByTestId('contact-detail-member')).toContainText('개발팀')
})

// #113 전폭 PageHeader + 좁은 화면 뒤로가기
test('연락처 전폭 헤더 + 좁은 화면 뒤로가기', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await stubList(page)
  await stubMemberDetail(page)
  await page.setViewportSize({ width: 800, height: 900 })
  await page.goto('/contacts')
  await expect(page.getByTestId('page-header')).toContainText('연락처')
  await expect(page.getByTestId('contact-create')).toBeVisible()
  const firstRow = page.getByTestId(/^contact-row-/).first()
  await firstRow.click()
  await expect(page.getByTestId('contact-back')).toBeVisible()
  await expect(page.getByTestId('contact-list')).toBeHidden()
  await page.getByTestId('contact-back').click()
  await expect(page.getByTestId('contact-list')).toBeVisible()
})

// #113 그룹 뷰에서도 헤더의 새 외부 연락처 버튼 노출(공통 헤더로 이동).
test('그룹 뷰 — 헤더 새 외부 연락처 버튼 노출', async ({ authenticatedPage: page }) => {
  await stubList(page)
  await page.goto('/contacts?group=1')
  await expect(page.getByTestId('page-header')).toContainText('연락처')
  await expect(page.getByTestId('contact-create')).toBeVisible()
})

// #115 — 비정수 group 파라미터(?group=abc)는 그룹 미선택으로 취급:
// 사이드바 검색·타입필터가 잠기지 않고, 메인은 그룹 뷰가 아닌 일반 목록을 렌더한다.
// (예전엔 사이드바가 Number('abc')=NaN 을 선택으로 오인해 컨트롤만 영구 비활성됐다.)
test('비정수 group 파라미터 — 검색·필터 비잠금 + 일반 목록 유지', async ({
  authenticatedPage: page,
}) => {
  await stubList(page)
  await stubMemberDetail(page)

  await page.goto('/contacts?group=abc')

  // 컨트롤이 잠기지 않아야 함(수정 전엔 모두 disabled 였음)
  await expect(page.getByTestId('contact-search')).toBeEnabled()
  await expect(page.getByTestId('contact-filter-ALL')).toBeEnabled()
  await expect(page.getByTestId('contact-filter-MEMBER')).toBeEnabled()
  await expect(page.getByTestId('contact-filter-EXTERNAL')).toBeEnabled()

  // 그룹 뷰가 아니라 일반 통합 목록이 떠야 함(멤버·외부 행 노출)
  await expect(page.getByTestId('contact-row-MEMBER-1')).toBeVisible()
  await expect(page.getByTestId('contact-row-EXTERNAL-100')).toBeVisible()

  // 잠기지 않았으므로 검색이 실제로 동작(입력→필터 반영)
  await page.getByTestId('contact-search').fill('박외부')
  await expect(page.getByTestId('contact-row-MEMBER-1')).toHaveCount(0)
  await expect(page.getByTestId('contact-row-EXTERNAL-100')).toBeVisible()
})

// LNB 표준화(#98) — 연락처 사이드바가 표준 셸(레일과 동일 아이콘+이름 타이틀 헤더)을 갖춘다.
test('연락처 사이드바 — 표준 LNB 타이틀 헤더', async ({ authenticatedPage: page }) => {
  await stubList(page)
  await page.goto('/contacts')
  const sidebar = page.getByTestId('contact-sidebar')
  await expect(sidebar).toBeVisible()
  // h-14 앱 타이틀 헤더에 "연락처"(레일 라벨과 동일) 노출
  await expect(sidebar.getByText('연락처', { exact: true })).toBeVisible()
})

// #327/#94 즐겨찾기 필터 — 즐겨찾기 항목만 노출
test('즐겨찾기 필터 — 즐겨찾기 항목만 노출', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await stubList(page)
  await page.goto('/contacts')

  await expect(page.getByTestId('contact-row-MEMBER-1')).toBeVisible()
  await expect(page.getByTestId('contact-row-EXTERNAL-100')).toBeVisible()

  // 즐겨찾기 필터 → 멤버(즐겨찾기됨)만, 외부(미즐겨찾기) 숨김
  await page.getByTestId('contact-filter-FAVORITE').click()
  await expect(page.getByTestId('contact-row-MEMBER-1')).toBeVisible()
  await expect(page.getByTestId('contact-row-EXTERNAL-100')).toHaveCount(0)
})

// #327/#94 즐겨찾기 필터 — 빈 상태
test('즐겨찾기 필터 — 빈 상태', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await page.route(
    (url) => url.pathname === '/api/v1/contacts',
    (route, req) => {
      const u = new URL(req.url())
      const favorite = u.searchParams.get('favorite') === 'true'
      const items = favorite ? [] : [member(), external()]
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makePage(items)),
      })
    },
  )
  await page.goto('/contacts')
  await page.getByTestId('contact-filter-FAVORITE').click()
  await expect(page.getByTestId('contact-empty')).toContainText('즐겨찾기한 연락처가 없습니다')
})
