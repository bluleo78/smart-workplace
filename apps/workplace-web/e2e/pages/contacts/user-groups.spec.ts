// 사용자 그룹·조직도 E2E @smoke — 조직도 뷰 + 개인 그룹 생성 (백엔드 없이 page.route 모킹).
import type { Page } from '@playwright/test'

import { personalDetail, personalNode, sharedDetail, sharedNode, tree } from '../../factories/userGroups.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'
import { expectPressed, expectSelectedRow } from '../../fixtures/selection'

// GET /api/v1/user-groups → 트리(기본: 공유 1개 + 개인 1개)
async function stubTree(page: Page, body = tree()) {
  await page.route(
    (url) => url.pathname === '/api/v1/user-groups',
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
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

// WP-368 — 선택한 그룹 노드 행만 선택 표시(막대 + bg-selected), 다른 노드·선택 해제 후엔 없다. 개인 그룹의 멤버 행도 같은 규칙(연락처 목록 행과 동일).
test('그룹 트리·그룹 멤버 행 선택 표시 (WP-368)', async ({ authenticatedPage: page }) => {
  await stubContacts(page)
  await stubTree(page)
  await stubDetail(page)
  await page.route(
    (url) => url.pathname === '/api/v1/contacts/members/1',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 1, username: 'kim', name: '김멤버', email: 'kim@example.com', title: '팀장', kind: 'HUMAN', groups: [], isFavorite: false }),
      }),
  )
  await page.goto('/contacts')
  // 행 컨테이너 = 이름 버튼의 부모 div.
  const row10 = page.getByTestId('group-node-10').locator('..')
  const row20 = page.getByTestId('group-node-20').locator('..')
  await page.getByTestId('group-node-10').click()
  await expect(page.getByTestId('org-chart-view')).toBeVisible()
  await expectSelectedRow(row10, row20)
  // 다시 누르면 해제되는 필터 토글이라 aria-pressed 로 알린다(멤버 행과 같은 규칙).
  await expectPressed(page.getByTestId('group-node-10'), page.getByTestId('group-node-20'))
  // 개인 그룹으로 옮기면 선택 표시가 따라가고, 멤버 행은 고르기 전엔 선택 표시가 없다.
  await page.getByTestId('group-node-20').click()
  await expectSelectedRow(row20, row10)
  await expectPressed(page.getByTestId('group-node-20'), page.getByTestId('group-node-10'))
  const member = page.getByTestId('group-member-MEMBER-1')
  await expect(member).toHaveAttribute('aria-pressed', 'false')
  await expect(member).not.toHaveClass(/bg-selected/)
  await member.click()
  await expect(member).toHaveAttribute('aria-pressed', 'true')
  await expect(member).toHaveClass(/bg-selected/)
  await expect(member).toHaveClass(/selection-bar/)
})

// WP-898 — 그룹을 고른 동안 꺼진 타입 퀵필터(「전체」)는 선택 표시도 aria-current 도 없고, 그룹을 풀면 「전체」가 다시 현재 항목이다.
test('그룹을 고르면 꺼진 「전체」 퀵필터는 현재 항목으로 표시·안내되지 않는다 (WP-898)', async ({ authenticatedPage: page }) => {
  await stubContacts(page)
  await stubTree(page)
  await stubDetail(page)
  await page.goto('/contacts')
  const all = page.getByTestId('contact-filter-ALL')
  await expect(all).toHaveAttribute('aria-current', 'true')
  await expect(all).toHaveClass(/bg-selected/)

  await page.getByTestId('group-node-10').click()
  await expect(page.getByTestId('org-chart-view')).toBeVisible()
  await expect(all).toBeDisabled()
  await expect(all).not.toHaveAttribute('aria-current')
  await expect(all).not.toHaveClass(/bg-selected/)
  await expect(page.locator('[data-testid^="contact-filter-"][aria-current]')).toHaveCount(0)

  // 같은 노드를 다시 눌러 풀면 「전체」가 돌아온다.
  await page.getByTestId('group-node-10').click()
  await expect(all).toHaveAttribute('aria-current', 'true')
  await expect(all).toHaveClass(/bg-selected/)
})

