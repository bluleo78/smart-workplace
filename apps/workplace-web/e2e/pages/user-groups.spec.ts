// 사용자 그룹·조직도 E2E @smoke — 조직도 뷰 + 개인 그룹 생성 (백엔드 없이 page.route 모킹).
import type { Page } from '@playwright/test'

import { personalDetail, sharedDetail, tree } from '../factories/userGroups.factory'
import { expect, test } from '../fixtures/auth.fixture'

// GET /api/v1/user-groups → 기본 트리(공유 1개 + 개인 1개)
async function stubTree(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/user-groups',
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tree()) }),
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

test('조직도(공유) 선택 시 트리+직속 멤버 렌더', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await stubContacts(page)
  await stubTree(page)
  await stubDetail(page)
  await page.goto('/contacts')
  await expect(page.getByTestId('group-node-10')).toBeVisible()
  await page.getByTestId('group-node-10').click()
  await expect(page.getByTestId('org-chart-view')).toBeVisible()
  await expect(page.getByTestId('group-member-MEMBER-2')).toContainText('이개발')
})

test('개인 그룹 생성 + 멤버 편입', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  let createBody: any
  let memberBody: any
  await stubTree(page)
  await stubDetail(page)
  // 멤버 검색은 contacts 목록 API 재사용 — 이후 등록이 우선하므로 stubTree 뒤에 등록
  await page.route(
    (url) => url.pathname === '/api/v1/contacts',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            { type: 'MEMBER', id: 1, name: '김멤버', email: 'kim@example.com', title: null, organization: null },
          ],
          nextCursor: null,
          hasMore: false,
        }),
      }),
  )
  // POST /user-groups → 201 생성, GET /user-groups → 트리. 단일 핸들러에서 메서드 분기
  await page.route(
    (url) => url.pathname === '/api/v1/user-groups',
    (route, req) => {
      if (req.method() === 'POST') {
        createBody = req.postDataJSON()
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(personalDetail({ id: 99, name: '신규 그룹', members: [] })),
        })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tree()) })
    },
  )
  // 멤버 편입 POST stub
  await page.route(
    (url) => url.pathname === '/api/v1/user-groups/99/members',
    (route, req) => {
      memberBody = req.postDataJSON()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(personalDetail({ id: 99, name: '신규 그룹' })),
      })
    },
  )

  await page.goto('/contacts')
  await page.getByTestId('group-create').click()
  await expect(page.getByTestId('group-form-dialog')).toBeVisible()
  await page.getByTestId('g-name').fill('신규 그룹')
  await page.getByTestId('g-member-search').fill('김멤버')
  await expect(page.getByTestId('g-member-result-MEMBER-1')).toBeVisible()
  await page.getByTestId('g-member-result-MEMBER-1').click()
  await expect(page.getByTestId('g-picked-remove-MEMBER-1')).toBeVisible()
  await page.getByTestId('g-save').click()
  await expect(page.getByTestId('group-form-dialog')).toBeHidden()

  // payload 검증 — 생성/멤버 편입 요청이 올바른 본문으로 실제 발사되었는지 확인
  expect(createBody).toMatchObject({ name: '신규 그룹', visibility: 'PERSONAL' })
  expect(memberBody).toMatchObject({ targetType: 'MEMBER', targetId: 1 })
})
