// 사용자 그룹·조직도 E2E @smoke — 조직도 뷰 + 개인 그룹 생성 (백엔드 없이 page.route 모킹).
import type { Page } from '@playwright/test'

import { personalDetail, sharedDetail, tree } from '../../factories/userGroups.factory'
import { expect, test } from '../../fixtures/auth.fixture'

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

  // 같은 노드 재클릭 → 선택 해제, 통합 목록(빈 상태) 복원
  await page.getByTestId('group-node-10').click()
  await expect(page.getByTestId('org-chart-view')).toBeHidden()
  await expect(page.getByTestId('contact-empty')).toBeVisible()
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

test('admin: 조직도 헤더에서 최상위 공유 그룹 생성', async ({ adminPage: page }) => {
  let createBody: any
  await stubContacts(page)
  await stubDetail(page)
  await page.route(
    (url) => url.pathname === '/api/v1/user-groups',
    (route, req) => {
      if (req.method() === 'POST') {
        createBody = req.postDataJSON()
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(sharedDetail({ id: 98, name: '신규 본부', members: [] })),
        })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tree()) })
    },
  )
  await page.goto('/contacts')
  await page.getByTestId('org-create').click()
  await expect(page.getByTestId('group-form-dialog')).toBeVisible()
  await page.getByTestId('g-name').fill('신규 본부')
  await page.getByTestId('g-save').click()
  await expect(page.getByTestId('group-form-dialog')).toBeHidden()
  expect(createBody).toMatchObject({ name: '신규 본부', visibility: 'SHARED', parentId: null })
})

test('비-admin: 조직도 헤더 + 버튼 미노출', async ({ authenticatedPage: page }) => {
  await stubContacts(page)
  await stubTree(page)
  await stubDetail(page)
  await page.goto('/contacts')
  await expect(page.getByTestId('group-node-10')).toBeVisible()
  await expect(page.getByTestId('org-create')).toHaveCount(0)
})

test('admin: 조직도 노드 수정(PATCH, code 보존)', async ({ adminPage: page }) => {
  let patchBody: any
  await stubContacts(page)
  await stubTree(page)
  // 상세는 code 가 채워진 그룹으로 — code 보존 검증
  await page.route(
    (url) => url.pathname === '/api/v1/user-groups/10',
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sharedDetail({ code: 'DEV' })) }),
  )
  await page.route(
    (url) => /^\/api\/v1\/user-groups\/10$/.test(url.pathname),
    (route, req) => {
      if (req.method() === 'PATCH') {
        patchBody = req.postDataJSON()
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sharedDetail({ code: 'DEV', name: '개발본부(수정)' })) })
      }
      return route.fallback()
    },
  )
  await page.goto('/contacts')
  await page.getByTestId('group-node-10').click()
  await expect(page.getByTestId('org-chart-view')).toBeVisible()
  await page.getByTestId('org-edit-10').click()
  await expect(page.getByTestId('group-form-dialog')).toBeVisible()
  await page.getByTestId('g-name').fill('개발본부(수정)')
  await page.getByTestId('g-save').click()
  await expect(page.getByTestId('group-form-dialog')).toBeHidden()
  expect(patchBody).toMatchObject({ name: '개발본부(수정)', code: 'DEV' })
})

test('admin: 조직도 노드 하위 그룹 추가(POST parentId)', async ({ adminPage: page }) => {
  let createBody: any
  await stubContacts(page)
  await stubDetail(page)
  await page.route(
    (url) => url.pathname === '/api/v1/user-groups',
    (route, req) => {
      if (req.method() === 'POST') {
        createBody = req.postDataJSON()
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(sharedDetail({ id: 97, name: '하위팀', parentId: 10, members: [] })) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tree()) })
    },
  )
  await page.goto('/contacts')
  await page.getByTestId('group-node-10').click()
  await page.getByTestId('org-add-10').click()
  await expect(page.getByTestId('group-form-dialog')).toBeVisible()
  await page.getByTestId('g-name').fill('하위팀')
  await page.getByTestId('g-save').click()
  await expect(page.getByTestId('group-form-dialog')).toBeHidden()
  expect(createBody).toMatchObject({ name: '하위팀', visibility: 'SHARED', parentId: 10 })
})

test('admin: 조직도 노드 삭제(DELETE + 확인 + 선택 해제)', async ({ adminPage: page }) => {
  let deleteCalled = false
  await stubContacts(page)
  await stubDetail(page)
  await page.route(
    (url) => url.pathname === '/api/v1/user-groups',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tree()) }),
  )
  await page.route(
    (url) => /^\/api\/v1\/user-groups\/10$/.test(url.pathname),
    (route, req) => {
      if (req.method() === 'DELETE') {
        deleteCalled = true
        return route.fulfill({ status: 204, body: '' })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sharedDetail()) })
    },
  )
  await page.goto('/contacts')
  await page.getByTestId('group-node-10').click()
  await page.getByTestId('org-delete-10').click()
  await expect(page.getByTestId('org-delete-confirm')).toBeVisible()
  await page.getByTestId('org-delete-confirm-btn').click()
  await expect.poll(() => deleteCalled).toBe(true)
  // 보던 그룹 삭제 → 메인 패널이 통합 목록(빈 상태)으로 복귀
  await expect(page.getByTestId('org-chart-view')).toBeHidden()
})

test('admin: 사이클 등 거부 시 에러 토스트', async ({ adminPage: page }) => {
  await stubContacts(page)
  await stubTree(page)
  await page.route(
    (url) => url.pathname === '/api/v1/user-groups/10',
    (route, req) => {
      if (req.method() === 'PATCH') {
        return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: '그룹을 자손 그룹의 하위로 옮길 수 없습니다' }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sharedDetail()) })
    },
  )
  await page.goto('/contacts')
  await page.getByTestId('group-node-10').click()
  await page.getByTestId('org-edit-10').click()
  await page.getByTestId('g-name').fill('변경')
  await page.getByTestId('g-save').click()
  await expect(page.getByText('그룹을 자손 그룹의 하위로 옮길 수 없습니다')).toBeVisible()
})

test('admin: 조직도 노드 삭제 실패 시 에러 토스트', async ({ adminPage: page }) => {
  await stubContacts(page)
  await stubDetail(page)
  await page.route(
    (url) => url.pathname === '/api/v1/user-groups',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tree()) }),
  )
  await page.route(
    (url) => /^\/api\/v1\/user-groups\/10$/.test(url.pathname),
    (route, req) => {
      if (req.method() === 'DELETE') {
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: '삭제할 수 없습니다' }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sharedDetail()) })
    },
  )
  await page.goto('/contacts')
  await page.getByTestId('group-node-10').click()
  await page.getByTestId('org-delete-10').click()
  await expect(page.getByTestId('org-delete-confirm')).toBeVisible()
  await page.getByTestId('org-delete-confirm-btn').click()
  await expect(page.getByText('삭제할 수 없습니다')).toBeVisible()
})

test('비-admin: 조직도 노드 호버 액션 미노출(읽기 전용)', async ({ authenticatedPage: page }) => {
  await stubContacts(page)
  await stubTree(page)
  await stubDetail(page)
  await page.goto('/contacts')
  await page.getByTestId('group-node-10').click()
  await expect(page.getByTestId('org-chart-view')).toBeVisible()
  await expect(page.getByTestId('org-edit-10')).toHaveCount(0)
  await expect(page.getByTestId('org-delete-10')).toHaveCount(0)
})