// WP-923: 행마다 반복되는 접기·수정·삭제 버튼은 이름에 그룹 이름을 넣어 스크린리더가 어느 그룹의 버튼인지 구분한다.
test('그룹 트리 — 접기·수정·삭제 버튼 이름에 그룹 이름이 들어간다', async ({ authenticatedPage: page }) => {
  await stubContacts(page)
  await stubTree(
    page,
    tree({
      shared: [sharedNode({ children: [sharedNode({ id: 11, name: '플랫폼팀', parentId: 10 })] })],
      personal: [personalNode()],
    }),
  )
  await page.goto('/contacts')

  // 하위가 있는 그룹만 접기 버튼이 있고, 상태는 aria-expanded 로 전한다.
  const collapse = page.getByRole('button', { name: '개발본부 접기', exact: true })
  await expect(collapse).toHaveAttribute('aria-expanded', 'true')
  await collapse.click()
  await expect(page.getByTestId('group-node-11')).toHaveCount(0)
  const expand = page.getByRole('button', { name: '개발본부 펼치기', exact: true })
  await expect(expand).toHaveAttribute('aria-expanded', 'false')
  await expand.click()
  await expect(page.getByTestId('group-node-11')).toBeVisible()
  // 하위 그룹이 없는 노드엔 눌러도 아무 일 없는 접기 버튼을 두지 않는다.
  await expect(page.getByRole('button', { name: /^플랫폼팀 (접기|펼치기)$/ })).toHaveCount(0)

  // 개인 그룹의 수정·삭제 아이콘.
  await expect(page.getByTestId('group-edit-20')).toHaveAccessibleName('내 분류 수정')
  await expect(page.getByTestId('group-delete-20')).toHaveAccessibleName('내 분류 삭제')
})

test('개인 그룹 생성 + 멤버 편입', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  const creates = trackRequests(page, 'POST', '/api/v1/user-groups')
  const memberAdds = trackRequests(page, 'POST', '/api/v1/user-groups/99/members')
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
    (route) => {
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
  expect(creates.lastBody()).toMatchObject({ name: '신규 그룹', visibility: 'PERSONAL' })
  expect(memberAdds.lastBody()).toMatchObject({ targetType: 'MEMBER', targetId: 1 })
})

