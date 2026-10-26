// 설정 › 구성원 상세(/settings/users/:id) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 역할 0개 저장 가드(#150), 활성 상태 끄기 문구·payload(WP-417), 내 계정 스위치 잠금(WP-909), 대상 종류별 역할 숨김(WP-728)은
// 응답 → 화면, 입력 → payload 라 브라우저 없이 판정되므로 e2e/pages/admin/user-detail-roles.spec.ts 에서 옮겼다.
// 역할 저장 → PUT → 성공 토스트 배선 1건(@wiring)은 E2E 에 남는다.
// useParams 가 id 를 읽으므로 UserDetailPage 를 라우트 패턴으로 감싸 renderScreen 으로 띄운다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { RoleResponse } from '@/types/role'

import { createRole, createUserDetail } from '../../../e2e/factories/auth.factory'
import UserDetailPage from './UserDetailPage'

const USER_ID = 4

const ROLES_LIST = [
  createRole({ id: 1, name: 'USER', description: '일반 사용자', isSystem: true }),
  createRole({ id: 2, name: 'ADMIN', description: '시스템 관리자', isSystem: true }),
]

/** USER 역할만 가진 사람 대상. */
const INITIAL_USER = createUserDetail({
  id: USER_ID,
  name: '테스트 사용자',
  username: `user${USER_ID}`,
  email: `user${USER_ID}@example.com`,
  roles: [ROLES_LIST[0]],
})

// WP-728 — 대상 종류에 맞는 역할만 보인다(AI: ADMIN·관리 권한 역할 숨김, 사람: AGENT 숨김).
const KIND_ROLES: RoleResponse[] = [
  createRole({ id: 1, name: 'USER', description: '일반 사용자', isSystem: true }),
  { ...createRole({ id: 2, name: 'ADMIN', description: '시스템 관리자', isSystem: true }), grantsAdmin: true },
  createRole({ id: 3, name: 'AGENT', description: 'AI 에이전트', isSystem: true }),
  { ...createRole({ id: 4, name: 'HR', description: '인사', isSystem: false }), grantsAdmin: true },
  createRole({ id: 5, name: 'VIEWER', description: '보기 전용', isSystem: false }),
]

/**
 * 상세·역할 목록과 쓰기 API. 역할 저장(PUT roles)·활성 변경(PUT active) 본문을 모은다.
 * 로그인 사용자는 testAuthValue(id 1) — 내 계정 상세는 id 1 로 연다.
 */
function renderDetail(user = INITIAL_USER, roles: RoleResponse[] = ROLES_LIST) {
  const calls = { roleSaves: [] as unknown[], actives: [] as unknown[] }
  const view = renderScreen(
    <Routes>
      <Route path="/settings/users/:id" element={<UserDetailPage />} />
    </Routes>,
    {
      path: `/settings/users/${user.id}`,
      handlers: [
        http.get(`/api/v1/users/${user.id}`, () => HttpResponse.json(user)),
        http.get('/api/v1/roles', () => HttpResponse.json(roles)),
        http.put(`/api/v1/users/${user.id}/roles`, async ({ request }) => {
          calls.roleSaves.push(await request.json())
          return new HttpResponse(null, { status: 204 })
        }),
        http.put(`/api/v1/users/${user.id}/active`, async ({ request }) => {
          calls.actives.push(await request.json())
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    },
  )
  return { ...view, calls }
}

test('역할을 모두 해제하고 저장하면 오류 토스트만 띄우고 요청하지 않는다 (#150)', async () => {
  const { user, calls } = renderDetail()
  const userBox = await screen.findByRole('checkbox', { name: /USER/ })
  expect(userBox).toBeChecked()
  await user.click(userBox)
  expect(userBox).not.toBeChecked()
  await user.click(screen.getByRole('button', { name: '역할 저장' }))

  expect(await screen.findByText('역할은 최소 1개 이상 선택해야 합니다.')).toBeInTheDocument()
  expect(calls.roleSaves).toEqual([])
})

test('활성 상태 끄기는 이 워크스페이스 범위로 안내하고, 확인하면 active=false 로 저장된다 (WP-417)', async () => {
  const { user, calls } = renderDetail()
  expect(
    await screen.findByText('비활성 구성원은 이 워크스페이스에 들어올 수 없어요. 다른 워크스페이스에는 영향이 없어요.'),
  ).toBeInTheDocument()

  await user.click(screen.getByRole('switch', { name: '활성 상태' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent(
    '비활성화하면 이 사용자는 이 워크스페이스에 들어올 수 없어요. 다른 워크스페이스와 계정은 그대로예요. 계속할까요?',
  )
  await user.click(within(dialog).getByRole('button', { name: '비활성화' }))

  await waitFor(() => expect(calls.actives).toEqual([{ active: false }]))
  await waitFor(() => expect(screen.getByRole('switch', { name: '활성 상태' })).not.toBeChecked())
})

test('내 계정 상세에서는 활성 상태 스위치가 처음부터 막혀 있고 이유가 보인다 (WP-909)', async () => {
  const me = createUserDetail({ id: 1, name: '나', username: 'me', email: 'me@example.com', roles: ROLES_LIST })
  const { calls } = renderDetail(me)
  const toggle = await screen.findByRole('switch', { name: '활성 상태' })
  expect(toggle).toBeChecked()
  expect(toggle).toBeDisabled()
  expect(screen.getByText('내 계정은 비활성화할 수 없어요.')).toBeInTheDocument()
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(calls.actives).toEqual([])
})

test('AI 대상에게는 ADMIN·관리 권한 역할이 보이지 않고 이유가 안내된다 (WP-728)', async () => {
  renderDetail({ ...INITIAL_USER, kind: 'AGENT', roles: [KIND_ROLES[2]] }, KIND_ROLES)
  expect(await screen.findByText('AI 에게는 관리자 역할이나 관리 권한이 든 역할을 줄 수 없어요', { exact: false })).toBeInTheDocument()
  for (const id of [1, 3, 5]) expect(document.getElementById(`role-${id}`)).toBeInTheDocument()
  for (const id of [2, 4]) expect(document.getElementById(`role-${id}`)).not.toBeInTheDocument()
})

test('사람 대상에게는 AGENT 역할만 보이지 않는다 (WP-728)', async () => {
  renderDetail(INITIAL_USER, KIND_ROLES)
  await screen.findByRole('checkbox', { name: /USER/ })
  expect(document.getElementById('role-2')).toBeInTheDocument()
  expect(document.getElementById('role-4')).toBeInTheDocument()
  expect(document.getElementById('role-3')).not.toBeInTheDocument()
})
