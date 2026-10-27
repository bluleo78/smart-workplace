// 연락처 사이드바 그룹 트리 행 ⋯ 메뉴의 관리 동작(WP-978) — 페이지 테스트(WP-971).
// 조직도 관리(하위 조직 추가·수정·삭제)는 그룹 보기 카드에서 사이드바 트리 ⋯ 로 옮겼다.
// 메뉴 항목 → 폼 → API payload, 상위 그룹 후보, 삭제 실패 처리는 브라우저 없이 판정된다(MSW 로 요청 검사).
// hover·키보드 초점으로 ⋯ 가 드러나는 것은 E2E(@input, contacts-keyboard-actions.spec.ts)가 지킨다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { MOCK_ADMIN_ROLE, MOCK_USER_ROLE } from '@/test/msw/baseHandlers'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { page } from '../../../e2e/factories/contacts.factory'
import { personalDetail, personalNode, sharedDetail, sharedNode, tree } from '../../../e2e/factories/userGroups.factory'

const ADMIN = [MOCK_ADMIN_ROLE, MOCK_USER_ROLE]

/** 개발본부(10) › 플랫폼팀(11) › 스토리지 셀(13), 개발본부 › 인프라팀(12), 영업본부(30) / 내 분류(20) › 하위 분류(21). */
const groupTree = tree({
  shared: [
    sharedNode({
      children: [
        sharedNode({ id: 11, name: '플랫폼팀', parentId: 10, children: [sharedNode({ id: 13, name: '스토리지 셀', parentId: 11 })] }),
        sharedNode({ id: 12, name: '인프라팀', parentId: 10 }),
      ],
    }),
    sharedNode({ id: 30, name: '영업본부' }),
  ],
  personal: [personalNode({ children: [personalNode({ id: 21, name: '하위 분류', parentId: 20 })] })],
})

const NAMES: Record<number, string> = { 10: '개발본부', 11: '플랫폼팀', 12: '인프라팀', 13: '스토리지 셀', 30: '영업본부' }
const PARENTS: Record<number, number | null> = { 10: null, 11: 10, 12: 10, 13: 11, 30: null }

function handlers() {
  return [
    http.get('/api/v1/user-groups', () => HttpResponse.json(groupTree)),
    http.get('/api/v1/user-groups/:id', ({ params }) => {
      const id = Number(params.id)
      if (id === 20 || id === 21) return HttpResponse.json(personalDetail({ id, name: id === 20 ? '내 분류' : '하위 분류', parentId: id === 21 ? 20 : null }))
      // 조직도 상세엔 code 를 채운다 — 폼이 다루지 않는 code 를 PATCH 에 싣지 않는지(서버가 유지, #839) 보려는 것.
      return HttpResponse.json(sharedDetail({ id, code: 'DEV', name: NAMES[id], parentId: PARENTS[id] }))
    }),
    http.get('/api/v1/contacts', () => HttpResponse.json(page([]))),
  ]
}

// jsdom 에는 포인터 캡처가 없어 Radix 메뉴·Select 가 포인터로 열리다 던진다.
beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
})

// 삭제 실패가 처리되지 않은 Promise 거부로 새는지 잡는다 — 예전 사이드바 삭제는 try 없이 mutateAsync 를 기다려 거부가 샜다.
const rejections: unknown[] = []
const onRejection = (reason: unknown) => rejections.push(reason)
beforeEach(() => {
  rejections.length = 0
  process.on('unhandledRejection', onRejection)
})
afterEach(() => {
  process.off('unhandledRejection', onRejection)
})

/** 행 ⋯ 를 열고 항목을 누른다. */
async function pick(user: ReturnType<typeof renderPage>['user'], prefix: 'org' | 'group', id: number, action: 'add' | 'edit' | 'delete') {
  await user.click(await screen.findByTestId(`${prefix}-more-${id}`, {}, { timeout: PAGE_LOAD_TIMEOUT }))
  await user.click(await screen.findByTestId(`${prefix}-${action}-${id}`))
}

/** 폼의 상위 그룹 선택 후보 이름(「최상위」 포함, 깊이 들여쓰기는 걷어 낸다). 키보드로 연다 — 포인터 열기는 jsdom 에 없는 API 를 쓴다. */
function parentOptionNames() {
  fireEvent.keyDown(screen.getByTestId('g-parent'), { key: 'Enter' })
  const names = within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent?.trim())
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
  return names
}

test('관리자: 조직도 행 ⋯ 「하위 조직 추가」 → 상위가 그 조직으로 채워지고 POST 에 SHARED·parentId 를 보낸다', async () => {
  let body: unknown
  const { user } = renderPage('/contacts', {
    roles: ADMIN,
    handlers: [
      http.post('/api/v1/user-groups', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(sharedDetail({ id: 97, name: '하위팀', parentId: 10, members: [] }), { status: 201 })
      }),
      ...handlers(),
    ],
  })
  await pick(user, 'org', 10, 'add')
  const dialog = await screen.findByTestId('group-form-dialog')
  expect(within(dialog).getByTestId('g-parent')).toHaveTextContent('개발본부')
  await user.type(within(dialog).getByTestId('g-name'), '하위팀')
  await user.click(within(dialog).getByTestId('g-save'))
  await waitFor(() => expect(screen.queryByTestId('group-form-dialog')).not.toBeInTheDocument())
  expect(body).toEqual({ name: '하위팀', parentId: 10, visibility: 'SHARED', code: null, sortOrder: 0 })
})

