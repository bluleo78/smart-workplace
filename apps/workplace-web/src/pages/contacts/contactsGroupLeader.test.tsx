// 조직도 리더 표시·지정(WP-1327) — 페이지 테스트(WP-971).
// 조직을 열면 리더가 이름 옆 「리더」 배지로 구분되고(서버 정렬대로 맨 위), 관리자만 직속 구성원 행에서 리더를 지정·해제한다.
// 배지·조건부 버튼·요청 경로는 브라우저 없이 판정된다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, type HttpHandler, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { MOCK_ADMIN_ROLE, MOCK_USER_ROLE } from '@/test/msw/baseHandlers'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { UserGroupDetail } from '@/types/userGroup'

import { page } from '../../../e2e/factories/contacts.factory'
import { personalNode, sharedDetail, sharedNode, tree } from '../../../e2e/factories/userGroups.factory'

const ADMIN = [MOCK_ADMIN_ROLE, MOCK_USER_ROLE]

/** 개발본부(10) — 리더 박리더(3)가 맨 위, 이개발(2)은 구성원, 외부 연락처(9)는 리더 대상이 아니다. */
function detail(over: Partial<UserGroupDetail> = {}): UserGroupDetail {
  return sharedDetail({
    members: [
      { targetType: 'MEMBER', targetId: 3, name: '박리더', email: 'park@example.com', title: null, organization: null, leader: true },
      { targetType: 'MEMBER', targetId: 2, name: '이개발', email: 'lee@example.com', title: null, organization: null, leader: false },
      { targetType: 'EXTERNAL', targetId: 9, name: '외부 협력', email: 'ext@example.com', title: null, organization: '협력사', leader: false },
    ],
    ...over,
  })
}

function handlers(extra: HttpHandler[] = []) {
  return [
    ...extra,
    http.get('/api/v1/user-groups', () =>
      HttpResponse.json(tree({ shared: [sharedNode()], personal: [personalNode()] })),
    ),
    http.get('/api/v1/user-groups/:id', () => HttpResponse.json(detail())),
    http.get('/api/v1/contacts', () => HttpResponse.json(page([]))),
  ]
}

test('조직을 열면 리더가 맨 위에 「리더」 배지로 구분되고, 일반 사용자에게는 지정 버튼이 없다', async () => {
  renderPage('/contacts?group=10', { handlers: handlers() })
  const leaderRow = await screen.findByTestId('group-member-MEMBER-3', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(within(leaderRow).getByTestId('group-member-leader-MEMBER-3')).toHaveTextContent('리더')
  expect(screen.queryByTestId('group-member-leader-MEMBER-2')).not.toBeInTheDocument()
  // 리더가 목록 맨 위(서버 정렬 그대로).
  const rows = within(screen.getByTestId('group-contact-view')).getAllByTestId(/^group-member-(MEMBER|EXTERNAL)-\d+$/)
  expect(rows[0]).toBe(leaderRow)
  expect(screen.queryByTestId('group-member-leader-toggle-2')).not.toBeInTheDocument()
})

test('관리자는 구성원 행에서 리더로 지정(PUT)·해제(DELETE)하고, 외부 연락처 행에는 버튼이 없다', async () => {
  const calls: string[] = []
  const extra = [
    http.put('/api/v1/user-groups/:id/leaders/:userId', ({ params }) => {
      calls.push(`PUT ${params.id}/${params.userId}`)
      return HttpResponse.json(detail())
    }),
    http.delete('/api/v1/user-groups/:id/leaders/:userId', ({ params }) => {
      calls.push(`DELETE ${params.id}/${params.userId}`)
      return HttpResponse.json(detail())
    }),
  ]
  renderPage('/contacts?group=10', { handlers: handlers(extra), roles: ADMIN })
  const make = await screen.findByTestId('group-member-leader-toggle-2', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(make).toHaveAccessibleName('이개발 리더로 지정')
  const unset = screen.getByTestId('group-member-leader-toggle-3')
  expect(unset).toHaveAccessibleName('박리더 리더 해제')
  expect(screen.queryByTestId('group-member-leader-toggle-9')).not.toBeInTheDocument()

  fireEvent.click(make)
  await waitFor(() => expect(calls).toContain('PUT 10/2'))
  await waitFor(() => expect(screen.getByTestId('group-member-leader-toggle-3')).not.toBeDisabled())
  fireEvent.click(screen.getByTestId('group-member-leader-toggle-3'))
  await waitFor(() => expect(calls).toContain('DELETE 10/3'))
})

test('개인 그룹(내 분류)에는 관리자여도 리더 지정 버튼이 없다', async () => {
  renderPage('/contacts?group=20', {
    handlers: [
      http.get('/api/v1/user-groups/:id', () =>
        HttpResponse.json(detail({ id: 20, name: '내 분류', visibility: 'PERSONAL', ownerId: 1 })),
      ),
      ...handlers(),
    ],
    roles: ADMIN,
  })
  await screen.findByTestId('group-member-MEMBER-2', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(screen.queryByTestId('group-member-leader-toggle-2')).not.toBeInTheDocument()
})
