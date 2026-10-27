// 연락처 그룹 보기에서 조직도 카드를 없앤 것과 사이드바 ⋯ 권한(WP-978) — 페이지 테스트(WP-971).
// 예전 조직도 카드(OrgChartView)를 없애고 가운데엔 소속 멤버만 둔다 — 하위 조직은 왼쪽 트리가 보인다.
// 조직도 관리(⋯)는 ADMIN 만 보인다. 조건부 렌더라 브라우저 없이 판정된다.
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { MOCK_ADMIN_ROLE, MOCK_USER_ROLE } from '@/test/msw/baseHandlers'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { page } from '../../../e2e/factories/contacts.factory'
import { personalNode, sharedDetail, sharedNode, tree } from '../../../e2e/factories/userGroups.factory'

/** 개발본부(10) › 플랫폼팀(11, 하위 1) · 인프라팀(12) › 스토리지 셀(13). */
function handlers() {
  const t = tree({
    shared: [
      sharedNode({
        children: [
          sharedNode({ id: 11, name: '플랫폼팀', parentId: 10, children: [sharedNode({ id: 13, name: '스토리지 셀', parentId: 11 })] }),
          sharedNode({ id: 12, name: '인프라팀', parentId: 10 }),
        ],
      }),
    ],
    personal: [personalNode()],
  })
  return [
    http.get('/api/v1/user-groups', () => HttpResponse.json(t)),
    http.get('/api/v1/user-groups/:id', ({ params }) => HttpResponse.json(sharedDetail({ id: Number(params.id) }))),
    http.get('/api/v1/contacts', () => HttpResponse.json(page([]))),
  ]
}

test('하위 조직이 있어도 가운데엔 조직도 카드·하위 목록 없이 소속 멤버만 보인다', async () => {
  renderPage('/contacts?group=10', { handlers: handlers() })
  await screen.findByTestId('group-member-MEMBER-2', {}, { timeout: PAGE_LOAD_TIMEOUT })
  const view = screen.getByTestId('group-contact-view')
  // 하위 조직은 왼쪽 트리가 보인다 — 가운데에서 다시 그리지 않는다(양동희 2277).
  expect(within(view).queryByText('플랫폼팀')).not.toBeInTheDocument()
  expect(within(view).queryByText('인프라팀')).not.toBeInTheDocument()
  expect(screen.queryByTestId('org-chart-view')).not.toBeInTheDocument()
  expect(screen.getByTestId('group-node-11')).toBeInTheDocument()
})

test('일반 사용자는 조직도 행에 ⋯ 가 없고, 내 그룹 행엔 있다', async () => {
  renderPage('/contacts', { handlers: handlers() })
  await screen.findByTestId('group-node-10', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(screen.queryByTestId('org-more-10')).not.toBeInTheDocument()
  expect(screen.getByTestId('group-more-20')).toHaveAccessibleName('내 분류 더보기')
})

test('관리자는 조직도 행마다 ⋯ 가 있다', async () => {
  renderPage('/contacts', { handlers: handlers(), roles: [MOCK_ADMIN_ROLE, MOCK_USER_ROLE] })
  await screen.findByTestId('group-node-10', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(screen.getByTestId('org-more-10')).toHaveAccessibleName('개발본부 더보기')
  expect(screen.getByTestId('org-more-13')).toBeInTheDocument()
})