test('관리자: 조직도 행 ⋯ 「수정」 → 상위 후보는 조직도 그룹이되 자기·자손은 빠지고, PATCH 로 저장한다', async () => {
  let body: unknown
  const { user } = renderPage('/contacts', {
    roles: ADMIN,
    handlers: [
      http.patch('/api/v1/user-groups/11', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(sharedDetail({ id: 11, name: '플랫폼팀(수정)', parentId: 10 }))
      }),
      ...handlers(),
    ],
  })
  await pick(user, 'org', 11, 'edit')
  const dialog = await screen.findByTestId('group-form-dialog')
  expect(within(dialog).getByTestId('g-name')).toHaveValue('플랫폼팀')
  // 공유 그룹 수정은 공유 트리에서 고른다(예전엔 수정을 늘 개인 그룹으로 열어 내 그룹이 후보로 나왔다).
  // code 는 생략한다(#839 부분 수정 — 상세의 code 'DEV' 를 서버가 유지).
  // 자손(스토리지 셀)을 고르면 백엔드가 사이클로 400 — 후보에서 뺀다.
  expect(parentOptionNames()).toEqual(['최상위', '개발본부', '인프라팀', '영업본부'])
  expect(within(dialog).getByTestId('g-parent')).toHaveTextContent('개발본부')

  await user.clear(within(dialog).getByTestId('g-name'))
  await user.type(within(dialog).getByTestId('g-name'), '플랫폼팀(수정)')
  await user.click(within(dialog).getByTestId('g-save'))
  await waitFor(() => expect(screen.queryByTestId('group-form-dialog')).not.toBeInTheDocument())
  expect(body).toEqual({ name: '플랫폼팀(수정)', parentId: 10 })
})

test('관리자: 조직도 수정을 서버가 거부(사이클 400)하면 그 메시지를 토스트로 보인다', async () => {
  const { user } = renderPage('/contacts', {
    roles: ADMIN,
    handlers: [
      http.patch('/api/v1/user-groups/10', () =>
        HttpResponse.json({ status: 400, message: '그룹을 자손 그룹의 하위로 옮길 수 없습니다' }, { status: 400 })),
      ...handlers(),
    ],
  })
  await pick(user, 'org', 10, 'edit')
  const dialog = await screen.findByTestId('group-form-dialog')
  await user.clear(within(dialog).getByTestId('g-name'))
  await user.type(within(dialog).getByTestId('g-name'), '변경')
  await user.click(within(dialog).getByTestId('g-save'))
  expect(await screen.findByText('그룹을 자손 그룹의 하위로 옮길 수 없습니다', { selector: '[data-sonner-toast] *' })).toBeInTheDocument()
})

test('내 그룹 행 ⋯ 「수정」 → 상위 후보는 내 그룹에서 자손을 뺀 것이고 PATCH 로 저장한다', async () => {
  let body: unknown
  const { user } = renderPage('/contacts', {
    handlers: [
      http.patch('/api/v1/user-groups/20', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(personalDetail({ name: '내 분류(수정)' }))
      }),
      ...handlers(),
    ],
  })
  await pick(user, 'group', 20, 'edit')
  const dialog = await screen.findByTestId('group-form-dialog')
  expect(parentOptionNames()).toEqual(['최상위'])
  await user.clear(within(dialog).getByTestId('g-name'))
  await user.type(within(dialog).getByTestId('g-name'), '내 분류(수정)')
  await user.click(within(dialog).getByTestId('g-save'))
  await waitFor(() => expect(screen.queryByTestId('group-form-dialog')).not.toBeInTheDocument())
  expect(body).toEqual({ name: '내 분류(수정)', moveToRoot: true })
})

test('관리자: 보던 조직의 상위를 ⋯ 「삭제」 → 확인 → DELETE 뒤 그룹 보기를 푼다', async () => {
  const deleted = vi.fn()
  const { user, location } = renderPage('/contacts?group=11', {
    roles: ADMIN,
    handlers: [
      http.delete('/api/v1/user-groups/10', () => {
        deleted()
        return new HttpResponse(null, { status: 204 })
      }),
      ...handlers(),
    ],
  })
  await screen.findByTestId('group-contact-view', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await pick(user, 'org', 10, 'delete')
  const confirm = await screen.findByTestId('org-delete-confirm')
  expect(confirm).toHaveTextContent('"개발본부" 그룹과 모든 하위 그룹·멤버십이 함께 삭제됩니다')
  await user.click(screen.getByTestId('org-delete-confirm-btn'))
  await waitFor(() => expect(location()).toBe('/contacts'))
  expect(deleted).toHaveBeenCalledOnce()
})

test('내 그룹 삭제가 실패하면 오류 토스트를 띄우고 확인창을 닫으며, 보던 그룹은 그대로 둔다', async () => {
  const { user, location } = renderPage('/contacts?group=20', {
    handlers: [
      http.delete('/api/v1/user-groups/20', () =>
        HttpResponse.json({ status: 500, message: '서버 오류' }, { status: 500 })),
      ...handlers(),
    ],
  })
  await screen.findByTestId('group-contact-view', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await pick(user, 'group', 20, 'delete')
  await screen.findByTestId('group-delete-confirm')
  await user.click(screen.getByTestId('group-delete-confirm-btn'))
  expect(await screen.findByText('서버 오류')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('group-delete-confirm')).not.toBeInTheDocument())
  expect(location()).toBe('/contacts?group=20')
  // 실패가 처리되지 않은 거부로 새지 않는다 — 한 틱 더 기다려 늦게 오는 거부까지 본다.
  await new Promise((r) => setTimeout(r, 0))
  expect(rejections).toEqual([])
})
