// 연락처 E2E — 통합 목록·검색·타입필터·상세 패널 (백엔드 없이 page.route 모킹).
import type { Page } from '@playwright/test'

import { external, member, memberDetail, page as makePage } from '../factories/contacts.factory'
import { expect, test } from '../fixtures/auth.fixture'

// /api/v1/contacts 목록 — search·type 쿼리에 따라 분기.
async function stubList(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/contacts',
    (route, req) => {
      const u = new URL(req.url())
      const type = u.searchParams.get('type') ?? 'ALL'
      const q = (u.searchParams.get('search') ?? '').toLowerCase()
      let items = [member(), external()]
      if (type === 'MEMBER') items = items.filter((c) => c.type === 'MEMBER')
      if (type === 'EXTERNAL') items = items.filter((c) => c.type === 'EXTERNAL')
      if (q)
        items = items.filter(
          (c) => c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q),
        )
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

// LNB 표준화(#98) — 연락처 사이드바가 표준 셸(레일과 동일 아이콘+이름 타이틀 헤더)을 갖춘다.
test('연락처 사이드바 — 표준 LNB 타이틀 헤더', async ({ authenticatedPage: page }) => {
  await stubList(page)
  await page.goto('/contacts')
  const sidebar = page.getByTestId('contact-sidebar')
  await expect(sidebar).toBeVisible()
  // h-14 앱 타이틀 헤더에 "연락처"(레일 라벨과 동일) 노출
  await expect(sidebar.getByText('연락처', { exact: true })).toBeVisible()
})