test('admin: 조직도 헤더에서 최상위 공유 그룹 생성', async ({ adminPage: page }) => {
  const creates = trackRequests(page, 'POST', '/api/v1/user-groups')
  await stubContacts(page)
  await stubDetail(page)
  await page.route(
    (url) => url.pathname === '/api/v1/user-groups',
    (route, req) => {
      if (req.method() === 'POST') {
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
  expect(creates.lastBody()).toMatchObject({ name: '신규 본부', visibility: 'SHARED', parentId: null })
})

test('비-admin: 조직도 헤더 + 버튼 미노출', async ({ authenticatedPage: page }) => {
  await stubContacts(page)
  await stubTree(page)
  await stubDetail(page)
  await page.goto('/contacts')
  await expect(page.getByTestId('group-node-10')).toBeVisible()
  await expect(page.getByTestId('org-create')).toHaveCount(0)
})

test('admin: 조직도 노드 수정(PATCH 부분 수정 — code 생략으로 보존, 최상위는 moveToRoot)', async ({ adminPage: page }) => {
  const patches = trackRequests(page, 'PATCH', '/api/v1/user-groups/10')
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
  // #839 부분 수정 계약: 폼이 다루지 않는 code·sortOrder 는 생략(서버가 유지), 상위 '최상위'는 moveToRoot 플래그
  expect(patches.lastBody()).toEqual({ name: '개발본부(수정)', moveToRoot: true })
})

test('admin: 조직도 노드 하위 그룹 추가(POST parentId)', async ({ adminPage: page }) => {
  const creates = trackRequests(page, 'POST', '/api/v1/user-groups')
  await stubContacts(page)
  await stubDetail(page)
  await page.route(
    (url) => url.pathname === '/api/v1/user-groups',
    (route, req) => {
      if (req.method() === 'POST') {
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
  expect(creates.lastBody()).toMatchObject({ name: '하위팀', visibility: 'SHARED', parentId: 10 })
})

test('admin: 조직도 노드 삭제(DELETE + 확인 + 선택 해제)', async ({ adminPage: page }) => {
  const deletes = trackRequests(page, 'DELETE', '/api/v1/user-groups/10')
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
  await deletes.waitFor()
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

test('admin: 최상위 공유 그룹 생성 시 이름 중복(400) → 인라인 에러 + 다이얼로그 유지(#803)', async ({ adminPage: page }) => {
  await stubContacts(page)
  await stubDetail(page)
  await page.route(
    (url) => url.pathname === '/api/v1/user-groups',
    (route, req) => {
      if (req.method() === 'POST') {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ message: '이미 존재하는 그룹 이름입니다: 테스트그룹A' }),
        })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tree()) })
    },
  )
  await page.goto('/contacts')
  await page.getByTestId('org-create').click()
  await expect(page.getByTestId('group-form-dialog')).toBeVisible()
  await page.getByTestId('g-name').fill('테스트그룹A')
  await page.getByTestId('g-save').click()

  // 다이얼로그는 닫히지 않고, 이름 필드 아래 서버 에러 메시지가 인라인으로 노출되어야 한다
  // (같은 문구가 토스트로도 뜨므로 role=alert 인라인 에러 요소로 특정해 검증)
  await expect(page.getByTestId('group-form-dialog')).toBeVisible()
  await expect(page.locator('#g-name-error')).toHaveText('이미 존재하는 그룹 이름입니다: 테스트그룹A')
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

// WP-548: 멤버 검색 결과·선택 칩의 이름이 아주 길어도 창이 옆으로 늘어나지 않고 저장 버튼이 창 안에 남는다(데스크톱·모바일).
for (const viewport of [
  { name: '데스크톱', width: 1440, height: 900 },
  { name: '모바일', width: 390, height: 844 },
]) {
  test(`새 그룹 창 — 긴 이름 검색 결과·선택 칩이 창 폭을 넘기지 않는다 (${viewport.name})`, async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    const longName =
      '남궁민수 (주)대한글로벌에너지솔루션 해외사업개발본부 중동아프리카 신규시장개척팀 수석컨설턴트 겸 파트너십 총괄'
    await stubTree(page)
    await stubDetail(page)
    await page.route(
      (url) => url.pathname === '/api/v1/contacts',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [{ type: 'EXTERNAL', id: 7, name: longName, email: null, title: null, organization: null }],
            nextCursor: null,
            hasMore: false,
          }),
        }),
    )

    await page.goto('/contacts')
    if (viewport.width < 1024) await page.getByTestId('mobile-sidebar-trigger').click()
    await page.getByTestId('group-create').click()
    const dialog = page.getByTestId('group-form-dialog')
    await expect(dialog).toBeVisible()
    const before = (await dialog.boundingBox())!.width

    await page.getByTestId('g-member-search').fill('남궁')
    await page.getByTestId('g-member-result-EXTERNAL-7').click()
    await expect(page.getByTestId('g-picked-remove-EXTERNAL-7')).toBeVisible()

    const box = (await dialog.boundingBox())!
    expect(box.width).toBeLessThanOrEqual(before + 1)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    // 저장 버튼이 창 안에 있다(창 밖으로 밀려나지 않음)
    const save = (await page.getByTestId('g-save').boundingBox())!
    expect(save.x + save.width).toBeLessThanOrEqual(box.x + box.width)
    // 창 내용이 가로로 스크롤되지 않는다
    expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
  })
}
