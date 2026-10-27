// 휴대폰(390px, 터치) 연락처 행 액션(WP-237) — 페이지 테스트(WP-981).
// hover 액션 대신 ⋯ → 모바일 액션 시트로 여는 항목·요청(하위 그룹 추가 POST parentId, 내 그룹 삭제 확인 → DELETE)과
// ☰ 사이드바 시트가 검색·외부 필터엔 남고 다른 타입 필터·그룹 선택엔 닫히는 분기는 브라우저 없이 판정되므로
// e2e/pages/mobile/contacts-touch-actions.spec.ts 에서 옮겼다. ⋯ 터치 크기(@layout)와 안 보이는 ★ 탭 무시(@input)는 E2E 에 남는다.
// 앱 셸을 보지 않으므로 연락처 모듈 레이아웃(☰ 시트)과 화면만 renderScreen 으로 띄운다(WP-1002).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { ContactModuleLayout } from '@/components/contacts/ContactModuleLayout'
import { renderMobileModule } from '@/test/kits/mobile/mobileScreen'
import { mockViewport } from '@/test/viewport'

import { page as makePage } from '../../../e2e/factories/contacts.factory'
import { personalDetail, sharedDetail, tree } from '../../../e2e/factories/userGroups.factory'
import { ContactsPage } from '../contacts/ContactsPage'

mockViewport()

/** 연락처 목록·그룹 트리·그룹 상세 GET. */
const baseHandlers = [
  http.get('/api/v1/contacts', () => HttpResponse.json(makePage([]))),
  http.get('/api/v1/user-groups', () => HttpResponse.json(tree())),
  http.get('/api/v1/user-groups/10', () => HttpResponse.json(sharedDetail())),
  http.get('/api/v1/user-groups/20', () => HttpResponse.json(personalDetail())),
  // 외부 필터의 조직·직책 고르기 후보.
  http.get('/api/v1/contacts/facets', () => HttpResponse.json({ organizations: [], titles: [] })),
]

/** /contacts 화면(모듈 레이아웃 + 목록)을 띄운다. */
const renderContacts = (path: string, options: Parameters<typeof renderMobileModule>[2]) =>
  renderMobileModule(<ContactModuleLayout />, [['/contacts', <ContactsPage />]], { ...options, path })

/** 관리자 — 조직도 편집(하위 그룹 추가)은 AuthContext.isAdmin 으로 열린다. */
const ADMIN = { isAdmin: true, hasRole: (r: string) => r === 'ADMIN' }

/** ☰ 사이드바 시트를 연다. */
async function openSidebar(user: ReturnType<typeof renderContacts>['user']) {
  await user.click(await screen.findByTestId('mobile-sidebar-trigger'))
  return screen.findByTestId('mobile-sidebar-sheet')
}

// 관리자의 조직도 노드 — hover 「＋」 대신 ⋯ 가 액션 시트를 열고, 하위 그룹 추가는 그 노드를 parentId 로 보낸다.
test('조직도 노드: ⋯ → 액션 시트 → 하위 그룹 추가 → POST parentId', async () => {
  const creates: unknown[] = []
  const { user } = renderContacts('/contacts?group=10', {
    auth: ADMIN,
    handlers: [
      ...baseHandlers,
      http.post('/api/v1/user-groups', async ({ request }) => {
        creates.push(await request.json())
        return HttpResponse.json(sharedDetail({ id: 97, name: '하위팀', parentId: 10, members: [] }), { status: 201 })
      }),
    ],
  })
  await screen.findByTestId('org-chart-view')
  expect(screen.queryByTestId('org-add-10')).not.toBeInTheDocument()
  await user.click(await screen.findByTestId('org-more-10'))
  const sheet = await screen.findByTestId('mobile-action-sheet')
  expect(within(sheet).getByTestId('mobile-action-org-edit')).toBeInTheDocument()
  expect(within(sheet).getByTestId('mobile-action-org-delete').className).toMatch(/text-destructive/)
  await user.click(within(sheet).getByTestId('mobile-action-org-add'))
  await waitFor(() => expect(screen.queryByTestId('mobile-action-sheet')).not.toBeInTheDocument())
  await screen.findByTestId('group-form-dialog')
  await user.type(screen.getByTestId('g-name'), '하위팀')
  await user.click(screen.getByTestId('g-save'))
  await waitFor(() => expect(screen.queryByTestId('group-form-dialog')).not.toBeInTheDocument())
  expect(creates.at(-1)).toMatchObject({ name: '하위팀', visibility: 'SHARED', parentId: 10 })
})

// 내 그룹 — 사이드바 시트 안 ⋯ → 액션 시트 → 기존 삭제 확인창을 거쳐야 DELETE.
test('내 그룹: 사이드바 시트 안 ⋯ → 액션 시트 → 삭제 확인 → DELETE', async () => {
  let deletes = 0
  const { user } = renderContacts('/contacts', {
    handlers: [
      ...baseHandlers,
      http.delete('/api/v1/user-groups/20', () => {
        deletes++
        return new HttpResponse(null, { status: 204 })
      }),
    ],
  })
  await openSidebar(user)
  expect(screen.queryByTestId('group-delete-20')).not.toBeInTheDocument()
  await user.click(await screen.findByTestId('group-more-20'))
  const sheet = await screen.findByTestId('mobile-action-sheet')
  await user.click(within(sheet).getByTestId('mobile-action-group-delete'))
  expect(await screen.findByTestId('group-delete-confirm')).toBeInTheDocument()
  expect(deletes).toBe(0)
  await user.click(screen.getByTestId('group-delete-confirm-btn'))
  await waitFor(() => expect(deletes).toBe(1))
})

// WP-578 — 시트 안 타입 필터·그룹은 버튼이라 골라도 시트가 남아 바뀐 목록을 덮었다. 외부 필터(조직·직책 필터가 이어 나옴)는 남긴다.
// 검색창은 헤더 🔍 로 옮겨 시트에 없다(WP-976).
test('☰ 시트 — 외부 필터는 시트를 두고, 다른 타입 필터를 고르면 시트가 닫힌다', async () => {
  const { user, location } = renderContacts('/contacts', { handlers: baseHandlers })
  const sheet = await openSidebar(user)
  expect(within(sheet).queryByTestId('contact-search')).not.toBeInTheDocument()
  await user.click(within(sheet).getByTestId('contact-filter-EXTERNAL'))
  await waitFor(() => expect(location()).toMatch(/type=EXTERNAL/))
  expect(await within(screen.getByTestId('mobile-sidebar-sheet')).findByTestId('contact-advanced-filter')).toBeInTheDocument()
  await user.click(within(screen.getByTestId('mobile-sidebar-sheet')).getByTestId('contact-filter-FAVORITE'))
  await waitFor(() => expect(location()).toMatch(/type=FAVORITE/))
  await waitFor(() => expect(screen.queryByTestId('mobile-sidebar-sheet')).not.toBeInTheDocument())
})

test('☰ 시트 — 그룹을 고르면 시트가 닫힌다', async () => {
  const { user, location } = renderContacts('/contacts', { handlers: baseHandlers })
  const sheet = await openSidebar(user)
  await user.click(await within(sheet).findByTestId('group-node-20'))
  await waitFor(() => expect(location()).toMatch(/group=20/))
  await waitFor(() => expect(screen.queryByTestId('mobile-sidebar-sheet')).not.toBeInTheDocument())
})
